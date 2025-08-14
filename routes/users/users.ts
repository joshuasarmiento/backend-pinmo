import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../../utils/supabase';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/auth';

const router = Router();
const SALT_ROUNDS = 10;
const PROFILE_UPDATE_COOLDOWN_DAYS = 30;

const url = process.env.NODE_ENV === 'production' 
  ? 'https://pin-oy.vercel.app' 
  : 'http://localhost:5173'

const canUpdateProfile = (lastUpdated: string | null): { canUpdate: boolean; daysRemaining: number } => {
  if (!lastUpdated) {
    return { canUpdate: true, daysRemaining: 0 };
  }
  
  const lastUpdateDate = new Date(lastUpdated);
  const now = new Date();
  const daysSinceUpdate = Math.floor((now.getTime() - lastUpdateDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, PROFILE_UPDATE_COOLDOWN_DAYS - daysSinceUpdate);
  
  return {
    canUpdate: daysSinceUpdate >= PROFILE_UPDATE_COOLDOWN_DAYS,
    daysRemaining
  };
};

// Utility function to sync profile data with Supabase Auth
const syncProfileWithAuth = async (userId: string, profileData: any) => {
  try {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        full_name: profileData.full_name,
        profile_picture: profileData.profile_picture,
        avatar_url: profileData.profile_picture, // Some systems use avatar_url
        full_address: profileData.full_address,
        latitude: profileData.latitude,
        longitude: profileData.longitude,
      }
    });

    if (error) {
      console.warn(`Failed to sync profile with auth for user ${userId}:`, error.message);
      return false;
    }

    console.log(`Profile synced with auth successfully for user ${userId}`);
    return true;
  } catch (error) {
    console.warn(`Auth sync error for user ${userId}:`, error);
    return false;
  }
};

// Utility function to get the most complete user data from both sources
const getCompleteUserData = async (userId: string) => {
  try {
    // Get data from both sources
    const [dbResult, authResult] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).single(),
      supabase.auth.admin.getUserById(userId)
    ]);

    const dbUser = dbResult.data;
    const authUser = authResult.data?.user;
    
    if (!authUser) {
      return { data: dbUser, source: 'database' };
    }

    // If no database user, return auth data
    if (!dbUser) {
      return {
        data: {
          id: authUser.id,
          email: authUser.email,
          full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0],
          profile_picture: authUser.user_metadata?.profile_picture || authUser.user_metadata?.avatar_url,
          full_address: authUser.user_metadata?.full_address || '',
          latitude: authUser.user_metadata?.latitude || 0,
          longitude: authUser.user_metadata?.longitude || 0,
          email_verified: !!authUser.email_confirmed_at,
          created_at: authUser.created_at,
        },
        source: 'auth'
      };
    }

    // Merge data, preferring database but filling gaps with auth data
    const mergedData = {
      ...dbUser,
      // Use auth profile picture if database doesn't have one
      profile_picture: dbUser.profile_picture || 
                      authUser.user_metadata?.profile_picture || 
                      authUser.user_metadata?.avatar_url,
      // Use auth email verification status
      email_verified: !!authUser.email_confirmed_at,
    };

    return { data: mergedData, source: 'merged' };
  } catch (error) {
    console.error('Error getting complete user data:', error);
    return { data: null, source: 'error' };
  }
};

// Configure multer for profile picture uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helper function to upload profile picture to Supabase Storage
async function uploadProfilePicture(file: Express.Multer.File, userId: string): Promise<string> {
  try {
    const fileName = `${userId}/${uuidv4()}-${file.originalname}`;
    const filePath = `profile-pictures/${fileName}`;

    const { data, error } = await supabase.storage
      .from('pinmo-images')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      throw new Error(`Failed to upload profile picture: ${error.message}`);
    }

    // Get public URL
    const { data: publicData } = supabase.storage
      .from('pinmo-images')
      .getPublicUrl(filePath);

    return publicData.publicUrl;
  } catch (error) {
    console.error('Upload helper error:', error);
    throw error;
  }
}

// Register endpoint with password hashing
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { full_name, email, password, full_address, latitude, longitude } = req.body;

    // Validate required fields
    if (!full_name || !email || !password || !full_address || !latitude || !longitude) {
      console.log('Missing required fields:', { full_name, email, password: !!password, full_address, latitude, longitude });
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      console.log('User already exists:', email);
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { 
          full_name, 
          full_address, 
          latitude, 
          longitude 
        },
        emailRedirectTo: process.env.NODE_ENV === 'production' 
          ? 'https://pin-oy.vercel.app' 
          : 'http://localhost:5173'
      }
    });

    if (error) {
      console.error('Supabase signup error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!data.user) {
      console.error('No user returned from signup');
      return res.status(500).json({ error: 'User creation failed' });
    }

    console.log('User registration completed successfully');
    res.status(201).json({ message: 'User registered', userId: data.user.id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Forgot Password endpoint
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      console.log('Missing email field');
      return res.status(400).json({ error: 'Email is required' });
    }

    console.log('Attempting to send reset email for:', email);

    // Send password reset email via Supabase Auth
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${url}/reset-password`
    });

    if (authError) {
      console.error('Supabase reset password email error:', authError);
      
      // Handle specific Supabase Auth errors
      if (authError.message.includes('User not found') || 
          authError.message.includes('user_not_found') ||
          authError.message.includes('Invalid email')) {
        return res.status(404).json({ error: 'No account found with this email address' });
      }
      
      return res.status(500).json({ error: 'Failed to send reset email' });
    }

    console.log('Reset email sent successfully for:', email);
    res.status(200).json({ message: 'Password reset email sent' });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to initiate password reset' });
  }
});

// Reset Password endpoint
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    // Validate inputs
    if (!token || !newPassword) {
      console.log('Missing token or newPassword');
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    // Find user by reset token
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, reset_password_expires')
      .eq('reset_password_token', token)
      .single();

    if (userError || !user) {
      console.log('Invalid or expired token');
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Check if token is expired
    const expiresAt = new Date(user.reset_password_expires);
    if (expiresAt < new Date()) {
      console.log('Token expired for user:', user.email);
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    console.log('New password hashed for user:', user.email);

    // Update password in Supabase Auth
    const { error: authError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword
    });

    if (authError) {
      console.error('Supabase password update error:', authError);
      return res.status(500).json({ error: 'Failed to update password' });
    }

    // Update users table
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        reset_password_token: null,
        reset_password_expires: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Database update error:', updateError);
      return res.status(500).json({ error: 'Failed to update user data' });
    }

    console.log('Password reset successfully for user:', user.email);
    res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Login user
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.user) {
      console.log('Login failed:', error?.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if email is verified
    if (!data.user.email_confirmed_at) {
      console.log('Email not verified for user:', data.user.id);
      return res.status(403).json({ error: 'Email not verified' });
    }

    console.log('Login completed successfully');
    res.json({
      message: 'Login successful',
      userId: data.user.id,
      accessToken: data.session?.access_token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Update profile - FIXED to preserve profile picture
router.put('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const { full_name, email, full_address, latitude, longitude } = req.body;
    const userId = (req as any).user.id;

    console.log('Updating profile for user:', userId, { full_name, email, full_address, latitude, longitude });

    // Get existing user data first to preserve profile picture
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, profile_updated_at, created_at, profile_picture')
      .eq('id', userId)
      .single();

    let lastProfileUpdate = null;
    let existingProfilePicture = null;
    
    if (fetchError && fetchError.code === 'PGRST116') {
      // User doesn't exist in users table - get profile picture from auth if available
      console.log('User not found in users table, checking auth for profile picture...');
      
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      if (authUser.user && authUser.user.user_metadata) {
        existingProfilePicture = authUser.user.user_metadata.profile_picture || 
                                authUser.user.user_metadata.avatar_url || null;
      }
    } else if (fetchError) {
      console.error('Database fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    } else {
      // User exists, preserve their profile picture and check cooldown
      existingProfilePicture = existingUser.profile_picture;
      lastProfileUpdate = existingUser.profile_updated_at || existingUser.created_at;
      
      const { canUpdate, daysRemaining } = canUpdateProfile(lastProfileUpdate);
      
      if (!canUpdate) {
        console.log(`Profile update blocked for user ${userId}. Days remaining: ${daysRemaining}`);
        return res.status(429).json({ 
          error: `Profile can only be updated once every ${PROFILE_UPDATE_COOLDOWN_DAYS} days. Please wait ${daysRemaining} more days.`,
          daysRemaining,
          nextUpdateDate: new Date(Date.now() + (daysRemaining * 24 * 60 * 60 * 1000)).toISOString()
        });
      }
    }

    const now = new Date().toISOString();

    if (!existingUser) {
      // User doesn't exist, create them (preserving profile picture from auth)
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: userId,
          full_name,
          email,
          full_address,
          latitude,
          longitude,
          profile_picture: existingProfilePicture, // Preserve profile picture
          email_verified: true,
          created_at: now,
          updated_at: now,
          profile_updated_at: now
        });

      if (insertError) {
        console.error('Database insert error:', insertError);
        return res.status(500).json({ error: 'Failed to create user profile' });
      }
      
      console.log('User profile created successfully with preserved profile picture');
    } else {
      // User exists, update them (preserving profile picture)
      const { error: updateError } = await supabase
        .from('users')
        .update({
          full_name,
          email,
          full_address,
          latitude,
          longitude,
          // Don't update profile_picture here - it should only be updated via the dedicated endpoint
          updated_at: now,
          profile_updated_at: now
        })
        .eq('id', userId);

      if (updateError) {
        console.error('Database update error:', updateError);
        return res.status(500).json({ error: 'Failed to update user profile' });
      }
      
      console.log('User profile updated successfully, profile picture preserved');
    }

    res.json({ 
      message: 'Profile updated successfully',
      nextUpdateDate: new Date(Date.now() + (PROFILE_UPDATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)).toISOString()
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// Upload profile picture - FIXED to sync with auth
router.post('/profile/picture', authenticate, upload.single('profile_picture'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const file = req.file as Express.Multer.File;

    if (!file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Uploading profile picture for user:', userId);

    // Upload file to Supabase Storage
    const profilePictureUrl = await uploadProfilePicture(file, userId);
    
    console.log('Profile picture uploaded to storage:', profilePictureUrl);

    // First, check if user exists in users table
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, full_name, email, full_address, latitude, longitude')
      .eq('id', userId)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      // User doesn't exist in users table, create them with profile picture
      console.log('User not found in users table, creating entry with profile picture...');
      
      // Get user data from auth to create the profile
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      
      const newUserData = {
        id: userId,
        full_name: authUser.user?.user_metadata?.full_name || authUser.user?.email?.split('@')[0] || 'User',
        email: authUser.user?.email || '',
        full_address: authUser.user?.user_metadata?.full_address || '',
        latitude: authUser.user?.user_metadata?.latitude || 0,
        longitude: authUser.user?.user_metadata?.longitude || 0,
        profile_picture: profilePictureUrl,
        email_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error: insertError } = await supabase
        .from('users')
        .insert(newUserData);

      if (insertError) {
        console.error('Database insert error:', insertError);
        return res.status(500).json({ error: 'Failed to create user profile with picture' });
      }
      
      console.log('User profile created with profile picture successfully');
    } else if (fetchError) {
      console.error('Database fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    } else {
      // User exists, update profile picture
      console.log('User found in users table, updating profile picture...');
      
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
          profile_picture: profilePictureUrl, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', userId);

      if (updateError) {
        console.error('Database profile picture update error:', updateError);
        return res.status(500).json({ error: 'Failed to save profile picture' });
      }
      
      console.log('Profile picture updated in database successfully');
    }

    // IMPORTANT: Update Supabase Auth user metadata to keep it in sync
    try {
      const { error: authUpdateError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { 
          profile_picture: profilePictureUrl,
          avatar_url: profilePictureUrl // Some systems use avatar_url
        }
      });

      if (authUpdateError) {
        console.warn('Failed to update auth metadata (non-critical):', authUpdateError.message);
        // Don't fail the request if auth metadata update fails
      } else {
        console.log('Auth metadata updated successfully with new profile picture');
      }
    } catch (authError) {
      console.warn('Auth metadata update failed (non-critical):', authError);
      // Continue with success response even if auth metadata update fails
    }

    res.json({ 
      message: 'Profile picture updated successfully', 
      profile_picture: profilePictureUrl 
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    
    // Provide specific error messages
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    res.status(500).json({ error: 'Failed to upload profile picture' });
  }
});

// Get user profile - FIXED to handle profile picture properly
router.get('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    console.log('Fetching complete profile for user:', userId);
    
    const { data: userData, source } = await getCompleteUserData(userId);
    
    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If we got data from auth or merged, and there's missing database entry, create it
    if (source === 'auth' || source === 'merged') {
      console.log(`Creating/updating database entry from ${source} data...`);
      
      const { error: upsertError } = await supabase
        .from('users')
        .upsert({
          id: userId,
          full_name: userData.full_name,
          email: userData.email,
          full_address: userData.full_address,
          latitude: userData.latitude,
          longitude: userData.longitude,
          profile_picture: userData.profile_picture,
          email_verified: userData.email_verified,
          created_at: userData.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (upsertError) {
        console.warn('Failed to sync user to database:', upsertError);
        // Continue anyway, return the merged data
      } else {
        console.log('User data synced to database successfully');
      }
    }

    // If user exists but profile picture is missing, restore it from auth
    if (!userData.profile_picture && source === 'database') {
      console.log('Profile picture missing in database, checking auth metadata...');
      
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      
      if (authUser.user && authUser.user.user_metadata) {
        const profilePictureFromAuth = authUser.user.user_metadata.profile_picture || 
                                      authUser.user.user_metadata.avatar_url;
        
        if (profilePictureFromAuth) {
          console.log('Found profile picture in auth metadata, updating database...');
          
          // Update the database with the profile picture from auth
          const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ 
              profile_picture: profilePictureFromAuth,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId)
            .select()
            .single();
          
          if (!updateError && updatedUser) {
            console.log('Profile picture restored from auth metadata');
            return res.json({ user: updatedUser });
          }
        }
      }
    }

    console.log('Profile fetched successfully:', userData?.full_name);
    res.json({ user: userData });
  } catch (error) {
    console.error('Profile endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get user profile by ID (public access)
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;

    const { data: userData, error } = await supabase
      .from('users')
      .select('id, full_name, email, profile_picture, full_address, latitude, longitude, email_verified, created_at')
      .eq('id', userId)
      .single();

    if (error || !userData) {
      console.error('Profile fetch error:', error?.message || 'No user found');
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: userData });
  } catch (error) {
    console.error('Public profile endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Get profile update status
router.get('/profile/update-status', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const { data: userData, error } = await supabase
      .from('users')
      .select('profile_updated_at, created_at')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Database fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    const lastUpdate = userData?.profile_updated_at || userData?.created_at;
    const { canUpdate, daysRemaining } = canUpdateProfile(lastUpdate);

    res.json({
      canUpdate,
      daysRemaining,
      lastUpdate,
      nextUpdateDate: lastUpdate 
        ? new Date(new Date(lastUpdate).getTime() + (PROFILE_UPDATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)).toISOString()
        : null,
      cooldownDays: PROFILE_UPDATE_COOLDOWN_DAYS
    });
  } catch (error) {
    console.error('Profile update status error:', error);
    res.status(500).json({ error: 'Failed to check update status' });
  }
});

// Add a route to manually sync profile data (useful for debugging)
router.post('/profile/sync', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    console.log('Manually syncing profile for user:', userId);
    
    const { data: userData } = await getCompleteUserData(userId);
    
    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Sync with auth
    await syncProfileWithAuth(userId, userData);
    
    res.json({ 
      message: 'Profile synced successfully',
      user: userData 
    });
  } catch (error) {
    console.error('Profile sync error:', error);
    res.status(500).json({ error: 'Failed to sync profile' });
  }
});

export default router;