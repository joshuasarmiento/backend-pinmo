"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../utils/supabase");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post('/:postId/feedback', auth_1.authenticate, async (req, res) => {
    try {
        const { postId } = req.params;
        const { action, description } = req.body;
        const userId = req.user.id;
        const { data: post } = await supabase_1.supabase
            .from('posts')
            .select('id')
            .eq('id', parseInt(postId))
            .single();
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        const { data, error } = await supabase_1.supabase
            .from('posts_feedback')
            .insert({
            post_id: parseInt(postId),
            action,
            description,
            created_at: new Date().toISOString()
        })
            .select()
            .single();
        if (error) {
            return res.status(500).json({ error: 'Failed to submit feedback' });
        }
        res.status(201).json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});
exports.default = router;
