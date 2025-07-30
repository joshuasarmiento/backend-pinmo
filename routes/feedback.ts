import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/:postId/feedback', authenticate, async (req: Request, res: Response) => {
  try {
    const { postId } = req.params;
    const { action, description } = req.body;
    const userId = (req as any).user.id;

    const { data: post } = await supabase
      .from('posts')
      .select('id')
      .eq('id', parseInt(postId))
      .single();

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { data, error } = await supabase
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

export default router;