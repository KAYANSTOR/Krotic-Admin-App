import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import apiRouter from './api/router.js';
import dispatchNotificationsHandler from './api/dispatch-notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reuse the exact API rewrite contract used by Vercel.
 *
 * Keeping the route map sourced from vercel.json prevents the Railway adapter
 * from silently drifting away from the production API paths and route selectors.
 * The delegated handlers remain responsible for their existing auth,
 * authorization, validation, idempotency, and response contracts.
 */
function loadApiRewriteMap() {
  const configPath = new URL('./vercel.json', import.meta.url);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const routes = new Map();

  for (const rewrite of config.rewrites || []) {
    if (
      typeof rewrite.source !== 'string'
      || !rewrite.source.startsWith('/api/')
      || typeof rewrite.destination !== 'string'
      || !rewrite.destination.startsWith('/api/router?')
    ) {
      continue;
    }

    const destination = new URL(rewrite.destination, 'http://localhost');
    const router = destination.searchParams.get('__router');
    if (!router) continue;

    routes.set(rewrite.source, {
      router,
      apiRoute: destination.searchParams.get('__apiRoute'),
    });
  }

  return routes;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';
  const apiRewriteMap = loadApiRewriteMap();

  // Preserve the exact request bytes for signed webhook verification.
  app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Health is intentionally shallow: it reports process availability only.
  // Dependency/readiness checks must be separate and must not leak secrets.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Vercel Cron remains the only scheduler until an explicit cutover.
  app.all('/api/dispatch-notifications', (req, res) => (
    dispatchNotificationsHandler(req, res)
  ));

  // Express adapter for all API paths routed through api/router.js on Vercel.
  app.use((req, res, next) => {
    const requestPath = req.path;
    if (!requestPath.startsWith('/api/')) return next();

    const route = apiRewriteMap.get(requestPath);
    if (!route) {
      return res.status(404).json({ success: false, error: 'api_route_not_found' });
    }

    // Express 5 exposes req.query through a getter. Give the router a request
    // view with Vercel's rewrite query parameters without mutating the original.
    const routedReq = Object.create(req);
    Object.defineProperty(routedReq, 'query', {
      configurable: true,
      enumerable: true,
      value: {
        ...(req.query || {}),
        __router: route.router,
        ...(route.apiRoute ? { __apiRoute: route.apiRoute } : {}),
      },
    });

    return apiRouter(routedReq, res);
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`> Krotak Pro Admin Server running on http://0.0.0.0:${PORT} [${isProduction ? 'PROD' : 'DEV'}]`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
