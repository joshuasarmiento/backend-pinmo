import { Router } from 'express';
import userRoutes from './users/users';
import postRoutes from './posts/posts';
import feedbackRoutes from './feedback';
import viewsRoutes from './posts/views';
import reportPostsROutes from './posts/reportPosts'
import likesRoutes from './posts/likes';
import adminRoutes from './admins';
import commentRoutes from './posts/comments';

const router = Router();

// Mount all route modules
router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/posts', commentRoutes);
router.use('/posts', feedbackRoutes);
router.use('/posts', reportPostsROutes);
router.use('/posts', viewsRoutes);
router.use('/posts', likesRoutes);
router.use('/admins', adminRoutes);


export default router;