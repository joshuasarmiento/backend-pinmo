import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/:postId/views', authenticate, async (req: Request, res: Response) => {
  try {
    const { postId } = req.params;
    const userId = (req as any).user.id;

    const { data: post } = await supabase
      .from('posts')
      .select('id')
      .eq('id', parseInt(postId))
      .single();

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { data: existingView } = await supabase
      .from('post_views')
      .select('id')
      .eq('post_id', parseInt(postId))
      .eq('user_id', userId)
      .single();

    if (existingView) {
      return res.status(400).json({ error: 'View already recorded' });
    }

    const { data, error } = await supabase
      .from('post_views')
      .insert({
        post_id: parseInt(postId),
        user_id: userId,
        viewed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to record view' });
    }

    res.status(201).json({ message: 'View recorded' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record view' });
  }
});

export default router;