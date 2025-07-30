import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const { data: admin } = await supabase
      .from('admins')
      .select('id')
      .eq('id', userId)
      .single();

    if (!admin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabase
      .from('admins')
      .select('*');

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch admins' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

export default router;