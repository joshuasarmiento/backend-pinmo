import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Enhanced authentication middleware for posts
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

    console.log('Verifying token for posts endpoint...');
    
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

    console.log('User authenticated successfully for posts:', user.id);
    
    // Attach user to request object
    (req as any).user = user;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Configure multer for file uploads with multiple file types
const uploadFields = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('File filter - Field name:', file.fieldname, 'MIME type:', file.mimetype);
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helper function to upload image to Supabase Storage
async function uploadImageToSupabase(file: Express.Multer.File, folder: string = 'posts'): Promise<string> {
  try {
    const fileName = `${uuidv4()}-${file.originalname}`;
    const filePath = `${folder}/${fileName}`;

    console.log(`Uploading ${folder} image to path:`, filePath);
    console.log('File size:', file.size, 'bytes');
    console.log('File type:', file.mimetype);

    const { data, error } = await supabase.storage
      .from('pinmo-images')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('Supabase storage upload error:', error);
      throw new Error(`Failed to upload image: ${error.message}`);
    }

    console.log(`${folder} image uploaded successfully:`, data.path);

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

// Create post
router.post('/', authenticate, uploadFields.fields([
  { name: 'images', maxCount: 5 },
  { name: 'custom_pin', maxCount: 1 }
]), async (req: Request, res: Response) => {
  try {
    const { type, description, lat, lng, location, link, emoji } = req.body;
    const userId = (req as any).user.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    console.log('Creating post for user:', userId);
    console.log('Post data:', { type, description, lat, lng, location, link, emoji });
    console.log('Files received:', {
      images: files?.images?.length || 0,
      custom_pin: files?.custom_pin?.length || 0
    });

    let imageUrls: string[] = [];
    let customPinUrl: string | null = null;

    // Handle post images
    if (files?.images && files.images.length > 0) {
      try {
        console.log('Uploading', files.images.length, 'post images...');
        imageUrls = await Promise.all(
          files.images.map(file => uploadImageToSupabase(file, 'posts'))
        );
        console.log('All post images uploaded successfully:', imageUrls);
      } catch (uploadError) {
        console.error('Post images upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload post images' });
      }
    }

    // Handle custom pin image
    if (files?.custom_pin && files.custom_pin.length > 0) {
      try {
        console.log('Uploading custom pin image...');
        customPinUrl = await uploadImageToSupabase(files.custom_pin[0], 'custom-pins');
        console.log('Custom pin uploaded successfully:', customPinUrl);
      } catch (uploadError) {
        console.error('Custom pin upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload custom pin image' });
      }
    }

    if (!type || !description || !lat || !lng || !location) {
      console.log('Missing required fields:', { type: !!type, description: !!description, lat: !!lat, lng: !!lng, location: !!location });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        type,
        description,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        location,
        image_url: imageUrls.length > 0 ? imageUrls : null,
        custom_pin: customPinUrl,
        link: link || null,
        emoji: emoji || null,
        timestamp: new Date().toISOString(),
        resolution_status: 'active',
        likes: 0,
        views: 0,
        user_id: userId
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to create post' });
    }

    console.log('Post created successfully:', data.id);
    res.status(201).json(data);
  } catch (error) {
    console.error('Server error:', error);
    
    // Provide specific error messages
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5MB per image.' });
      }
      return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get posts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { dateFilter, sortKey = 'timestamp', sortOrder = 'desc', userId } = req.query;

    console.log('Fetching posts with filters:', { dateFilter, sortKey, sortOrder, userId });

    let query = supabase
      .from('posts')
      .select('*');

    if (userId) {
      query = query.eq('user_id', userId);
      console.log('Filtering by user ID:', userId);
    }

    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      let cutoffDate: Date;
      
      switch (dateFilter) {
        case '24h':
          cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '3d':
          cutoffDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
          break;
        case '7d':
          cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          cutoffDate = new Date(0);
      }
      
      query = query.gte('timestamp', cutoffDate.toISOString());
      console.log('Applying date filter:', dateFilter, 'from:', cutoffDate.toISOString());
    }

    const ascending = sortOrder === 'asc';
    query = query.order(sortKey as string, { ascending });

    const { data: posts, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }

    // Get unique user IDs from posts
    const userIds = [...new Set(posts.map(post => post.user_id).filter(Boolean))];
    
    // Get user information from Supabase Auth
    const postsWithUsers = await Promise.all(posts.map(async (post) => {
      if (post.user_id) {
        try {
          const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(post.user_id);
          
          if (!userError && user) {
            return {
              ...post,
              user: {
                id: user.id,
                email: user.email,
                full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
                profile_picture: user.user_metadata?.profile_picture || null,
                email_verified: user.email_confirmed_at ? true : false
              }
            };
          }
        } catch (authError) {
          console.warn('Failed to get user info for:', post.user_id, authError);
        }
      }
      // Return post without user info if user fetch failed
      return {
        ...post,
        user: {
          id: post.user_id,
          email: 'unknown@example.com',
          full_name: 'Anonymous User',
          profile_picture: null,
          email_verified: false
        }
      };
    }));

    console.log('Posts fetched successfully:', postsWithUsers.length, 'posts');
    res.json(postsWithUsers);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Update post
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;
    const { type, description } = req.body;

    console.log('Updating post:', postId, 'by user:', userId);

    if (!type || !description) {
      console.log('Missing required fields for update:', { type: !!type, description: !!description });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify post belongs to user
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('user_id')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      console.log('Post not found:', postId);
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== userId) {
      console.log('Unauthorized update attempt by user:', userId, 'for post owned by:', post.user_id);
      return res.status(403).json({ error: 'Unauthorized to edit this post' });
    }

    const { error: updateError } = await supabase
      .from('posts')
      .update({
        type,
        description,
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update post' });
    }

    console.log('Post updated successfully:', postId);
    res.json({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Deleting post:', postId, 'by user:', userId);

    // Verify post belongs to user and get image URLs for cleanup
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('user_id, image_url, custom_pin')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      console.log('Post not found for deletion:', postId);
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== userId) {
      console.log('Unauthorized delete attempt by user:', userId, 'for post owned by:', post.user_id);
      return res.status(403).json({ error: 'Unauthorized to delete this post' });
    }

    // Delete post from database
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to delete post' });
    }

    // Optional: Clean up uploaded images from storage
    if (post.image_url && Array.isArray(post.image_url)) {
      try {
        const deletePromises = post.image_url.map(async (url: string) => {
          // Extract file path from URL
          const urlParts = url.split('/');
          const fileName = urlParts[urlParts.length - 1];
          const filePath = `posts/${fileName}`;
          
          return supabase.storage
            .from('pinmo-images')
            .remove([filePath]);
        });
        
        await Promise.all(deletePromises);
        console.log('Post images cleaned up from storage');
      } catch (cleanupError) {
        console.warn('Failed to cleanup post images:', cleanupError);
        // Don't fail the delete operation if cleanup fails
      }
    }

    // Clean up custom pin image if exists
    if (post.custom_pin) {
      try {
        const urlParts = post.custom_pin.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const filePath = `custom-pins/${fileName}`;
        
        await supabase.storage
          .from('pinmo-images')
          .remove([filePath]);
        
        console.log('Custom pin image cleaned up from storage');
      } catch (cleanupError) {
        console.warn('Failed to cleanup custom pin image:', cleanupError);
      }
    }

    console.log('Post deleted successfully:', postId);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Add like
router.post('/:id/likes', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Adding like to post:', postId, 'by user:', userId);

    // Check if user already liked this post
    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    if (existingLike) {
      console.log('User already liked this post:', postId);
      return res.status(400).json({ error: 'You have already liked this post' });
    }

    // Add like record
    const { error: likeError } = await supabase
      .from('post_likes')
      .insert({ post_id: postId, user_id: userId });

    if (likeError) {
      console.error('Like error:', likeError);
      return res.status(500).json({ error: 'Failed to add like' });
    }

    // Get current likes count
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('likes')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to update likes count' });
    }

    const newLikesCount = (post.likes || 0) + 1;

    // Update likes count
    const { error: incrementError } = await supabase
      .from('posts')
      .update({ likes: newLikesCount })
      .eq('id', postId);

    if (incrementError) {
      console.error('Increment error:', incrementError);
      return res.status(500).json({ error: 'Failed to increment likes' });
    }

    console.log('Like added successfully. New count:', newLikesCount);
    res.status(201).json({ likes: newLikesCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to add like' });
  }
});

// Remove like
router.delete('/:id/likes', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    console.log('Removing like from post:', postId, 'by user:', userId);

    // Check if user has liked this post
    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    if (!existingLike) {
      console.log('User has not liked this post:', postId);
      return res.status(400).json({ error: 'You have not liked this post' });
    }

    // Remove like record
    const { error: unlikeError } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (unlikeError) {
      console.error('Unlike error:', unlikeError);
      return res.status(500).json({ error: 'Failed to remove like' });
    }

    // Get current likes count
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('likes')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to update likes count' });
    }

    const newLikesCount = Math.max(0, (post.likes || 0) - 1);

    // Update likes count
    const { error: decrementError } = await supabase
      .from('posts')
      .update({ likes: newLikesCount })
      .eq('id', postId);

    if (decrementError) {
      console.error('Decrement error:', decrementError);
      return res.status(500).json({ error: 'Failed to decrement likes' });
    }

    console.log('Like removed successfully. New count:', newLikesCount);
    res.json({ likes: newLikesCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to remove like' });
  }
});

// Increment views
router.post('/:id/views', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    console.log('Incrementing views for post:', postId);

    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('views')
      .eq('id', postId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch post' });
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

    console.log('Views incremented successfully. New count:', newViewsCount);
    res.json({ views: newViewsCount });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to increment views' });
  }
});

// Get post likes status for user (helpful for UI)
router.get('/:id/likes/status', authenticate, async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;
    const userId = (req as any).user.id;

    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('*')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    res.json({ liked: !!existingLike });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to get like status' });
  }
});

export default router;