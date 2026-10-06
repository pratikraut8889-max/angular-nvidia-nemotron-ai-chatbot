import express from 'express';
import authRoutes from './routes/auth.routes';
import conversationRoutes from './routes/conversation.routes';

const api = express();

api.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
  });
});

api.use('/auth', authRoutes);
api.use('/conversations', conversationRoutes);

// Important: prevent unmatched /api requests from reaching Angular SSR
api.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
  });
});

export default api;
