import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../../utils/supabase';
import multer from 'multer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/auth';

const router = Router();
const SALT_ROUNDS = 10;

// Configure multer for profile picture uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('File filter - MIME type:', file.mimetype);
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

    console.log('Uploading file to path:', filePath);
    console.log('File size:', file.size, 'bytes');
    console.log('File type:', file.mimetype);

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

    console.log('File uploaded successfully:', data.path);

    // Get public URL
    const { data: publicData } = supabase.storage
      .from('pinmo-images')
      .getPublicUrl(filePath);

    console.log('Public URL generated:', publicData.publicUrl);
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

    console.log('Registration attempt for email:', email);

    // Validate required fields
    if (!full_name || !email || !password || !full_address || !latitude || !longitude) {
      console.log('Missing required fields:', { full_name, email, password, full_address, latitude, longitude });
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

    // Hash the password
    // const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // console.log('Password hashed successfully for email:', email);

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
        emailRedirectTo: 'http://localhost:5173'
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

    // console.log('User created in auth:', data.user.id);

    // // Insert user data into users table with hashed password
    // const { error: insertError } = await supabase
    //   .from('users')
    //   .insert({
    //     id: data.user.id,
    //     full_name,
    //     email,
    //     password_hash: passwordHash,
    //     full_address,
    //     latitude,
    //     longitude,
    //     email_verified: false,
    //     created_at: new Date().toISOString(),
    //     updated_at: new Date().toISOString()
    //   });

    // if (insertError) {
    //   console.error('Database insert error:', insertError);
    //   return res.status(500).json({ error: 'Failed to save user data' });
    // }

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

    console.log('Password reset requested for email:', email);

    // Validate email
    if (!email) {
      console.log('Missing email field');
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (!user) {
      console.log('User not found for email:', email);
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate reset token
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

    // Store reset token in users table
    const { error: updateError } = await supabase
      .from('users')
      .update({
        reset_password_token: resetToken,
        reset_password_expires: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('email', email);

    if (updateError) {
      console.error('Failed to store reset token:', updateError);
      return res.status(500).json({ error: 'Failed to initiate password reset' });
    }

    // Send password reset email via Supabase Auth
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`
    });

    if (authError) {
      console.error('Supabase reset password email error:', authError);
      return res.status(500).json({ error: 'Failed to send reset email' });
    }

    console.log('Password reset email sent for:', email);
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

    console.log('Password reset attempt with token');

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

    console.log('Login attempt for email:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.user) {
      console.log('Login failed:', error?.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Auth login successful for user:', data.user.id);

    // Check if email is verified
    const { data: userData } = await supabase
      .from('users')
      .select('email_verified')
      .eq('id', data.user.id)
      .single();

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

// Update user profile
router.put('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const { full_name, email, full_address, latitude, longitude } = req.body;
    const userId = (req as any).user.id;

    console.log('Profile update request for user:', userId);

    // Note: We skip updating auth metadata from backend since it requires user session
    // The frontend will handle auth metadata updates after successful database update
    console.log('Skipping auth metadata update from backend (requires user session)');

    // Update users table
    const { error: dbError } = await supabase
      .from('users')
      .update({
        full_name,
        email,
        full_address,
        latitude,
        longitude,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (dbError) {
      console.error('Database update error:', dbError);
      return res.status(500).json({ error: 'Failed to update user profile' });
    }

    console.log('Profile updated successfully for user:', userId);
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// Upload profile picture
router.post('/profile/picture', authenticate, upload.single('profile_picture'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const file = req.file as Express.Multer.File;

    console.log('Profile picture upload request for user:', userId);
    console.log('File received:', !!file);

    if (!file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File details:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

    // Upload file to Supabase Storage
    const profilePictureUrl = await uploadProfilePicture(file, userId);

    // Note: We skip updating auth metadata from backend since it requires user session
    // The frontend will handle auth metadata updates after successful upload
    console.log('Skipping auth metadata update from backend (requires user session)');

    // Update users table
    const { error: dbError } = await supabase
      .from('users')
      .update({ 
        profile_picture: profilePictureUrl, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', userId);

    if (dbError) {
      console.error('Database profile picture update error:', dbError);
      return res.status(500).json({ error: 'Failed to save profile picture' });
    }

    console.log('Profile picture updated successfully for user:', userId);
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

// Get user profile (optional endpoint for debugging)
router.get('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Profile fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch profile' });
    }

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

    console.log('Fetching public profile for user:', userId);

    const { data: userData, error } = await supabase
      .from('users')
      .select('id, full_name, email, profile_picture, full_address, latitude, longitude, email_verified, created_at')
      .eq('id', userId)
      .single();

    if (error || !userData) {
      console.error('Profile fetch error:', error?.message || 'No user found');
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('Public profile fetched successfully for user:', userId);
    res.json({ user: userData });
  } catch (error) {
    console.error('Public profile endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});


export default router;