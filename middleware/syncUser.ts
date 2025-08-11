import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';

export const syncUserToPublicTable = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return next();

    // Check if user exists in public.users
    const { data: userExists } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (!userExists) {
      // Get user from auth
      const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(userId);
      
      if (!authError && authUser) {
        // Create user in public.users
        await supabase
          .from('users')
          .insert({
            id: userId,
            email: authUser.email || 'unknown@example.com',
            full_name: authUser.user_metadata?.full_name || 'Anonymous',
            full_address: 'Not specified',
            latitude: 0,
            longitude: 0,
            email_verified: authUser.email_confirmed_at ? true : false,
            profile_picture: authUser.user_metadata?.profile_picture || null
          });
      }
    }
    
    next();
  } catch (error) {
    console.error('User sync error:', error);
    next(); // Continue even if sync fails
  }
};