import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../../utils/supabase';
import multer from 'multer';
import {
  enhancedFileUpload,
  rateLimit,
  advancedRateLimit,
  comprehensiveValidation,
  sanitizeForDatabase
} from '../../middleware/advancedPostValidation';
import { authenticate } from '../../middleware/auth';
import { uploadImageToSupabase } from '../../utils/uploadImageToSupabase';
import { 
  safeGetCache,
  safeSetCache,
  autoInvalidateCache, 
  invalidateUserPostsCache, 
  invalidateSinglePostCache 
} from '../../utils/cache';
import { analyzeImagesBatch, type ExplicitContentAnalysis, type ImageAnalysisDetail } from '../../middleware/combinedImageAnalysis';

const router = Router();

// Utility function to get user info consistently
const getUserInfo = async (userId: string) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (!userError && user) {
      return {
        id: user.id,
        email: user.email || 'unknown@example.com',
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
        profile_picture: user.user_metadata?.profile_picture || null,
        email_verified: user.email_confirmed_at ? true : false
      };
    }
  } catch (authError) {
    console.warn('Failed to get user info for:', userId, authError);
  }
  
  return {
    id: userId,
    email: 'unknown@example.com',
    full_name: 'Anonymous User',
    profile_picture: null,
    email_verified: false
  };
};

// Get notifications for a user
router.get('/notifications', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { page = '1', limit = '10' } = req.query;

    console.log('Fetching notifications for user:', userId);

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Create cache key
    const cacheKey = `notifications:${userId}:page-${page}:limit-${limit}`;

    // Try to get from cache first
    const cached = safeGetCache(cacheKey);
    if (cached) {
      console.log('Returning cached notifications for user:', userId);
      return res.json(cached);
    }

    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    // Get unique source_user_ids
    const sourceUserIds = [...new Set(notifications.map(n => n.source_user_id).filter(Boolean))];

    // Fetch user data separately if we have source user IDs
    let usersMap: Record<string, any> = {};
    if (sourceUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, email, profile_picture')
        .in('id', sourceUserIds);

      if (usersError) {
        console.error('Users fetch error:', usersError);
      } else {
        // Create a map for quick lookup
        usersMap = (users || []).reduce((map: Record<string, any>, user: any) => {
          map[user.id] = user;
          return map;
        }, {});
      }
    }

    // Map users to notifications
    const notificationsWithUsers = notifications.map((notification: any) => ({
      ...notification,
      source_user: usersMap[notification.source_user_id] || {
        id: notification.source_user_id,
        full_name: 'Anonymous',
        email: 'unknown@example.com',
        profile_picture: null,
      },
    }));

    const { count, error: countError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      console.error('Count error:', countError);
      return res.status(500).json({ error: 'Failed to get notifications count' });
    }

    console.log('Notifications fetched:', notificationsWithUsers.length);

    const result = {
      notifications: notificationsWithUsers,
      hasMore: notificationsWithUsers.length === limitNum,
      total: count || 0,
    };

    // Cache the result for 1 minute
    safeSetCache(cacheKey, result, 60);
    console.log('Cached notifications for user:', userId);

    res.json(result);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get unread notifications count
router.get('/notifications/unread-count', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    console.log('Getting unread notifications count for user:', userId);

    const cacheKey = `notifications:${userId}:unread-count`;
    const cached = safeGetCache(cacheKey);
    if (cached !== null && cached !== undefined) {
      console.log('Returning cached unread count for user:', userId);
      return res.json({ count: cached });
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Count error:', error);
      return res.status(500).json({ error: 'Failed to get unread notifications count' });
    }

    const unreadCount = count || 0;

    // Cache the result for 30 seconds (shorter TTL for real-time feel)
    safeSetCache(cacheKey, unreadCount, 30);
    console.log('Unread notifications count for user:', userId, '=', unreadCount);

    res.json({ count: unreadCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get unread notifications count' });
  }
});

// Mark notification as read
router.put('/notifications/:id/read', authenticate, autoInvalidateCache(req => `notifications:${req.user.id}`), async (req: Request, res: Response) => {
  try {
    const notificationId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Marking notification as read:', notificationId);

    const { data: notification, error: fetchError } = await supabase
      .from('notifications')
      .select('user_id')
      .eq('id', notificationId)
      .single();

    if (fetchError || !notification) {
      console.log('Notification not found:', notificationId);
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.user_id !== userId) {
      console.log('Unauthorized attempt by user:', userId);
      return res.status(403).json({ error: 'Unauthorized to modify this notification' });
    }

    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to mark notification as read' });
    }

    console.log('Notification marked as read:', notificationId);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.put('/notifications/read-all', authenticate, autoInvalidateCache(req => `notifications:${req.user.id}`), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    console.log('Marking all notifications as read for user:', userId);

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }

    console.log('All notifications marked as read for user:', userId);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Create post
router.post(
  '/', 
  authenticate, 
  advancedRateLimit,
  rateLimit,
  enhancedFileUpload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'custom_pin', maxCount: 1 }
  ]),
  comprehensiveValidation,
  autoInvalidateCache(_req => 'posts'),
  async (req: Request, res: Response) => {
  try {
    const { type, description, lat, lng, location, link, emoji } = req.body;
    const userId = (req as any).user.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    console.log('Creating post for user:', userId);
    console.log('Post data:', { type, description, lat, lng, location, link, emoji });
    console.log('Files received:', {
      images: files?.images?.length || 0,
      custom_pin: files?.custom_pin?.length || 0
    });

    let imageUrls: string[] = [];
    let customPinUrl: string | null = null;

    // Handle post images
    if (files?.images && files.images.length > 0) {
      try {
        console.log('Uploading', files.images.length, 'post images...');
        imageUrls = await Promise.all(
          files.images.map(file => uploadImageToSupabase(file, 'posts'))
        );
        console.log('All post images uploaded successfully:', imageUrls);
      } catch (uploadError) {
        console.error('Post images upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload post images' });
      }
    }

    // Handle custom pin image
    if (files?.custom_pin && files.custom_pin.length > 0) {
      try {
        console.log('Uploading custom pin image...');
        customPinUrl = await uploadImageToSupabase(files.custom_pin[0], 'custom-pins');
        console.log('Custom pin uploaded successfully:', customPinUrl);
      } catch (uploadError) {
        console.error('Custom pin upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload custom pin image' });
      }
    }

    // Sanitize inputs before database insertion
    const sanitizedType = sanitizeForDatabase(type);
    const sanitizedDescription = sanitizeForDatabase(description);
    const sanitizedLocation = sanitizeForDatabase(location);
    const sanitizedLink = link ? sanitizeForDatabase(link) : null;
    const sanitizedEmoji = emoji ? sanitizeForDatabase(emoji) : null;

    if (!sanitizedType || !sanitizedDescription || !lat || !lng || !sanitizedLocation) {
      console.log('Missing required fields:', {
        type: !!sanitizedType,
        description: !!sanitizedDescription,
        lat: !!lat,
        lng: !!lng,
        location: !!sanitizedLocation
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        type: sanitizedType,
        description: sanitizedDescription,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        location: sanitizedLocation,
        image_url: imageUrls.length > 0 ? imageUrls : null,
        custom_pin: customPinUrl,
        link: sanitizedLink,
        emoji: sanitizedEmoji,
        timestamp: new Date().toISOString(),
        resolution_status: 'active',
        likes: 0,
        views: 0,
        user_id: userId
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to create post' });
    }

    // Cache invalidation is handled by autoInvalidateCache middleware
    console.log('Post created successfully:', data.id);
    res.status(201).json(data);
  } catch (error) {
    console.error('Server error:', error);
    
    // Provide specific error messages
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5MB per image.' });
      }
      return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Replace the existing GET posts route with this updated version:
router.get('/', async (req: Request, res: Response) => {
  try {
    const { dateFilter, sortKey = 'timestamp', sortOrder = 'desc', userId, page = '1', limit = '10', exclude } = req.query;

    // Generate consistent cache key
    const cacheKey = `posts:filter-${dateFilter || 'all'}:sort-${sortKey}:${sortOrder}:user-${userId || 'all'}:page-${page}:limit-${limit}:exclude-${exclude || 'none'}`;
    
    const cached = safeGetCache(cacheKey);
    if (cached) {
      console.log('Returning cached posts for key:', cacheKey);
      return res.json(cached);
    }

    // Build Supabase query
    let query = supabase
      .from('posts')
      .select(`
        id, type, description, lat, lng, location, timestamp, image_url, link, new_id, 
        resolution_status, likes, views, emoji, user_id, updated_at, custom_pin, 
        user:users(id, email, full_name, profile_picture, email_verified)
      `)
      .eq('resolution_status', 'active');

    // Apply filters
    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (exclude) {
      query = query.neq('id', exclude);
    }

    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      let cutoffDate: Date;
      
      switch (dateFilter) {
        case '24h':
          cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '3d':
          cutoffDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
          break;
        case '7d':
          cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          cutoffDate = new Date(0);
      }
      
      query = query.gte('timestamp', cutoffDate.toISOString());
    }

    // Apply sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortKey as string, { ascending });

    // Apply pagination
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    query = query.range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    // Execute query
    const { data: posts, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }

    // Process posts with user info and liked status
    const authUserId = (req as any).user?.id;
    let postsWithUserAndLikes = await Promise.all(posts.map(async (post: any) => {
      // Handle user information - fallback to auth if users table join failed
      let postWithUser = post;
      
      // Extract user data from join result (it might be an array or null)
      let userData = null;
      if (post.user) {
        if (Array.isArray(post.user) && post.user.length > 0) {
          userData = post.user[0]; // Take first user if it's an array
        } else if (!Array.isArray(post.user)) {
          userData = post.user; // Use as-is if it's an object
        }
      }
      
      // Check if we have valid user data with full_name
      if (!userData || !userData.full_name) {
        if (post.user_id) {
          const userInfo = await getUserInfo(post.user_id);
          postWithUser = {
            ...post,
            user: userInfo
          };
        }
      } else {
        // Use the valid joined user data
        postWithUser = {
          ...post,
          user: userData
        };
      }

      // Handle liked status for authenticated users
      if (authUserId) {
        try {
          const { data: like } = await supabase
            .from('post_likes')
            .select('id')
            .eq('post_id', post.id)
            .eq('user_id', authUserId)
            .single();
          
          postWithUser = {
            ...postWithUser,
            liked: !!like,
            likes: post.likes || 0,
            views: post.views || 0
          };
        } catch (likeError) {
          console.warn(`Failed to fetch like status for post ${post.id}:`, likeError);
          postWithUser = {
            ...postWithUser,
            liked: false,
            likes: post.likes || 0,
            views: post.views || 0
          };
        }
      } else {
        postWithUser = {
          ...postWithUser,
          liked: false,
          likes: post.likes || 0,
          views: post.views || 0
        };
      }

      // Analyze images for explicit content
      let explicitContentAnalysis: ExplicitContentAnalysis = {
        hasExplicitContent: false,
        confidence: 0,
        details: [],
        hasExplicitText: false,
        textConfidence: 0,
        detectedCategories: []
      };

      if (post.image_url && Array.isArray(post.image_url) && post.image_url.length > 0) {
        
        try {
          explicitContentAnalysis = await analyzeImagesBatch(post.image_url);

          if (explicitContentAnalysis.hasExplicitContent) {
            console.log(`⚠️  Explicit content detected in post ${post.id} - Skin: ${explicitContentAnalysis.confidence}, Text: ${explicitContentAnalysis.textConfidence}, Categories: ${explicitContentAnalysis.detectedCategories.join(', ')}`);
          }

        } catch (analysisError) {
          console.warn(`Failed to analyze images for post ${post.id}:`, analysisError);
        }
      }

      return {
        ...postWithUser,
        explicit_content: explicitContentAnalysis
      };
    }));

    // Cache the results (1-minute TTL)
    safeSetCache(cacheKey, postsWithUserAndLikes, 60);

    res.json(postsWithUserAndLikes);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Also update the single post GET route:
router.get('/:newId', async (req: Request, res: Response) => {
  try {
    const newId = req.params.newId;

    const cacheKey = `post:${newId}`;
    const cached = safeGetCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { data: post, error } = await supabase
      .from('posts')
      .select('*')
      .eq('new_id', newId)
      .single();

    if (error || !post) {
      console.log('Post not found for new_id:', newId);
      return res.status(404).json({ error: 'Post not found' });
    }

    // Get user information for the post
    let postWithUser = post;
    if (post.user_id) {
      const userInfo = await getUserInfo(post.user_id);
      postWithUser = {
        ...post,
        user: userInfo
      };
    }

    // Analyze images for explicit content
    let explicitContentAnalysis: ExplicitContentAnalysis = {
      hasExplicitContent: false,
      confidence: 0,
      details: [],
      hasExplicitText: false,
      textConfidence: 0,
      detectedCategories: []
    };

    if (post.image_url && Array.isArray(post.image_url) && post.image_url.length > 0) {      
      try {
        explicitContentAnalysis = await analyzeImagesBatch(post.image_url);

        if (explicitContentAnalysis.hasExplicitContent) {
          console.log(`⚠️  Explicit content detected in post ${post.id} - Skin: ${explicitContentAnalysis.confidence}, Text: ${explicitContentAnalysis.textConfidence}, Categories: ${explicitContentAnalysis.detectedCategories.join(', ')}`);
        }

      } catch (analysisError) {
        console.warn(`Failed to analyze images for post ${post.id}:`, analysisError);
      }
    }

    const finalPost = {
      ...postWithUser,
      explicit_content: explicitContentAnalysis
    };

    safeSetCache(cacheKey, finalPost, 300); // Cache for 5 minutes

    res.json(finalPost);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Update post
router.put('/:id', authenticate, autoInvalidateCache(req => 'posts'), async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;
    const { type, description } = req.body;

    console.log('Updating post:', postId, 'by user:', userId);

    if (!type || !description) {
      console.log('Missing required fields for update:', { type: !!type, description: !!description });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify post belongs to user
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('user_id, new_id')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      console.log('Post not found:', postId);
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== userId) {
      console.log('Unauthorized update attempt by user:', userId, 'for post owned by:', post.user_id);
      return res.status(403).json({ error: 'Unauthorized to edit this post' });
    }

    const sanitizedType = sanitizeForDatabase(type);
    const sanitizedDescription = sanitizeForDatabase(description);

    const { error: updateError } = await supabase
      .from('posts')
      .update({
        type: sanitizedType,
        description: sanitizedDescription,
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update post' });
    }

    // Invalidate specific caches
    invalidateUserPostsCache(userId);
    if (post.new_id) {
      invalidateSinglePostCache(post.new_id);
    }

    console.log('Post updated successfully:', postId);
    res.json({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post
router.delete('/:id', authenticate, autoInvalidateCache(req => 'posts'), async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Deleting post:', postId, 'by user:', userId);

    // Verify post belongs to user and get image URLs for cleanup
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('user_id, image_url, custom_pin, new_id')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      console.log('Post not found for deletion:', postId);
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== userId) {
      console.log('Unauthorized delete attempt by user:', userId, 'for post owned by:', post.user_id);
      return res.status(403).json({ error: 'Unauthorized to delete this post' });
    }

    // Delete post from database
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete post' });
    }

    // Clean up uploaded images from storage
    if (post.image_url && Array.isArray(post.image_url)) {
      try {
        const deletePromises = post.image_url.map(async (url: string) => {
          // Extract file path from URL
          const urlParts = url.split('/');
          const fileName = urlParts[urlParts.length - 1];
          const filePath = `posts/${fileName}`;
          
          return supabase.storage
            .from('pinmo-images')
            .remove([filePath]);
        });
        
        await Promise.all(deletePromises);
        console.log('Post images cleaned up from storage');
      } catch (cleanupError) {
        console.warn('Failed to cleanup post images:', cleanupError);
        // Don't fail the delete operation if cleanup fails
      }
    }

    // Clean up custom pin image if exists
    if (post.custom_pin) {
      try {
        const urlParts = post.custom_pin.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const filePath = `custom-pins/${fileName}`;
        
        await supabase.storage
          .from('pinmo-images')
          .remove([filePath]);
        
        console.log('Custom pin image cleaned up from storage');
      } catch (cleanupError) {
        console.warn('Failed to cleanup custom pin image:', cleanupError);
      }
    }

    // Invalidate specific caches
    invalidateUserPostsCache(userId);
    if (post.new_id) {
      invalidateSinglePostCache(post.new_id);
    }

    console.log('Post deleted successfully:', postId);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

export default router;