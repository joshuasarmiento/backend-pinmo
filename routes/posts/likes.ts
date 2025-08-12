import { Router, Request, Response } from 'express';
import { supabase } from '../../utils/supabase';
import { authenticate } from '../../middleware/auth';
import { invalidateNotificationCache, autoInvalidateCache, invalidatePostsCache } from '../../utils/cache';
import { syncUserToPublicTable } from '../../middleware/syncUser';

const router = Router();

// Add like
router.post('/:id/likes', authenticate, syncUserToPublicTable, autoInvalidateCache(req => req.user.id), async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Adding like to post:', postId, 'by user:', userId);

    // FIRST: Verify the post exists before proceeding
    const { data: post, error: postFetchError } = await supabase
      .from('posts')
      .select('id, user_id, new_id, likes')
      .eq('id', postId)
      .single();

    if (postFetchError || !post) {
      console.error('Post not found:', postId, postFetchError);
      return res.status(404).json({ 
        error: 'Post not found',
        details: 'The post you are trying to like does not exist or has been deleted'
      });
    }

    // IMPORTANT: Ensure user exists in public.users table
    const { data: userExists } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
      
    if (!userExists) {
      console.log('User not found in public.users table, creating entry...');
      
      // Get user info from auth.users
      const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(userId);
      
      if (authError || !authUser) {
        console.error('Failed to get auth user:', authError);
        return res.status(400).json({ error: 'User authentication failed' });
      }

      // Create user in public.users table with required fields
      const { error: createError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: authUser.email || 'unknown@example.com',
          full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Anonymous',
          full_address: authUser.user_metadata?.full_address || 'Not specified',
          latitude: authUser.user_metadata?.latitude || 0,
          longitude: authUser.user_metadata?.longitude || 0,
          email_verified: authUser.email_confirmed_at ? true : false,
          profile_picture: authUser.user_metadata?.profile_picture || null
        });

      if (createError) {
        console.error('Failed to create user in public.users:', createError);
        return res.status(500).json({ error: 'Failed to sync user data' });
      }
      
      console.log('User created in public.users table');
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
    const { data: likeData, error: likeError } = await supabase
      .from('post_likes')
      .insert({ 
        post_id: postId, 
        user_id: userId 
      })
      .select()
      .single();

    if (likeError) {
      console.error('Like error details:', {
        code: likeError.code,
        message: likeError.message,
        details: likeError.details,
        hint: likeError.hint
      });
      return res.status(500).json({ error: 'Failed to add like: ' + likeError.message });
    }

    console.log('Like record created:', likeData);

    // Calculate new likes count
    const newLikesCount = (post.likes || 0) + 1;

    // Update likes count (we already have the post data, so we know it exists)
    const { data: updatedPost, error: incrementError } = await supabase
      .from('posts')
      .update({ likes: newLikesCount })
      .eq('id', postId)
      .select('likes')
      .single();

    if (incrementError) {
      console.error('Increment error:', incrementError);
      // Rollback the like
      await supabase
        .from('post_likes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId);
      return res.status(500).json({ error: 'Failed to increment likes' });
    }

    // Create notification if not liking own post
    if (post.user_id !== userId) {
      const { data: sourceUser, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', userId)
        .single();

      if (!userError && sourceUser) {
        const { error: notificationError } = await supabase
          .from('notifications')
          .insert({
            user_id: post.user_id,
            type: 'like',
            source_id: postId,
            source_new_id: post.new_id,
            source_user_id: userId,
            message: `${sourceUser.full_name} liked your post`,
            created_at: new Date().toISOString()
          });

        if (notificationError) {
          console.warn('Failed to create like notification:', notificationError);
        } else {
          // Invalidate notification cache for post owner
          invalidateNotificationCache(post.user_id);
        }
      }
    }

    // Invalidate posts cache since likes count affects sorting
    invalidatePostsCache();

    console.log('Like added successfully. New count:', newLikesCount);
    res.status(201).json({ likes: newLikesCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to add like' });
  }
});

// Remove like
router.delete('/:id/likes', authenticate, autoInvalidateCache(req => req.user.id), async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Removing like from post:', postId, 'by user:', userId);

    // Ensure user exists in public.users (same check as above)
    const { data: userExists } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
      
    if (!userExists) {
      console.log('User not found in public.users table');
      return res.status(400).json({ error: 'User data not synced' });
    }

    // Rest of the delete logic...
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
      return res.status(500).json({ error: 'Failed to remove like: ' + unlikeError.message });
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
    const { data: updatedPost, error: decrementError } = await supabase
      .from('posts')
      .update({ likes: newLikesCount })
      .eq('id', postId)
      .select('likes')
      .single();

    if (decrementError) {
      console.error('Decrement error:', decrementError);
      return res.status(500).json({ error: 'Failed to decrement likes' });
    }

    console.log('Like removed successfully. New count:', newLikesCount);
    res.json({ likes: newLikesCount, liked: false });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to remove like' });
  }
});

// Get likes count for a post (similar to views endpoint)
router.get('/:id/likes', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('likes')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch post likes' });
    }

    if (!post) {
      console.log('Post not found:', postId);
      return res.status(404).json({ error: 'Post not found' });
    }

    const likesCount = post.likes || 0;

    res.json({ likes: likesCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get likes count' });
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

export default router;