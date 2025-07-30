import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import userRoutes from './routes/users';
import postRoutes from './routes/posts';
import feedbackRoutes from './routes/feedback';
import viewsRoutes from './routes/views';
import likesRoutes from './routes/likes';
import adminRoutes from './routes/admins';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Mount routes
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/posts', feedbackRoutes);
app.use('/api/posts', viewsRoutes);
app.use('/api/posts', likesRoutes);
app.use('/api/admins', adminRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});