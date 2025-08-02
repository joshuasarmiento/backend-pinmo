import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Determine CORS origin based on environment
const corsOrigin = process.env.NODE_ENV === 'production' 
  ? 'https://pin-oy.vercel.app' 
  : 'http://localhost:5173';

// Configure CORS
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Mount routes
app.use('/api/v1', routes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});