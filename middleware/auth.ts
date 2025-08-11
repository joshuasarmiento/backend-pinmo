// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.log('No authorization header found');
      return res.status(401).json({ error: 'No authorization header' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.log('Invalid authorization header format:', authHeader);
      return res.status(401).json({ error: 'Invalid authorization header format' });
    }

    const token = authHeader.substring(7);
    
    if (!token || token.trim() === '' || token === 'null' || token === 'undefined') {
      console.log('Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }


    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      console.log('Token verification error:', error.message);
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!user) {
      console.log('No user found for token');
      return res.status(401).json({ error: 'User not found' });
    }

    (req as any).user = user;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};