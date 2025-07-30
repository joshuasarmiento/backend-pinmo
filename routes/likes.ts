import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/:postId/likes', authenticate, async (req: Request, res: Response) => {
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

    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', parseInt(postId))
      .eq('user_id', userId)
      .single();

    if (existingLike) {
      return res.status(400).json({ error: 'Like already recorded' });
    }

    const { data, error } = await supabase
      .from('post_likes')
      .insert({
        post_id: parseInt(postId),
        user_id: userId,
        liked_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to record like' });
    }

    res.status(201).json({ message: 'Like recorded' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record like' });
  }
});

export default router;