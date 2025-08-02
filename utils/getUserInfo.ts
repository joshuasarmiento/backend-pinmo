import { supabase } from './supabase';

export const getUserInfo = async (userId: string) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
    
    if (!userError && user) {
      return {
        id: user.id,
        email: user.email || 'unknown@example.com',
        full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
        profile_picture: user.user_metadata?.profile_picture || null,
        email_verified: user.email_confirmed_at ? true : false
      };
    }
  } catch (authError) {
    console.warn('Failed to get user info for:', userId, authError);
  }
  
  return {
    id: userId,
    email: 'unknown@example.com',
    full_name: 'Anonymous User',
    profile_picture: null,
    email_verified: false
  };
};
