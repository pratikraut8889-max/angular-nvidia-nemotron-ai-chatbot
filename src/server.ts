import "dotenv/config";
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import api from '../api';
import { connectDatabase } from '../api/config/database';
import { getJwtSecret } from '../api/config/security';
const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // Render terminates HTTPS at its proxy; only emit HSTS for HTTPS requests.
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
let databaseInitialization: Promise<unknown> | undefined;

const ensureDatabaseConnected = (): Promise<unknown> => {
  if (!databaseInitialization) {
    databaseInitialization = connectDatabase().catch((error: unknown) => {
      // Allow a later request to retry if connection initialization fails.
      databaseInitialization = undefined;
      throw error;
    });
  }

  return databaseInitialization;
};
// The app runs behind one managed reverse proxy in production (for example Render).
// This allows req.ip-based limits to use the client IP instead of the proxy IP.
app.set('trust proxy', 1);
const angularApp = new AngularNodeAppEngine();
app.use('/api', async (_req, res, next) => {
  try {
    await ensureDatabaseConnected();
    next();

  } catch (error) {
    console.error('Database connection failed:', error);

    res.status(503).json({
      success: false,
      message: 'Database is currently unavailable.',
    });
  }
}, express.json({ limit: '64kb' }),
  api,);

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});



/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  // Fail fast instead of deploying a service whose authentication or AI calls cannot work.
  try {
    getJwtSecret();
    if (!process.env['NVIDIA_API_KEY']) {
      throw new Error('NVIDIA_API_KEY must be configured for chat and document embeddings.');
    }
  } catch (error) {
    console.error('Runtime configuration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  ensureDatabaseConnected()
    .then(() => {
      app.listen(port, (error) => {
        if (error) {
          throw error;
        }
        console.log(`Node Express server listening on http://localhost:${port}`);
      });
    })
    .catch((error: unknown) => {
      console.error('Server startup failed:', error);
      process.exitCode = 1;
    });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
