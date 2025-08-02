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
import NodeCache from 'node-cache';
import {  autoInvalidateCache, invalidatePostsCache, invalidateUserPostsCache, invalidateSinglePostCache } from '../../utils/cache'

const router = Router();

// Create cache instance (TTL in seconds)
const cache = new NodeCache({ 
  stdTTL: 60, // 1 minute default TTL
  checkperiod: 120 // Check for expired keys every 2 minutes
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
  autoInvalidateCache(req => 'posts'),
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
        type,
        description,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        location,
        image_url: imageUrls.length > 0 ? imageUrls : null,
        custom_pin: customPinUrl,
        link: link || null,
        emoji: emoji || null,
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

    // After successful post creation, add:
    invalidatePostsCache();
    invalidateUserPostsCache(userId);

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

// Get posts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { dateFilter, sortKey = 'timestamp', sortOrder = 'desc', userId, page = '1', limit = '10', exclude } = req.query;

    console.log('Fetching posts with filters:', { dateFilter, sortKey, sortOrder, userId, page, limit, exclude });

    // Generate cache key
    const cacheKey = `posts:${dateFilter || 'all'}:${sortKey}:${sortOrder}:${userId || 'all'}:page${page}:limit${limit}:exclude${exclude || 'none'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
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
      console.log('Filtering by user ID:', userId);
    }

    if (exclude) {
      query = query.neq('id', exclude);
      console.log('Excluding post ID:', exclude);
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
      console.log('Applying date filter:', dateFilter, 'from:', cutoffDate.toISOString());
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
          try {
            const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(post.user_id);
            
            if (!userError && user) {
              postWithUser = {
                ...post,
                user: {
                  id: user.id,
                  email: user.email,
                  full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
                  profile_picture: user.user_metadata?.profile_picture || null,
                  email_verified: user.email_confirmed_at ? true : false
                }
              };
            } else {
              postWithUser = {
                ...post,
                user: {
                  id: post.user_id,
                  email: 'unknown@example.com',
                  full_name: 'Anonymous User',
                  profile_picture: null,
                  email_verified: false
                }
              };
            }
          } catch (authError) {
            console.warn('Failed to get user info for post:', post.user_id, authError);
            postWithUser = {
              ...post,
              user: {
                id: post.user_id,
                email: 'unknown@example.com',
                full_name: 'Anonymous User',
                profile_picture: null,
                email_verified: false
              }
            };
          }
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
          
          return {
            ...postWithUser,
            liked: !!like,
            likes: post.likes || 0,
            views: post.views || 0
          };
        } catch (likeError) {
          console.warn(`Failed to fetch like status for post ${post.id}:`, likeError);
          return {
            ...postWithUser,
            liked: false,
            likes: post.likes || 0,
            views: post.views || 0
          };
        }
      } else {
        return {
          ...postWithUser,
          liked: false,
          likes: post.likes || 0,
          views: post.views || 0
        };
      }
    }));

    // Cache the results (1-minute TTL)
    cache.set(cacheKey, postsWithUserAndLikes, 60);
    console.log('Posts fetched successfully:', postsWithUserAndLikes.length, 'posts');

    res.json(postsWithUserAndLikes);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Get post by ID
router.get('/:newId', async (req: Request, res: Response) => {
  try {
    const newId = req.params.newId;

    console.log('Fetching post by new_id:', newId);

    const cacheKey = `post:${newId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Returning cached post');
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
      try {
        const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(post.user_id);
        
        if (!userError && user) {
          postWithUser = {
            ...post,
            user: {
              id: user.id,
              email: user.email,
              full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
              profile_picture: user.user_metadata?.profile_picture || null,
              email_verified: user.email_confirmed_at ? true : false
            }
          };
        }
      } catch (authError) {
        console.warn('Failed to get user info for post:', post.user_id, authError);
        postWithUser = {
          ...post,
          user: {
            id: post.user_id,
            email: 'unknown@example.com',
            full_name: 'Anonymous User',
            profile_picture: null,
            email_verified: false
          }
        };
      }
    }

    cache.set(cacheKey, postWithUser, 300); // Cache for 5 minutes

    console.log('Post fetched successfully by new_id:', newId);
    res.json(postWithUser);
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
      .select('user_id')
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

    const { error: updateError } = await supabase
      .from('posts')
      .update({
        type,
        description,
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update post' });
    }

    // After successful update, add:
    invalidatePostsCache();
    invalidateUserPostsCache(userId);
    invalidateSinglePostCache(post.user_id); // if you have new_id

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
      .select('user_id, image_url, custom_pin')
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

    // Optional: Clean up uploaded images from storage
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

    // After successful deletion, add:
    invalidatePostsCache();
    invalidateUserPostsCache(userId);
    invalidateSinglePostCache(post.user_id); // if you have new_id

    console.log('Post deleted successfully:', postId);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});






export default router;