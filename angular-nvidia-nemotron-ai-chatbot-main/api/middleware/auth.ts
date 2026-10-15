import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getJwtSecret } from '../config/security';

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    userId: ObjectId;
    email?: string;
    [key: string]: unknown;
  };
};

const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || typeof decoded === 'string') {
      res.status(403).json({ success: false, message: 'Invalid or expired token.' });
      return;
    }

    // Tokens historically used `id`; normalize it to an ObjectId for all routes.
    const rawId = typeof decoded['id'] === 'string'
      ? decoded['id']
      : typeof decoded['userId'] === 'string'
        ? decoded['userId']
        : '';

    if (!ObjectId.isValid(rawId)) {
      res.status(403).json({ success: false, message: 'Invalid or expired token.' });
      return;
    }

    req.user = {
      ...decoded,
      id: rawId,
      userId: new ObjectId(rawId),
    };
    next();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('JWT_SECRET')) {
      res.status(500).json({ success: false, message: 'Authentication is not configured on this server.' });
      return;
    }
    res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};

export default authMiddleware;
