import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('Missing or invalid authorization header');
      return res.status(401).json({ error: 'Auth session missing!' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!token) {
      console.log('Empty token provided');
      return res.status(401).json({ error: 'Auth session missing!' });
    }

    console.log('Verifying token for user...');
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) {
      console.log('Token verification error:', error.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!user) {
      console.log('No user found for token');
      return res.status(401).json({ error: 'User not found' });
    }

    console.log('User authenticated successfully:', user.id);
    
    // Attach user to request object
    (req as any).user = user;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};