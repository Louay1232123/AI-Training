import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pollsRouter } from './routes/polls.js';
import { adminRouter } from './routes/admin.js';
import { ApiError, notFound } from './lib/errors.js';

export function createApp() {
  const app = express();

  // Behind a single reverse proxy in production, so X-Forwarded-For is the
  // client address used for the backup vote guard.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim()),
      allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password', 'x-device-id', 'x-channel'],
    }),
  );
  app.use(express.json({ limit: '32kb' }));

  // Resolve the client IP once, so no handler has to think about proxies.
  app.use((req, _res, next) => {
    req.clientIp = req.ip ?? req.socket?.remoteAddress ?? null;
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'cricket-polls' }));

  app.use('/api', pollsRouter);
  app.use('/api/admin', adminRouter);

  app.use((req, _res, next) => next(notFound(`No route for ${req.method} ${req.path}.`)));

  // Single error shape for every channel: { error: { code, message, details? } }
  app.use((error, _req, res, _next) => {
    if (error instanceof ApiError) {
      return res.status(error.status).json({
        error: { code: error.code, message: error.message, ...(error.details ?? {}) },
      });
    }
    if (config.nodeEnv !== 'test') console.error(error);
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  return app;
}
