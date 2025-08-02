"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../../utils/supabase");
const auth_1 = require("../../middleware/auth");
const cache_1 = require("../../utils/cache");
const router = (0, express_1.Router)();
// Add like
router.post('/:id/likes', auth_1.authenticate, (0, cache_1.autoInvalidateCache)(req => req.user.id), async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        console.log('Adding like to post:', postId, 'by user:', userId);
        // Check if user exists in users table
        const { data: userExists } = await supabase_1.supabase
            .from('users')
            .select('id')
            .eq('id', userId)
            .single();
        if (!userExists) {
            console.log('User not found in users table:', userId);
            return res.status(400).json({ error: 'User not found in database' });
        }
        // Check if user already liked this post
        const { data: existingLike } = await supabase_1.supabase
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
        const { error: likeError } = await supabase_1.supabase
            .from('post_likes')
            .insert({ post_id: postId, user_id: userId });
        if (likeError) {
            console.error('Like error:', likeError);
            return res.status(500).json({ error: 'Failed to add like' });
        }
        // Get current likes count and post info
        const { data: post, error: fetchError } = await supabase_1.supabase
            .from('posts')
            .select('likes, user_id, new_id')
            .eq('id', postId)
            .single();
        if (fetchError) {
            console.error('Fetch error:', fetchError);
            return res.status(500).json({ error: 'Failed to update likes count' });
        }
        const newLikesCount = (post.likes || 0) + 1;
        // Update likes count
        const { error: incrementError } = await supabase_1.supabase
            .from('posts')
            .update({ likes: newLikesCount })
            .eq('id', postId);
        if (incrementError) {
            console.error('Increment error:', incrementError);
            return res.status(500).json({ error: 'Failed to increment likes' });
        }
        // Create notification if not liking own post
        if (post.user_id !== userId) {
            const { data: sourceUser, error: userError } = await supabase_1.supabase
                .from('users')
                .select('full_name')
                .eq('id', userId)
                .single();
            if (!userError && sourceUser) {
                const { error: notificationError } = await supabase_1.supabase
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
                }
                else {
                    // Invalidate notification cache for post owner
                    (0, cache_1.invalidateNotificationCache)(post.user_id);
                }
            }
        }
        // Invalidate posts cache since likes count affects sorting
        (0, cache_1.invalidatePostsCache)();
        console.log('Like added successfully. New count:', newLikesCount);
        res.status(201).json({ likes: newLikesCount });
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to add like' });
    }
});
// Remove like
router.delete('/:id/likes', auth_1.authenticate, (0, cache_1.autoInvalidateCache)(req => req.user.id), async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        console.log('Removing like from post:', postId, 'by user:', userId);
        // Check if user has liked this post
        const { data: existingLike } = await supabase_1.supabase
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
        const { error: unlikeError } = await supabase_1.supabase
            .from('post_likes')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', userId);
        if (unlikeError) {
            console.error('Unlike error:', unlikeError);
            return res.status(500).json({ error: 'Failed to remove like' });
        }
        // Get current likes count
        const { data: post, error: fetchError } = await supabase_1.supabase
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
        const { error: decrementError } = await supabase_1.supabase
            .from('posts')
            .update({ likes: newLikesCount })
            .eq('id', postId);
        if (decrementError) {
            console.error('Decrement error:', decrementError);
            return res.status(500).json({ error: 'Failed to decrement likes' });
        }
        // Invalidate posts cache since likes count affects sorting
        (0, cache_1.invalidatePostsCache)();
        console.log('Like removed successfully. New count:', newLikesCount);
        res.json({ likes: newLikesCount });
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to remove like' });
    }
});
// Get post likes status for user (helpful for UI)
router.get('/:id/likes/status', auth_1.authenticate, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        console.log('Getting like status for post:', postId, 'user:', userId);
        const { data: existingLike } = await supabase_1.supabase
            .from('post_likes')
            .select('*')
            .eq('post_id', postId)
            .eq('user_id', userId)
            .single();
        res.json({ liked: !!existingLike });
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to get like status' });
    }
});
exports.default = router;
