import { Router, Request, Response } from 'express';
import { supabase } from '../../utils/supabase';
// import { authenticate } from '../middleware/auth';

const router = Router();

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


export default router;