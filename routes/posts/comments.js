"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../../utils/supabase");
const advancedPostValidation_1 = require("../../middleware/advancedPostValidation");
const auth_1 = require("../../middleware/auth");
const cache_1 = require("../../utils/cache");
const router = (0, express_1.Router)();
// Utility function to get user info consistently
const getUserInfo = async (userId) => {
    var _a, _b, _c;
    try {
        const { data: { user }, error: userError } = await supabase_1.supabase.auth.admin.getUserById(userId);
        if (!userError && user) {
            return {
                id: user.id,
                email: user.email || 'unknown@example.com',
                full_name: ((_a = user.user_metadata) === null || _a === void 0 ? void 0 : _a.full_name) || ((_b = user.email) === null || _b === void 0 ? void 0 : _b.split('@')[0]) || 'Anonymous',
                profile_picture: ((_c = user.user_metadata) === null || _c === void 0 ? void 0 : _c.profile_picture) || null,
            };
        }
    }
    catch (authError) {
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
const getUsersInfo = async (userIds) => {
    const usersMap = {};
    const userPromises = userIds.map(async (userId) => {
        const userInfo = await getUserInfo(userId);
        usersMap[userId] = userInfo;
    });
    await Promise.all(userPromises);
    return usersMap;
};
// Get comments count for a post
router.get('/:newId/comments/count', async (req, res) => {
    try {
        const { newId } = req.params;
        console.log('Fetching comment count for post new_id:', newId);
        // Get the post's integer ID
        const { data: post, error: postError } = await supabase_1.supabase
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
        const { count, error: countError } = await supabase_1.supabase
            .from('comments')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', postId)
            .eq('is_deleted', false);
        if (countError) {
            console.error('Comment count error:', countError);
            return res.status(500).json({ error: 'Failed to get comment count' });
        }
        console.log('Comment count for post', newId, ':', count);
        res.json({ count: count || 0 });
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to fetch comment count' });
    }
});
// Get comments for a post
router.get('/:newId/comments', async (req, res) => {
    try {
        const { newId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        console.log('Fetching comments for post new_id:', newId, 'page:', page);
        // Get the post's integer ID
        const { data: post, error: postError } = await supabase_1.supabase
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
        const { data: topLevelComments, error: commentError } = await supabase_1.supabase
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
        let replies = [];
        if (topLevelCommentIds.length > 0) {
            const { data: repliesData, error: repliesError } = await supabase_1.supabase
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
            replies = repliesData || [];
        }
        // Get user info for all unique user_ids
        const userIds = [...new Set([...topLevelComments, ...replies].map((c) => c.user_id))];
        const users = await getUsersInfo(userIds);
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
        const { count, error: countError } = await supabase_1.supabase
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
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});
// Create a comment
router.post('/:newId/comments', auth_1.authenticate, advancedPostValidation_1.comprehensiveValidation, (0, cache_1.autoInvalidateCache)(req => req.user.id), async (req, res) => {
    try {
        const { newId } = req.params;
        const userId = req.user.id;
        const { content, parentId } = req.body;
        console.log('Creating comment for post new_id:', newId, 'by user:', userId, 'parentId:', parentId);
        if (!content || !content.trim()) {
            console.log('Missing or empty content');
            return res.status(400).json({ error: 'Comment content is required' });
        }
        // Verify the post exists and get the integer ID
        const { data: post, error: postError } = await supabase_1.supabase
            .from('posts')
            .select('id, user_id, new_id')
            .eq('new_id', newId)
            .single();
        if (postError || !post) {
            console.log('Post not found with new_id:', newId);
            return res.status(404).json({ error: 'Post not found' });
        }
        const postId = post.id;
        const sanitizedContent = (0, advancedPostValidation_1.sanitizeForDatabase)(content);
        let depth = 0;
        let validatedParentId = null;
        let parentUserId = null;
        // If replying to a comment, validate parent and calculate depth
        if (parentId) {
            const { data: parentComment, error: parentError } = await supabase_1.supabase
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
                return res.status(400).json({ error: 'Maximum reply depth reached' });
            }
            depth = parentComment.depth + 1;
            validatedParentId = parentId;
            parentUserId = parentComment.user_id;
        }
        // Create the comment
        const { data: comment, error: commentError } = await supabase_1.supabase
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
        const { data: sourceUser, error: userError } = await supabase_1.supabase
            .from('users')
            .select('full_name')
            .eq('id', userId)
            .single();
        if (!userError && sourceUser) {
            // Notify post owner if not the commenter
            if (post.user_id !== userId) {
                const { error: postNotificationError } = await supabase_1.supabase
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
                }
                else {
                    // Invalidate notification cache for post owner
                    (0, cache_1.invalidateNotificationCache)(post.user_id);
                }
            }
            // Notify parent comment owner if reply and not the same user
            if (parentUserId && parentUserId !== userId && parentUserId !== post.user_id) {
                const { error: replyNotificationError } = await supabase_1.supabase
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
                }
                else {
                    // Invalidate notification cache for parent comment owner
                    (0, cache_1.invalidateNotificationCache)(parentUserId);
                }
            }
        }
        // Get user information for the response
        const userInfo = await getUserInfo(userId);
        const commentWithUser = {
            ...comment,
            user: userInfo,
        };
        console.log('Comment created successfully:', comment.id);
        res.status(201).json(commentWithUser);
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
});
// Update a comment
router.put('/:newId/comments/:commentId', auth_1.authenticate, advancedPostValidation_1.comprehensiveValidation, async (req, res) => {
    try {
        const { newId, commentId } = req.params;
        const userId = req.user.id;
        const { content } = req.body;
        console.log('Updating comment:', commentId, 'for post new_id:', newId, 'by user:', userId);
        if (!content || !content.trim()) {
            console.log('Missing or empty content');
            return res.status(400).json({ error: 'Comment content is required' });
        }
        const sanitizedContent = (0, advancedPostValidation_1.sanitizeForDatabase)(content);
        // Get the post's integer ID
        const { data: post, error: postError } = await supabase_1.supabase
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
        const { data: comment, error: commentError } = await supabase_1.supabase
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
        const { error: updateError } = await supabase_1.supabase
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
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to update comment' });
    }
});
// Delete a comment (soft delete)
router.delete('/:newId/comments/:commentId', auth_1.authenticate, async (req, res) => {
    try {
        const { newId, commentId } = req.params;
        const userId = req.user.id;
        console.log('Deleting comment:', commentId, 'for post new_id:', newId, 'by user:', userId);
        // Get the post's integer ID
        const { data: post, error: postError } = await supabase_1.supabase
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
        const { data: comment, error: commentError } = await supabase_1.supabase
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
            const { data: admin, error: adminError } = await supabase_1.supabase
                .from('admins')
                .select('*')
                .eq('email', req.user.email)
                .eq('is_active', true)
                .single();
            canDelete = !adminError && admin;
        }
        if (!canDelete) {
            console.log('Unauthorized delete attempt by user:', userId, 'for comment owned by:', comment.user_id);
            return res.status(403).json({ error: 'Not authorized to delete this comment' });
        }
        // Soft delete the comment and its replies
        const { error: deleteError } = await supabase_1.supabase
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
        // Soft delete replies (if not handled by ON DELETE CASCADE)
        const { error: repliesDeleteError } = await supabase_1.supabase
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
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});
exports.default = router;
