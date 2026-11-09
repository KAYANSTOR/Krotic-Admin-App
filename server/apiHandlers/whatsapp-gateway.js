// ============================================================
// Client-facing WhatsApp gateway control plane (via api/router.js).
// Routes (vercel rewrites):
//   POST /api/whatsapp/session/start
//   GET  /api/whatsapp/session/status
//   POST /api/whatsapp/session/reconnect
//   POST /api/whatsapp/session/disconnect
//   POST /api/whatsapp/messages/send
// All require Firebase ID token + owned network + whatsapp_card_delivery.
// networkId is taken from Firestore, never from the request body.
// ============================================================

import { authorizeWhatsappOwner } from '../_lib/whatsappGatewayAuth.js';
import { callGateway, gatewayConfigured } from '../_lib/whatsappGatewayClient.js';

const LABEL = 'whatsapp/gateway';

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
  const allowed = new Set(['start', 'status', 'reconnect', 'disconnect', 'send']);
  if (!route || !allowed.has(route)) {
    return res.status(404).json({ success: false, error: 'api_route_not_found' });
  }

  const auth = await authorizeWhatsappOwner(req, dependencies, { label: `${LABEL}/${route}` });
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }
  const { networkId } = auth;

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
    case 'send': {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ success: false, error: 'method_not_allowed' });
      }
      const body = objectBody(req.body) || {};
      const to = typeof body.to === 'string' ? body.to.trim() : '';
      const text = typeof body.text === 'string' ? body.text : '';
      const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
      if (!to || !text || !operationId) {
        return res.status(400).json({ success: false, error: 'missing_send_fields' });
      }
      if (text.length > 4096) {
        return res.status(400).json({ success: false, error: 'text_too_long' });
      }
      if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(operationId)) {
        return res.status(400).json({ success: false, error: 'invalid_operation_id' });
      }
      return proxyToGateway(res, callGateway({
        method: 'POST',
        path: '/messages/send',
        body: { networkId, to, text, operationId },
      }));
    }
    default:
      return res.status(404).json({ success: false, error: 'api_route_not_found' });
  }
}
