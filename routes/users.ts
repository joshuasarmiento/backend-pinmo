import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Enhanced authentication middleware
const authenticate = async (req: Request, res: Response, next: NextFunction) => {
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

// Register user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { full_name, email, password, full_address, latitude, longitude } = req.body;

    console.log('Registration attempt for email:', email);

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
        }
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

    console.log('User created in auth:', data.user.id);

    // Insert user data into users table
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        id: data.user.id,
        full_name,
        email,
        full_address,
        latitude,
        longitude,
        status: 'pending',
        email_verified: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Database insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save user data' });
    }

    console.log('User registration completed successfully');
    res.status(201).json({ message: 'User registered', userId: data.user.id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
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

export default router;