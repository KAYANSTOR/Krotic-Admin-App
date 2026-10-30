import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// API Route Handlers
import networksHandler from './server/apiHandlers/networks.js';
import adminsHandler from './server/apiHandlers/admins.js';
import manageUserAuthHandler from './server/apiHandlers/manage-user-auth.js';
import settingsHandler from './server/apiHandlers/settings.js';
import settlementHandler from './server/apiHandlers/settlement.js';
import recordPaymentHandler from './server/record-payment.js';
import registerNetworkHandler from './server/apiHandlers/register-network.js';
import salesIngestHandler from './server/apiHandlers/sales-ingest.js';
import deviceHeartbeatHandler from './server/apiHandlers/device-heartbeat.js';
import sendFcmHandler from './server/apiHandlers/send-fcm.js';
import dispatchNotificationsHandler from './api/dispatch-notifications.js';
import migrateHandler from './server/_lib/migrationApi.js';
import networkSecretHandler from './server/_lib/networkSecretApi.js';
import adminSessionHandler from './server/apiHandlers/admin-session.js';
import templateCenterHandler from './server/_lib/templateCenterApi.js';
import activateEntitlementHandler from './server/_lib/entitlementActivation.js';
import rebindEntitlementDeviceHandler from './server/_lib/entitlementDeviceRebind.js';
import inventorySnapshotHandler from './server/apiHandlers/inventory-snapshot.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  // Parse JSON and urlencoded request bodies
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Mount API endpoints
  app.all('/api/networks', (req, res) => networksHandler(req, res));
  app.all('/api/admins', (req, res) => adminsHandler(req, res));
  app.all('/api/admin-session', (req, res) => adminSessionHandler(req, res));
  app.all('/api/manage-user-auth', (req, res) => manageUserAuthHandler(req, res));
  app.all('/api/settings', (req, res) => settingsHandler(req, res));
  app.all('/api/settlement', (req, res) => settlementHandler(req, res));
  app.all('/api/record-payment', (req, res) => recordPaymentHandler(req, res));
  app.all('/api/register-network', (req, res) => registerNetworkHandler(req, res));
  app.all('/api/sales/ingest', (req, res) => salesIngestHandler(req, res));
  app.all('/api/device-heartbeat', (req, res) => deviceHeartbeatHandler(req, res));
  app.all('/api/device-heartbeats', (req, res) => deviceHeartbeatHandler({ ...req, query: { ...(req.query || {}), __apiRoute: 'list' } }, res));
  app.all('/api/send-fcm', (req, res) => sendFcmHandler(req, res));
  app.all('/api/dispatch-notifications', (req, res) => dispatchNotificationsHandler(req, res));
  app.all('/api/migrate', (req, res) => migrateHandler(req, res));
  app.all('/api/inventory/snapshot', (req, res) => inventorySnapshotHandler(req, res));
  app.all('/api/network-secret', (req, res) => networkSecretHandler(req, res));
  app.all('/api/template-center', (req, res) => templateCenterHandler(req, res));
  app.all('/api/entitlements/activate', (req, res) => activateEntitlementHandler(req, res));
  app.all('/api/entitlements/device-rebind', (req, res) => rebindEntitlementDeviceHandler(req, res));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  if (!isProduction) {
    // Development mode: mount Vite dev server as middleware
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
    // Production mode: serve built assets from dist/
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
