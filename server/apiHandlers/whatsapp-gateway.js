// ============================================================
// Client-facing WhatsApp gateway control plane (via api/router.js).
// Routes (vercel rewrites):
//   POST /api/whatsapp/session/start
//   GET  /api/whatsapp/session/status
//   POST /api/whatsapp/session/reconnect
//   POST /api/whatsapp/session/disconnect
//   POST /api/whatsapp/session/pairing-code   (link with phone number instead of QR)
//   POST /api/whatsapp/messages/send             (delivery operation, contract §6.1)
//   GET  /api/whatsapp/deliveries/status?ids=     (§6.2)
//   POST /api/whatsapp/deliveries/sms-result      (§6.4)
//   GET  /api/whatsapp/deliveries/pending-fallback (§6.5)
// All require Firebase ID token + owned network; session routes and send also require
// whatsapp_card_delivery (delivery bookkeeping routes do not: an owed SMS fallback must still complete).
// networkId is taken from Firestore, never from the request body.
// ============================================================

import { authorizeWhatsappOwner } from '../_lib/whatsappGatewayAuth.js';
import { callGateway, gatewayConfigured } from '../_lib/whatsappGatewayClient.js';
import { deliveriesStatus, pendingFallback, sendDelivery, smsResult } from '../_lib/whatsappDeliveryApi.js';

const LABEL = 'whatsapp/gateway';
// Railway waits up to PAIRING_CODE_TIMEOUT_MS (25 s) for WhatsApp to issue the code.
const PAIRING_TIMEOUT_MS = 40_000;

/** Digits with country code, no leading zero (same rule as the Railway gateway). */
export function normalizePairingPhone(value) {
  const digits = String(value ?? '').replace(/[\s()+-]/g, '').replace(/^00/, '');
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

const DELIVERY_ROUTES = new Map([
  ['deliveries-status', { method: 'GET', run: deliveriesStatus }],
  ['sms-result', { method: 'POST', run: smsResult }],
  ['pending-fallback', { method: 'GET', run: pendingFallback }],
]);

function routeName(req) {
  const v = req.query?.__apiRoute;
  return Array.isArray(v) ? v[0] : v;
}

function objectBody(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

async function proxyToGateway(res, call) {
  if (!gatewayConfigured()) {
    return res.status(503).json({ success: false, error: 'whatsapp_gateway_not_configured' });
  }
  const result = await call;
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      error: result.error,
      ...(result.payload && typeof result.payload === 'object' ? { gateway: result.payload } : {}),
    });
  }
  return res.status(200).json({ success: true, ...(result.payload || {}) });
}

export default async function handler(req, res, dependencies = {}) {
  const route = routeName(req);
  const allowed = new Set(['start', 'status', 'reconnect', 'disconnect', 'pairing-code', 'send', ...DELIVERY_ROUTES.keys()]);
  if (!route || !allowed.has(route)) {
    return res.status(404).json({ success: false, error: 'api_route_not_found' });
  }

  const deliveryRoute = DELIVERY_ROUTES.get(route);
  if (deliveryRoute && req.method !== deliveryRoute.method) {
    res.setHeader('Allow', deliveryRoute.method);
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const auth = await authorizeWhatsappOwner(req, dependencies, { label: `${LABEL}/${route}`, requireFeature: !deliveryRoute });
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }
  const { networkId } = auth;
  if (deliveryRoute) {
    return deliveryRoute.run(req, res, { networkId, db: auth.db, body: objectBody(req.body) }, dependencies);
  }

  switch (route) {
    case 'start': {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      const body = objectBody(req.body) || {};
      const force = body.force === true;
      return proxyToGateway(res, callGateway({
        method: 'POST',
        path: '/sessions/start',
        body: { networkId, force },
      }));
    }
    case 'status': {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      return proxyToGateway(res, callGateway({
        method: 'GET',
        path: '/sessions/status',
        query: { networkId },
      }));
    }
    case 'reconnect': {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      return proxyToGateway(res, callGateway({
        method: 'POST',
        path: '/sessions/reconnect',
        body: { networkId },
      }));
    }
    case 'disconnect': {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      const body = objectBody(req.body) || {};
      const mode = body.mode === 'pause' ? 'pause' : 'logout';
      return proxyToGateway(res, callGateway({
        method: 'POST',
        path: '/sessions/disconnect',
        body: { networkId, mode },
      }));
    }
    case 'pairing-code': {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      const body = objectBody(req.body) || {};
      const phoneNumber = normalizePairingPhone(body.phoneNumber);
      if (!phoneNumber) {
        return res.status(400).json({ success: false, error: 'invalid_phone_number' });
      }
      if (!gatewayConfigured()) {
        return res.status(503).json({ success: false, error: 'whatsapp_gateway_not_configured' });
      }
      const result = await callGateway({
        method: 'POST',
        path: '/sessions/pairing-code',
        body: { networkId, phoneNumber },
        timeoutMs: PAIRING_TIMEOUT_MS,
      });
      if (!result.ok) {
        return res.status(result.status).json({
          success: false,
          error: result.error,
          ...(result.payload && typeof result.payload === 'object' ? { gateway: result.payload } : {}),
        });
      }
      // linkToken is a bearer for the public link page; the owner already has linkUrl.
      const { linkToken: _ignored, ...payload } = result.payload || {};
      return res.status(200).json({ success: true, ...payload });
    }
    case 'send': {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      return sendDelivery(req, res, { networkId, db: auth.db, body: objectBody(req.body) }, dependencies);
    }
    default:
      return res.status(404).json({ success: false, error: 'api_route_not_found' });
  }
}
