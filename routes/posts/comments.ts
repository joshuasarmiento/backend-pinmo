import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../../utils/supabase';
import {
  comprehensiveValidation,
  sanitizeForDatabase
} from '../../middleware/advancedPostValidation';
import { authenticate } from '../../middleware/auth';
import { safeGetCache, safeSetCache, invalidateCommentCountCache, invalidateNotificationCache, autoInvalidateCache } from '../../utils/cache';

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
  };
};

// Batch get user info for multiple users
const getUsersInfo = async (userIds: string[]) => {
  const usersMap: Record<string, any> = {};
  
  const userPromises = userIds.map(async (userId) => {
    const userInfo = await getUserInfo(userId);
    usersMap[userId] = userInfo;
  });
  
  await Promise.all(userPromises);
  return usersMap;
};

// Get comments count for a post
router.get('/:newId/comments/count', async (req: Request, res: Response) => {
  try {
    const { newId } = req.params;

    // Create cache key
    const cacheKey = `comment-count:${newId}`;

    // Try to get from cache first
    const cached = safeGetCache(cacheKey);
    if (cached !== null && cached !== undefined) {
      return res.json({ count: cached });
    }

    // console.log('Fetching comment count for post new_id:', newId);

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

    // Get total comment count (all comments for this post, not just top-level)
    const { count, error: countError } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('is_deleted', false);

    if (countError) {
      console.error('Comment count error:', countError);
      return res.status(500).json({ error: 'Failed to get comment count' });
    }

    const commentCount = count || 0;

    // Cache the result for 2 minutes
    safeSetCache(cacheKey, commentCount, 120);

    // console.log('Comment count for post', newId, ':', commentCount);
    res.json({ count: commentCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch comment count' });
  }
});

// Get Comments
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

    console.log('Top-level comments fetched:', topLevelComments.length);

    // Get ALL comments for this post to build the tree structure
    // This is more efficient than multiple queries for each depth level
    const { data: allComments, error: allCommentsError } = await supabase
      .from('comments')
      .select('id, post_id, user_id, parent_id, depth, content, created_at, updated_at, is_deleted')
      .eq('post_id', postId)
      .eq('is_deleted', false)
      .gt('depth', 0) // Get all replies (depth > 0)
      .order('created_at', { ascending: true });

    if (allCommentsError) {
      console.error('All comments fetch error:', allCommentsError);
      return res.status(500).json({ error: 'Failed to fetch all comments' });
    }

    console.log('Total replies fetched:', allComments?.length || 0);

    // Create a map of comments by their IDs for quick lookup
    const commentsById = new Map();
    [...topLevelComments, ...(allComments || [])].forEach(comment => {
      commentsById.set(comment.id, { ...comment, replies: [] });
    });

    // Get user info for all unique user_ids
    const userIds = [...new Set([...topLevelComments, ...(allComments || [])].map((c) => c.user_id))];
    console.log('Fetching user info for', userIds.length, 'users');
    const users = await getUsersInfo(userIds);

    // Build the tree structure by connecting parents to children
    (allComments || []).forEach(comment => {
      if (comment.parent_id && commentsById.has(comment.parent_id)) {
        const parent = commentsById.get(comment.parent_id);
        const child = commentsById.get(comment.id);
        if (parent && child) {
          parent.replies.push(child);
        }
      }
    });

    // Get only the top-level comments with their nested replies
    const threadedComments = topLevelComments.map(topComment => {
      const commentWithReplies = commentsById.get(topComment.id);
      
      // Add user info recursively
      const addUserInfo = (comment: any): any => {
        return {
          ...comment,
          user: users[comment.user_id],
          replies: comment.replies.map((reply: any) => addUserInfo(reply))
        };
      };
      
      return addUserInfo(commentWithReplies);
    });

    // Log the structure for debugging
    const countReplies = (comments: any[]): number => {
      let count = 0;
      comments.forEach(comment => {
        count += comment.replies.length;
        count += countReplies(comment.replies);
      });
      return count;
    };
    
    console.log('Threaded structure built:', {
      topLevelComments: threadedComments.length,
      totalReplies: countReplies(threadedComments),
      depths: {
        depth0: threadedComments.length,
        depth1: threadedComments.reduce((sum, c) => sum + c.replies.length, 0),
        depth2: threadedComments.reduce((sum, c) => 
          sum + c.replies.reduce((s: number, r: any) => s + r.replies.length, 0), 0),
        depth3: threadedComments.reduce((sum, c) => 
          sum + c.replies.reduce((s: number, r: any) => 
            s + r.replies.reduce((s2: number, r2: any) => s2 + r2.replies.length, 0), 0), 0)
      }
    });

    // Get count of top-level comments for pagination
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

    console.log('Returning comments response with', threadedComments.length, 'top-level comments');
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

// Also add this helper function to ensure user exists in public.users table before creating comments
const ensureUserInPublicTable = async (userId: string, userEmail: string) => {
  try {
    // Check if user exists in public.users
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
        return false;
      }

      // Create user in public.users table with required fields
      const { error: createError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: authUser.email || userEmail || 'unknown@example.com',
          full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Anonymous',
          full_address: authUser.user_metadata?.full_address || 'Not specified',
          latitude: authUser.user_metadata?.latitude || 0,
          longitude: authUser.user_metadata?.longitude || 0,
          email_verified: authUser.email_confirmed_at ? true : false,
          profile_picture: authUser.user_metadata?.profile_picture || null
        });

      if (createError) {
        console.error('Failed to create user in public.users:', createError);
        return false;
      }
      
      console.log('User created in public.users table');
    }
    
    return true;
  } catch (error) {
    console.error('Error ensuring user in public table:', error);
    return false;
  }
};

// Update the CREATE comment route to ensure user exists in public.users
router.post('/:newId/comments', authenticate, comprehensiveValidation, autoInvalidateCache(req => req.user.id), async (req: Request, res: Response) => {
  try {
    const { newId } = req.params;
    const userId = (req as any).user.id;
    const userEmail = (req as any).user.email;
    const { content, parentId } = req.body;

    console.log('Creating comment for post new_id:', newId, 'by user:', userId, 'parentId:', parentId);

    // Ensure user exists in public.users table (to avoid foreign key constraint issues)
    const userExists = await ensureUserInPublicTable(userId, userEmail);
    if (!userExists) {
      return res.status(500).json({ error: 'Failed to sync user data. Please try logging out and back in.' });
    }

    if (!content || !content.trim()) {
      console.log('Missing or empty content');
      return res.status(400).json({ error: 'Comment content is required' });
    }

    // Verify the post exists and get the integer ID
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, user_id, new_id')
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
    let parentUserId: string | null = null;

    // If replying to a comment, validate parent and calculate depth
    if (parentId) {
      const { data: parentComment, error: parentError } = await supabase
        .from('comments')
        .select('id, depth, is_deleted, user_id')
        .eq('id', parentId)
        .eq('post_id', postId)
        .single();

      if (parentError || !parentComment || parentComment.is_deleted) {
        console.log('Parent comment not found or deleted:', parentId);
        return res.status(404).json({ error: 'Parent comment not found' });
      }

      if (parentComment.depth >= 3) {
        console.log('Maximum reply depth reached for parent:', parentId);
        return res.status(400).json({ error: 'Maximum reply depth reached (max 4 levels)' });
      }

      depth = parentComment.depth + 1;
      validatedParentId = parentId;
      parentUserId = parentComment.user_id;
      
      console.log('Creating reply at depth:', depth);
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
      
      // Check if it's a foreign key constraint error
      if (commentError.message?.includes('violates foreign key constraint')) {
        return res.status(500).json({ 
          error: 'User account needs to be synced. Please try logging out and back in.' 
        });
      }
      
      return res.status(500).json({ error: 'Failed to create comment' });
    }

    invalidateCommentCountCache(newId);

    // Rest of the notification logic remains the same...
    const { data: sourceUser, error: userError } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .single();

    if (!userError && sourceUser) {
      // Notify post owner if not the commenter
      if (post.user_id !== userId) {
        const { error: postNotificationError } = await supabase
          .from('notifications')
          .insert({
            user_id: post.user_id,
            type: 'comment',
            source_id: postId,
            source_new_id: post.new_id,
            source_user_id: userId,
            message: `${sourceUser.full_name} commented on your post`,
            created_at: new Date().toISOString()
          });

        if (postNotificationError) {
          console.warn('Failed to create comment notification:', postNotificationError);
        } else {
          invalidateNotificationCache(post.user_id);
        }
      }

      // Notify parent comment owner if reply and not the same user
      if (parentUserId && parentUserId !== userId && parentUserId !== post.user_id) {
        const { error: replyNotificationError } = await supabase
          .from('notifications')
          .insert({
            user_id: parentUserId,
            type: 'reply',
            source_id: comment.id,
            source_new_id: post.new_id,
            source_user_id: userId,
            message: `${sourceUser.full_name} replied to your comment`,
            created_at: new Date().toISOString()
          });

        if (replyNotificationError) {
          console.warn('Failed to create reply notification:', replyNotificationError);
        } else {
          invalidateNotificationCache(parentUserId);
        }
      }
    }

    // Get user information for the response
    const userInfo = await getUserInfo(userId);
    const commentWithUser = {
      ...comment,
      user: userInfo,
    };

    console.log('Comment created successfully:', comment.id, 'at depth:', depth);
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

    // ADD THIS LINE after successful comment deletion:
    invalidateCommentCountCache(newId);

    // Soft delete replies (if not handled by ON DELETE CASCADE)
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

export default router;