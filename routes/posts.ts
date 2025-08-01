import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import multer from 'multer';
import {
  enhancedFileUpload,
  rateLimit,
  advancedRateLimit,
  comprehensiveValidation,
  sanitizeForDatabase
} from '../middleware/advancedPostValidation';
import { authenticate } from '../middleware/auth';
import { uploadImageToSupabase } from '../utils/uploadImageToSupabase';

const router = Router();

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
    const { dateFilter, sortKey = 'timestamp', sortOrder = 'desc', userId } = req.query;

    console.log('Fetching posts with filters:', { dateFilter, sortKey, sortOrder, userId });

    let query = supabase
      .from('posts')
      .select('*');

    if (userId) {
      query = query.eq('user_id', userId);
      console.log('Filtering by user ID:', userId);
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
        default:
          cutoffDate = new Date(0);
      }
      
      query = query.gte('timestamp', cutoffDate.toISOString());
      console.log('Applying date filter:', dateFilter, 'from:', cutoffDate.toISOString());
    }

    const ascending = sortOrder === 'asc';
    query = query.order(sortKey as string, { ascending });

    const { data: posts, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }

    // Get unique user IDs from posts
    const userIds = [...new Set(posts.map(post => post.user_id).filter(Boolean))];
    
    // Get user information from Supabase Auth
    const postsWithUsers = await Promise.all(posts.map(async (post) => {
      if (post.user_id) {
        try {
          const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(post.user_id);
          
          if (!userError && user) {
            return {
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
          console.warn('Failed to get user info for:', post.user_id, authError);
        }
      }
      // Return post without user info if user fetch failed
      return {
        ...post,
        user: {
          id: post.user_id,
          email: 'unknown@example.com',
          full_name: 'Anonymous User',
          profile_picture: null,
          email_verified: false
        }
      };
    }));

    console.log('Posts fetched successfully:', postsWithUsers.length, 'posts');
    res.json(postsWithUsers);
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

    console.log('Post fetched successfully by new_id:', newId);
    res.json(postWithUser);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Update post
router.put('/:id', authenticate, async (req: Request, res: Response) => {
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

    console.log('Post updated successfully:', postId);
    res.json({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
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

    console.log('Post deleted successfully:', postId);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Add like
router.post('/:id/likes', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Adding like to post:', postId, 'by user:', userId);

    // Check if user exists in users table
    const { data: userExists } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
      
    if (!userExists) {
      console.log('User not found in users table:', userId);
      return res.status(400).json({ error: 'User not found in database' });
    }

    // Check if user already liked this post
    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    if (existingLike) {
      console.log('User already liked this post:', postId);
      return res.status(400).json({ error: 'You have already liked this post' });
    }

    // Add like record
    const { error: likeError } = await supabase
      .from('post_likes')
      .insert({ post_id: postId, user_id: userId });

    if (likeError) {
      console.error('Like error:', likeError);
      return res.status(500).json({ error: 'Failed to add like' });
    }

    // Get current likes count
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('likes')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to update likes count' });
    }

    const newLikesCount = (post.likes || 0) + 1;

    // Update likes count
    const { error: incrementError } = await supabase
      .from('posts')
      .update({ likes: newLikesCount })
      .eq('id', postId);

    if (incrementError) {
      console.error('Increment error:', incrementError);
      return res.status(500).json({ error: 'Failed to increment likes' });
    }

    console.log('Like added successfully. New count:', newLikesCount);
    res.status(201).json({ likes: newLikesCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to add like' });
  }
});

// Remove like
router.delete('/:id/likes', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Removing like from post:', postId, 'by user:', userId);

    // Check if user has liked this post
    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    if (!existingLike) {
      console.log('User has not liked this post:', postId);
      return res.status(400).json({ error: 'You have not liked this post' });
    }

    // Remove like record
    const { error: unlikeError } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (unlikeError) {
      console.error('Unlike error:', unlikeError);
      return res.status(500).json({ error: 'Failed to remove like' });
    }

    // Get current likes count
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('likes')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to update likes count' });
    }

    const newLikesCount = Math.max(0, (post.likes || 0) - 1);

    // Update likes count
    const { error: decrementError } = await supabase
      .from('posts')
      .update({ likes: newLikesCount })
      .eq('id', postId);

    if (decrementError) {
      console.error('Decrement error:', decrementError);
      return res.status(500).json({ error: 'Failed to decrement likes' });
    }

    console.log('Like removed successfully. New count:', newLikesCount);
    res.json({ likes: newLikesCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to remove like' });
  }
});

// Increment views
router.post('/:id/views', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    console.log('Incrementing views for post:', postId);

    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('views')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch post' });
    }

    const newViewsCount = (post.views || 0) + 1;

    const { error: updateError } = await supabase
      .from('posts')
      .update({ views: newViewsCount })
      .eq('id', postId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update views' });
    }

    console.log('Views incremented successfully. New count:', newViewsCount);
    res.json({ views: newViewsCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to increment views' });
  }
});

// Get post likes status for user (helpful for UI)
router.get('/:id/likes/status', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    res.json({ liked: !!existingLike });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get like status' });
  }
});

// Get comments for a post
router.get('/:newId/comments', async (req: Request, res: Response) => {
  try {
    const { newId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    console.log('Fetching comments for post new_id:', newId, 'page:', page);

    // Get the post's integer ID
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('new_id', newId)
      .single();

    if (postError || !post) {
      console.log('Post not found with new_id:', newId);
      return res.status(404).json({ error: 'Post not found' });
    }

    const postId = post.id;

    // Fetch top-level comments (depth = 0)
    const { data: topLevelComments, error: commentError } = await supabase
      .from('comments')
      .select('id, post_id, user_id, parent_id, depth, content, created_at, updated_at, is_deleted')
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .eq('depth', 0)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (commentError) {
      console.error('Comments fetch error:', commentError);
      return res.status(500).json({ error: 'Failed to fetch comments' });
    }

    // Fetch all replies for the top-level comments
    const topLevelCommentIds = topLevelComments.map((c) => c.id);
    const { data: replies, error: repliesError } = await supabase
      .from('comments')
      .select('id, post_id, user_id, parent_id, depth, content, created_at, updated_at, is_deleted')
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .in('parent_id', topLevelCommentIds)
      .order('created_at', { ascending: true });

    if (repliesError) {
      console.error('Replies fetch error:', repliesError);
      return res.status(500).json({ error: 'Failed to fetch replies' });
    }

    // Fetch user info for all unique user_ids
    const userIds = [...new Set([...topLevelComments, ...replies].map((c) => c.user_id))];
    const users: { [key: string]: { id: string; email: string; full_name: string; profile_picture: string | null } } = {};
    for (const userId of userIds) {
      try {
        const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
        if (!userError && user) {
          users[userId] = {
            id: user.id,
            email: user.email ?? 'unknown@example.com',
            full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
            profile_picture: user.user_metadata?.profile_picture || null,
          };
        } else {
          users[userId] = {
            id: userId,
            email: 'unknown@example.com',
            full_name: 'Anonymous User',
            profile_picture: null,
          };
        }
      } catch (authError) {
        console.warn('Failed to get user info:', authError);
        users[userId] = {
          id: userId,
          email: 'unknown@example.com',
          full_name: 'Anonymous User',
          profile_picture: null,
        };
      }
    }

    // Build threaded structure
    const threadedComments = topLevelComments.map((comment) => ({
      ...comment,
      user: users[comment.user_id],
      replies: replies
        .filter((r) => r.parent_id === comment.id)
        .map((r) => ({
          ...r,
          user: users[r.user_id],
          replies: replies
            .filter((r2) => r2.parent_id === r.id)
            .map((r2) => ({
              ...r2,
              user: users[r2.user_id],
              replies: replies
                .filter((r3) => r3.parent_id === r2.id)
                .map((r3) => ({
                  ...r3,
                  user: users[r3.user_id],
                  replies: [], // Depth 3 has no replies
                })),
            })),
        })),
    }));

    const { count, error: countError } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .eq('depth', 0);

    if (countError) {
      console.error('Comments count error:', countError);
      return res.status(500).json({ error: 'Failed to get comments count' });
    }

    console.log('Fetched comments:', threadedComments.length);
    res.json({
      comments: threadedComments,
      hasMore: topLevelComments.length === limit,
      total: count || 0,
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Create a comment
router.post('/:newId/comments', authenticate, comprehensiveValidation, async (req: Request, res: Response) => {
  try {
    const { newId } = req.params;
    const userId = (req as any).user.id;
    const { content, parentId } = req.body;

    console.log('Creating comment for post new_id:', newId, 'by user:', userId, 'parentId:', parentId);

    if (!content || !content.trim()) {
      console.log('Missing or empty content');
      return res.status(400).json({ error: 'Comment content is required' });
    }

    // Verify the post exists and get the integer ID
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('new_id', newId)
      .single();

    if (postError || !post) {
      console.log('Post not found with new_id:', newId);
      return res.status(404).json({ error: 'Post not found' });
    }

    const postId = post.id;
    const sanitizedContent = sanitizeForDatabase(content);

    let depth = 0;
    let validatedParentId = null;

    // If replying to a comment, validate parent and calculate depth
    if (parentId) {
      const { data: parentComment, error: parentError } = await supabase
        .from('comments')
        .select('id, depth, is_deleted')
        .eq('id', parentId)
        .eq('post_id', postId)
        .single();

      if (parentError || !parentComment || parentComment.is_deleted) {
        console.log('Parent comment not found or deleted:', parentId);
        return res.status(404).json({ error: 'Parent comment not found' });
      }

      if (parentComment.depth >= 3) {
        console.log('Maximum reply depth reached for parent:', parentId);
        return res.status(400).json({ error: 'Maximum reply depth reached' });
      }

      depth = parentComment.depth + 1;
      validatedParentId = parentId;
    }

    // Create the comment
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        user_id: userId,
        parent_id: validatedParentId,
        depth,
        content: sanitizedContent,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (commentError) {
      console.error('Comment creation error:', commentError);
      return res.status(500).json({ error: 'Failed to create comment' });
    }

    // Get user information for the response
    let commentWithUser = comment;
    try {
      const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
      if (!userError && user) {
        commentWithUser = {
          ...comment,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
            profile_picture: user.user_metadata?.profile_picture || null,
          },
        };
      }
    } catch (authError) {
      console.warn('Failed to get user info for new comment:', authError);
      commentWithUser = {
        ...comment,
        user: {
          id: userId,
          email: 'unknown@example.com',
          full_name: 'Anonymous User',
          profile_picture: null,
        },
      };
    }

    console.log('Comment created successfully:', comment.id);
    res.status(201).json(commentWithUser);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Update a comment
router.put('/:newId/comments/:commentId', authenticate, comprehensiveValidation, async (req: Request, res: Response) => {
  try {
    const { newId, commentId } = req.params;
    const userId = (req as any).user.id;
    const { content } = req.body;

    console.log('Updating comment:', commentId, 'for post new_id:', newId, 'by user:', userId);

    if (!content || !content.trim()) {
      console.log('Missing or empty content');
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const sanitizedContent = sanitizeForDatabase(content);

    // Get the post's integer ID
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('new_id', newId)
      .single();

    if (postError || !post) {
      console.log('Post not found with new_id:', newId);
      return res.status(404).json({ error: 'Post not found' });
    }

    const postId = post.id;

    // Verify the comment exists and belongs to the user
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .select('user_id, is_deleted')
      .eq('id', commentId)
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .single();

    if (commentError || !comment) {
      console.log('Comment not found:', commentId);
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.user_id !== userId) {
      console.log('Unauthorized update attempt by user:', userId, 'for comment owned by:', comment.user_id);
      return res.status(403).json({ error: 'Not authorized to update this comment' });
    }

    // Update the comment
    const { error: updateError } = await supabase
      .from('comments')
      .update({
        content: sanitizedContent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commentId);

    if (updateError) {
      console.error('Comment update error:', updateError);
      return res.status(500).json({ error: 'Failed to update comment' });
    }

    console.log('Comment updated successfully:', commentId);
    res.json({ message: 'Comment updated successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment (soft delete)
router.delete('/:newId/comments/:commentId', authenticate, async (req: Request, res: Response) => {
  try {
    const { newId, commentId } = req.params;
    const userId = (req as any).user.id;

    console.log('Deleting comment:', commentId, 'for post new_id:', newId, 'by user:', userId);

    // Get the post's integer ID
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('new_id', newId)
      .single();

    if (postError || !post) {
      console.log('Post not found with new_id:', newId);
      return res.status(404).json({ error: 'Post not found' });
    }

    const postId = post.id;

    // Verify the comment exists
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .select('user_id, is_deleted')
      .eq('id', commentId)
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .single();

    if (commentError || !comment) {
      console.log('Comment not found:', commentId);
      return res.status(404).json({ error: 'Comment not found' });
    }

    let canDelete = comment.user_id === userId;

    if (!canDelete) {
      const { data: admin, error: adminError } = await supabase
        .from('admins')
        .select('*')
        .eq('email', (req as any).user.email)
        .eq('is_active', true)
        .single();

      canDelete = !adminError && admin;
    }

    if (!canDelete) {
      console.log('Unauthorized delete attempt by user:', userId, 'for comment owned by:', comment.user_id);
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    // Soft delete the comment and its replies
    const { error: deleteError } = await supabase
      .from('comments')
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commentId);

    if (deleteError) {
      console.error('Comment delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete comment' });
    }

    // Optionally, soft delete replies (if not handled by ON DELETE CASCADE)
    const { error: repliesDeleteError } = await supabase
      .from('comments')
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
      })
      .eq('parent_id', commentId);

    if (repliesDeleteError) {
      console.error('Replies delete error:', repliesDeleteError);
      return res.status(500).json({ error: 'Failed to delete replies' });
    }

    console.log('Comment deleted successfully:', commentId);
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Get comments count for a post
router.get('/:newId/comments/count', async (req: Request, res: Response) => {
  try {
    const newId = req.params.newId;

    console.log('Getting comments count for post new_id:', newId);

    // Get the post's integer ID
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('new_id', newId)
      .single();

    if (postError || !post) {
      console.log('Post not found with new_id:', newId);
      return res.status(404).json({ error: 'Post not found' });
    }

    const postId = post.id;

    const { count, error } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('is_deleted', false);

    if (error) {
      console.error('Comments count error:', error);
      return res.status(500).json({ error: 'Failed to get comments count' });
    }

    console.log('Comments count:', count);
    res.json({ count: count || 0 });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get comments count' });
  }
});


export default router;