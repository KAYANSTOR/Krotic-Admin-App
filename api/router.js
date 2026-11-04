import adminSessionHandler from '../server/apiHandlers/admin-session.js';
import adminsHandler from '../server/apiHandlers/admins.js';
import deviceHeartbeatHandler from '../server/apiHandlers/device-heartbeat.js';
import inventorySnapshotHandler from '../server/apiHandlers/inventory-snapshot.js';
import manageUserAuthHandler from '../server/apiHandlers/manage-user-auth.js';
import networksHandler from '../server/apiHandlers/networks.js';
import registerNetworkHandler from '../server/apiHandlers/register-network.js';
import salesIngestHandler from '../server/apiHandlers/sales-ingest.js';
import sendFcmHandler from '../server/apiHandlers/send-fcm.js';
import settingsHandler from '../server/apiHandlers/settings.js';
import settlementHandler from '../server/apiHandlers/settlement.js';
import whatsappNetworkConfigHandler from '../server/apiHandlers/whatsapp-network-config.js';
import whatsappRetentionPurgeHandler from '../server/apiHandlers/whatsapp-retention-purge.js';
import whatsappUnknownOutcomesHandler from '../server/apiHandlers/whatsapp-unknown-outcomes.js';
import metaExchangeHandler from '../server/_lib/whatsapp/metaExchangeHandler.js';
import {
  whatsappQrGenerateHandler,
  whatsappQrStatusHandler,
  whatsappSessionStartHandler,
  whatsappSessionStatusHandler,
  whatsappSessionUnlinkHandler,
} from '../server/_lib/whatsapp/gatewaySessionApi.js';
import unifiedMessageHandler from '../server/_lib/whatsapp/unifiedMessageHandler.js';

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
  'sales-ingest': salesIngestHandler,
  'send-fcm': sendFcmHandler,
  settings: settingsHandler,
  settlement: settlementHandler,
  'whatsapp-network-config': whatsappNetworkConfigHandler,
  'whatsapp-retention-purge': whatsappRetentionPurgeHandler,
  'whatsapp-unknown-outcomes': whatsappUnknownOutcomesHandler,
});

export const WHATSAPP_API_ROUTE_HANDLERS = Object.freeze({
  'whatsapp-meta-exchange-token': metaExchangeHandler,
  'whatsapp-session-status': whatsappSessionStatusHandler,
  'whatsapp-session-start': whatsappSessionStartHandler,
  'whatsapp-session-unlink': whatsappSessionUnlinkHandler,
  'whatsapp-qr-generate': whatsappQrGenerateHandler,
  'whatsapp-qr-status': whatsappQrStatusHandler,
  'whatsapp-deliver': unifiedMessageHandler,
  'whatsapp-messages-send': unifiedMessageHandler,
});

export default async function handler(req, res) {
  const whatsappRouteValue = req.query?.__whatsappRoute;
  const whatsappRoute = Array.isArray(whatsappRouteValue) ? whatsappRouteValue[0] : whatsappRouteValue;
  const whatsappHandler = typeof whatsappRoute === 'string' && Object.hasOwn(WHATSAPP_API_ROUTE_HANDLERS, whatsappRoute)
    ? WHATSAPP_API_ROUTE_HANDLERS[whatsappRoute]
    : null;
  if (whatsappHandler) return whatsappHandler(req, res);

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
