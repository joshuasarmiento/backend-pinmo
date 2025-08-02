"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../../utils/supabase");
const cache_1 = require("../../utils/cache");
const router = (0, express_1.Router)();
// Increment views
router.post('/:id/views', async (req, res) => {
    try {
        const postId = req.params.id;
        console.log('Incrementing views for post:', postId);
        // Get current post data including new_id for cache invalidation
        const { data: post, error: fetchError } = await supabase_1.supabase
            .from('posts')
            .select('views, new_id')
            .eq('id', postId)
            .single();
        if (fetchError) {
            console.error('Fetch error:', fetchError);
            return res.status(500).json({ error: 'Failed to fetch post' });
        }
        if (!post) {
            console.log('Post not found:', postId);
            return res.status(404).json({ error: 'Post not found' });
        }
        const newViewsCount = (post.views || 0) + 1;
        const { error: updateError } = await supabase_1.supabase
            .from('posts')
            .update({ views: newViewsCount })
            .eq('id', postId);
        if (updateError) {
            console.error('Update error:', updateError);
            return res.status(500).json({ error: 'Failed to update views' });
        }
        // Invalidate relevant caches since view count has changed
        (0, cache_1.invalidatePostsCache)(); // Since views might affect sorting
        if (post.new_id) {
            (0, cache_1.invalidateSinglePostCache)(post.new_id);
        }
        console.log('Views incremented successfully. New count:', newViewsCount);
        res.json({ views: newViewsCount });
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to increment views' });
    }
});
// Get views count for a post
router.get('/:id/views', async (req, res) => {
    try {
        const postId = req.params.id;
        console.log('Getting views count for post:', postId);
        const { data: post, error: fetchError } = await supabase_1.supabase
            .from('posts')
            .select('views')
            .eq('id', postId)
            .single();
        if (fetchError) {
            console.error('Fetch error:', fetchError);
            return res.status(500).json({ error: 'Failed to fetch post views' });
        }
        if (!post) {
            console.log('Post not found:', postId);
            return res.status(404).json({ error: 'Post not found' });
        }
        const viewsCount = post.views || 0;
        console.log('Views count for post:', postId, '=', viewsCount);
        res.json({ views: viewsCount });
    }
    catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Failed to get views count' });
    }
});
exports.default = router;
