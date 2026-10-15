import type { NextFunction, Request, Response } from 'express';
import { getDatabase } from '../config/database';

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowMs: number;
};

/**
 * Mongo-backed fixed-window limiter so counters are shared across app instances.
 * A Redis/gateway limiter is usually preferable at very high traffic, but this avoids
 * per-process-only counters for the current single-server project.
 */
export function mongoRateLimit(options: RateLimitOptions) {
  return async (req: Request & { user?: { userId?: { toHexString?: () => string } } }, res: Response, next: NextFunction): Promise<void> => {
    const identity = req.user?.userId?.toHexString?.() || req.ip || 'unknown';
    const now = Date.now();
    const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
    const key = `${options.scope}:${identity}:${windowStart}`;
    const expiresAt = new Date(windowStart + options.windowMs * 2);
    const counters = getDatabase().collection('rateLimits');

    try {
      try {
        await counters.updateOne(
          { key },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt, scope: options.scope } },
          { upsert: true },
        );
      } catch (error) {
        // Concurrent first requests may race on the unique key. Retry as an update.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
          await counters.updateOne({ key }, { $inc: { count: 1 } });
        } else {
          throw error;
        }
      }

      const bucket = await counters.findOne<{ count: number }>({ key }, { projection: { count: 1 } });
      if ((bucket?.count ?? 0) > options.limit) {
        const retrySeconds = Math.max(1, Math.ceil((windowStart + options.windowMs - now) / 1000));
        res.setHeader('Retry-After', String(retrySeconds));
        res.status(429).json({ error: 'Too many requests. Please retry after the current rate-limit window.' });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
