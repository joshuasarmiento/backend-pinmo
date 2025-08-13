// middleware/optionalAuth.ts
import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';

export const optionalAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided - continue as anonymous user
      console.log('🔓 No auth token provided, continuing as anonymous');
      return next();
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token || token === 'null' || token === 'undefined') {
      // Invalid token - continue as anonymous user
      console.log('🔓 Invalid token provided, continuing as anonymous');
      return next();
    }

    // Verify the token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      // Token verification failed - continue as anonymous user
      console.log('🔓 Token verification failed, continuing as anonymous:', error?.message);
      return next();
    }

    // Token is valid - attach user to request
    (req as any).user = user;
    console.log('🔐 User authenticated:', user.id);
    
    next();
  } catch (error) {
    // Any error - continue as anonymous user
    console.warn('🔓 Auth middleware error, continuing as anonymous:', error);
    next();
  }
};