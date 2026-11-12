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


const INBOX_MAX_CLAIM = 20;
const INBOX_LEASE_MS = 90_000;
const INBOX_RETRY_BASE_MS = 30_000;
const INBOX_RETRY_MAX_MS = 5 * 60_000;
const INBOX_FINAL_RESULTS = new Set(['recorded', 'rejected', 'duplicate', 'needs_phone', 'ignored']);

function inboxLimit(value) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(1, Math.min(INBOX_MAX_CLAIM, n)) : 10;
}

async function claimInbox({ db, networkId, uid, now = Date.now(), limit = 10 }) {
  const size = inboxLimit(limit);
  const collection = db.collection('networks').doc(networkId).collection('wa_inbox');
  const [pending, abandoned] = await Promise.all([
    collection.where('status', '==', 'pending').orderBy('receivedAtMs', 'asc').limit(size * 4).get(),
    collection.where('status', '==', 'processing').where('leaseUntilMs', '<=', now)
      .orderBy('leaseUntilMs', 'asc').limit(size * 2).get(),
  ]);
  const candidatesById = new Map();
  for (const item of [...(pending.docs || []), ...(abandoned.docs || [])]) candidatesById.set(item.id, item);
  const candidates = [...candidatesById.values()].sort((a, b) =>
    Number(a.data()?.receivedAtMs || 0) - Number(b.data()?.receivedAtMs || 0));
  const claimed = [];
  for (const candidate of candidates) {
    if (claimed.length >= size) break;
    const ref = collection.doc(candidate.id);
    const claimToken = randomUUID();
    const item = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data() || {};
      const status = String(data.status || 'pending');
      const leaseUntilMs = Number(data.leaseUntilMs || 0);
      if (status !== 'pending' && !(status === 'processing' && leaseUntilMs <= now)) return null;
      const attempts = Math.max(0, Number(data.attempts || 0)) + 1;
      tx.set(ref, {
        status: 'processing', claimUid: uid, claimToken,
        leaseUntilMs: now + INBOX_LEASE_MS, attempts, updatedAtMs: now,
      }, { merge: true });
      return {
        id: candidate.id, claimToken, text: String(data.text || ''),
        fromPhone: data.fromPhone == null ? null : String(data.fromPhone),
        fromJid: data.fromJid == null ? null : String(data.fromJid),
        pushName: data.pushName == null ? null : String(data.pushName),
        timestamp: Number(data.timestamp || 0),
        receivedAtMs: Number(data.receivedAtMs || now), attempts,
      };
    });
    if (item) claimed.push(item);
  }
  return claimed;
}

async function completeInbox({
  db, networkId, uid, id, claimToken, processResult, retry = false,
  reasonCode = null, now = Date.now(),
}) {
  const messageId = String(id || '').trim();
  const token = String(claimToken || '').trim();
  if (!messageId || messageId.length > 200 || !token || token.length > 128) {
    return { ok: false, error: 'invalid_claim' };
  }
  if (!retry && !INBOX_FINAL_RESULTS.has(String(processResult || '').split(':')[0])) {
    return { ok: false, error: 'invalid_process_result' };
  }
  const ref = db.collection('networks').doc(networkId).collection('wa_inbox').doc(messageId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, error: 'message_not_found' };
    const current = snap.data() || {};
    if (current.status !== 'processing' || current.claimUid !== uid || current.claimToken !== token) {
      return { ok: false, error: 'claim_lost' };
    }
    if (retry) {
      const attempts = Math.max(1, Number(current.attempts || 1));
      const delay = Math.min(INBOX_RETRY_BASE_MS * (2 ** Math.min(attempts - 1, 4)), INBOX_RETRY_MAX_MS);
      tx.set(ref, {
        status: 'processing', claimUid: null, claimToken: null,
        leaseUntilMs: now + delay,
        lastErrorCode: String(reasonCode || 'processing_failed').slice(0, 120),
        updatedAtMs: now,
      }, { merge: true });
      return { ok: true, status: 'retry_scheduled', retryAtMs: now + delay };
    }
    tx.set(ref, {
      status: 'processed', processResult: String(processResult).slice(0, 120),
      processedAtMs: now, processedAt: new Date(now), processedBy: uid,
      claimUid: null, claimToken: null, leaseUntilMs: 0,
      lastErrorCode: null, updatedAtMs: now,
    }, { merge: true });
    return { ok: true, status: 'processed' };
  });
}

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
  const allowed = new Set(['start', 'status', 'reconnect', 'disconnect', 'pairing-code', 'send', 'inbox-claim', 'inbox-complete', ...DELIVERY_ROUTES.keys()]);
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
  if (route === 'inbox-claim') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, error: 'method_not_allowed' });
    }
    try {
      const body = objectBody(req.body) || {};
      const messages = await claimInbox({ db: auth.db, networkId, uid: auth.uid, limit: body.limit });
      return res.status(200).json({ success: true, messages });
    } catch (error) {
      console.error('whatsapp inbox claim failed', { uid: auth.uid, code: error?.code });
      return res.status(503).json({ success: false, error: 'inbox_claim_failed' });
    }
  }
  if (route === 'inbox-complete') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, error: 'method_not_allowed' });
    }
    try {
      const body = objectBody(req.body) || {};
      const result = await completeInbox({
        db: auth.db, networkId, uid: auth.uid, id: body.id,
        claimToken: body.claimToken, processResult: body.processResult,
        retry: body.retry === true, reasonCode: body.reasonCode,
      });
      if (!result.ok) return res.status(result.error === 'claim_lost' ? 409 : 400).json({ success: false, error: result.error });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error('whatsapp inbox completion failed', { uid: auth.uid, code: error?.code });
      return res.status(503).json({ success: false, error: 'inbox_completion_failed' });
    }
  }
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
