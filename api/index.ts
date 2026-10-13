import express from 'express';
import authRoutes from './routes/auth.routes';
import conversationRoutes from './routes/conversation.routes';
import documentRoutes from './routes/document.routes';

const api = express();

api.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
  });
});

api.use('/auth', authRoutes);
api.use('/conversations', conversationRoutes);
api.use('/documents', documentRoutes);

// JSON/body-parser and raw upload errors are converted to safe API responses.
api.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON request body.' });
    return;
  }
  console.error('Unhandled API error:', error instanceof Error ? error.message : error);
  res.status(500).json({ error: 'Unexpected API error.' });
});

// Important: prevent unmatched /api requests from reaching Angular SSR.
api.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
  });
});

export default api;
