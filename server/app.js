/**
 * Express application factory (no listening) — used by server/index.js and the tests.
 * @module server/app
 */
import path from 'node:path';
import express from 'express';
import { sessionMiddleware } from './auth.js';
import { apiNotFound, errorHandler } from './http.js';
import { RateLimiter, csrfGuard, securityHeaders } from './security.js';
import { authRoutes } from './routes/auth.js';
import { reportRoutes } from './routes/reports.js';
import { statsRoutes } from './routes/stats.js';
import { testRoutes } from './routes/tests.js';
import { vocabRoutes } from './routes/vocab.js';
import { wordRoutes } from './routes/words.js';

/** Static assets that should always be revalidated (development friendliness wins). */
const REVALIDATE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest']);

const staticOptions = {
  index: 'index.html',
  setHeaders(res, filePath) {
    res.set('Cache-Control', REVALIDATE.has(path.extname(filePath).toLowerCase())
      ? 'no-cache'
      : 'public, max-age=86400');
  },
};

/**
 * Create the HiraKata Express app.
 * @param {{ config: import('./config.js').Config, db: import('./db.js').Database,
 *           wordbank: import('./services/wordbank.js').WordBank,
 *           log?: (err: Error) => void }} options `log` receives unexpected (5xx) errors
 * @returns {import('express').Express}
 */
export function createApp({ config, db, wordbank, log }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);

  const deps = {
    db,
    config,
    bank: wordbank,
    limiters: {
      auth: new RateLimiter(config.authRateLimit),
      loginFailures: new RateLimiter(config.loginFailureLimit),
    },
  };

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Liveness probe for the host (e.g. Render's health check): no database round trip.
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(csrfGuard);
  api.use(express.json({ limit: '64kb' }));
  // Public word-bank routes need no session, so they skip the session lookup (a DB round trip).
  api.use('/words', wordRoutes(deps));
  api.use(sessionMiddleware(deps));
  api.use(authRoutes(deps));
  api.use(reportRoutes(deps));
  api.use('/tests', testRoutes(deps));
  api.use('/stats', statsRoutes(deps));
  api.use('/vocab', vocabRoutes(deps));
  api.use(apiNotFound);
  app.use('/api', api);

  app.use('/shared', express.static(config.sharedDir, staticOptions));
  app.use(express.static(config.publicDir, staticOptions));
  app.use((req, res) => {
    // The SPA uses hash routing: send extension-less page URLs (e.g. /dashboard) to the hash route.
    if ((req.method === 'GET' || req.method === 'HEAD') && !path.extname(req.path) && req.accepts('html')) {
      res.redirect(302, `/#${req.path}`);
      return;
    }
    res.status(404).type('text/plain').send('Not found');
  });

  app.use(errorHandler({ isProduction: config.isProduction, log }));
  return app;
}
