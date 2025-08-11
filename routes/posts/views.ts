import { Router, Request, Response } from 'express';
import { supabase } from '../../utils/supabase';
import { invalidatePostsCache, invalidateSinglePostCache } from '../../utils/cache';

const router = Router();

// Increment views
router.post('/:id/views', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    // Get current post data including new_id for cache invalidation
    const { data: post, error: fetchError } = await supabase
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

    const { error: updateError } = await supabase
      .from('posts')
      .update({ views: newViewsCount })
      .eq('id', postId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update views' });
    }

    // Invalidate relevant caches since view count has changed
    invalidatePostsCache(); // Since views might affect sorting
    if (post.new_id) {
      invalidateSinglePostCache(post.new_id);
    }

    res.json({ views: newViewsCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to increment views' });
  }
});

// Get views count for a post
router.get('/:id/views', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    const { data: post, error: fetchError } = await supabase
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

    res.json({ views: viewsCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get views count' });
  }
});

export default router;