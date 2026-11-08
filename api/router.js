import adminSessionHandler from '../server/apiHandlers/admin-session.js';
import adminsHandler from '../server/apiHandlers/admins.js';
import deviceHeartbeatHandler from '../server/apiHandlers/device-heartbeat.js';
import inventorySnapshotHandler from '../server/apiHandlers/inventory-snapshot.js';
import manageUserAuthHandler from '../server/apiHandlers/manage-user-auth.js';
import networksHandler from '../server/apiHandlers/networks.js';
import registerNetworkHandler from '../server/apiHandlers/register-network.js';
import salesCancelHandler from '../server/apiHandlers/sales-cancel.js';
import salesIngestHandler from '../server/apiHandlers/sales-ingest.js';
import sendFcmHandler from '../server/apiHandlers/send-fcm.js';
import settingsHandler from '../server/apiHandlers/settings.js';
import settlementHandler from '../server/apiHandlers/settlement.js';

// Each delegated handler retains its original authentication, authorization,
// validation, and idempotency rules. This module only consolidates Vercel
// entry points; it does not combine their security boundaries.
export const API_ROUTE_HANDLERS = Object.freeze({
  'admin-session': adminSessionHandler,
  admins: adminsHandler,
  'device-heartbeat': deviceHeartbeatHandler,
  'inventory-snapshot': inventorySnapshotHandler,
  'manage-user-auth': manageUserAuthHandler,
  networks: networksHandler,
  'register-network': registerNetworkHandler,
  'sales-cancel': salesCancelHandler,
  'sales-ingest': salesIngestHandler,
  'send-fcm': sendFcmHandler,
  settings: settingsHandler,
  settlement: settlementHandler,
});

export default async function handler(req, res) {
  const routeValue = req.query?.__router;
  const route = Array.isArray(routeValue) ? routeValue[0] : routeValue;
  const routeHandler = typeof route === 'string' && Object.hasOwn(API_ROUTE_HANDLERS, route)
    ? API_ROUTE_HANDLERS[route]
    : null;

  if (!routeHandler) {
    return res.status(404).json({ success: false, error: 'api_route_not_found' });
  }

  return routeHandler(req, res);
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
