/**
 * Meta webhook: GET verification + POST signature + atomic inbound create.
 * Does not store raw body. Does not issue cards.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { verifyMetaSignature, verifyMetaSubscription } from './signature.js';
import { getMetaAppSecret, getMetaVerifyToken } from './secrets.js';
import { createInboundEvent } from './inboundEvents.js';
import { WHATSAPP_PROVIDER_META } from './eventIdentity.js';

function getHeader(req, name) {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/** Resolve networkId from Meta phone_number_id against networks collection. */
export async function resolveNetworkIdByPhoneNumberId(db, phoneNumberId) {
  if (!phoneNumberId) return null;
  // Prefer indexed query when available; fallback scan limited — production should index whatsappPhoneNumberId.
  if (typeof db.collection('networks').where === 'function') {
    try {
      const q = await db.collection('networks').where('whatsappPhoneNumberId', '==', String(phoneNumberId)).limit(2).get();
      if (q.docs?.length === 1) return q.docs[0].id;
      if (q.docs?.length > 1) return null; // ambiguous
    } catch {
      // fake or missing index
    }
  }
  // Scan fake store / small sets
  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith('networks/') && !path.slice('networks/'.length).includes('/')
          && data?.whatsappPhoneNumberId === String(phoneNumberId)) {
        return path.slice('networks/'.length);
      }
    }
  }
  return null;
}

/** Extract inbound message candidates from Meta Cloud API payload (no secrets). */
export function extractMetaInboundMessages(payload) {
  const out = [];
  if (!payload || payload.object !== 'whatsapp_business_account') return out;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      for (const msg of value.messages || []) {
        out.push({
          inboundMessageId: msg.id,
          fromE164: msg.from || null,
          messageType: msg.type || null,
          text: msg.text?.body || null,
          phoneNumberId,
          occurredAtMs: msg.timestamp ? Number(msg.timestamp) * 1000 : null,
        });
      }
    }
  }
  return out;
}

export default async function whatsappWebhookHandler(req, res, dependencies = {}) {
  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) {
    return res.status(503).json({ success: false, error: configured?.error || 'server_not_configured' });
  }

  // —— GET: subscription verification ——
  if (req.method === 'GET') {
    const query = req.query || {};
    const tokenResult = await (dependencies.getMetaVerifyToken || getMetaVerifyToken)();
    if (!tokenResult.ok) {
      return res.status(503).json({ success: false, error: tokenResult.error });
    }
    const verified = verifyMetaSubscription({
      mode: query['hub.mode'] || query.hub_mode,
      token: query['hub.verify_token'] || query.hub_verify_token,
      challenge: query['hub.challenge'] || query.hub_challenge,
      expectedToken: tokenResult.value,
    });
    if (!verified.ok) return res.status(403).json({ success: false, error: verified.error });
    res.statusCode = 200;
    res.setHeader?.('Content-Type', 'text/plain');
    if (typeof res.send === 'function') return res.send(verified.challenge);
    if (typeof res.end === 'function') return res.end(verified.challenge);
    return res.status(200).json({ success: true, challenge: verified.challenge });
  }

  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  // —— POST: signature + create events ——
  const secretResult = await (dependencies.getMetaAppSecret || getMetaAppSecret)();
  if (!secretResult.ok) {
    return res.status(503).json({ success: false, error: secretResult.error });
  }

  const rawBody = dependencies.rawBody != null
    ? dependencies.rawBody
    : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
  const signatureHeader = getHeader(req, 'x-hub-signature-256');
  const sig = verifyMetaSignature(rawBody, signatureHeader, secretResult.value);
  if (!sig.ok) {
    return res.status(401).json({ success: false, error: sig.error });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch {
      return res.status(400).json({ success: false, error: 'invalid_json' });
    }
  }

  const messages = extractMetaInboundMessages(payload);
  // Status-only callbacks: acknowledge without inbound create
  if (messages.length === 0) {
    return res.status(200).json({ success: true, accepted: 0, duplicates: 0, ignored: true });
  }

  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  const now = dependencies.now ?? Date.now();
  let accepted = 0;
  let duplicates = 0;
  let unresolved = 0;

  for (const msg of messages) {
    if (!msg.inboundMessageId) continue;
    const networkId = await (dependencies.resolveNetworkIdByPhoneNumberId
      || resolveNetworkIdByPhoneNumberId)(db, msg.phoneNumberId);
    if (!networkId) {
      unresolved += 1;
      continue;
    }
    const result = await createInboundEvent(db, {
      providerId: WHATSAPP_PROVIDER_META,
      networkId,
      inboundMessageId: msg.inboundMessageId,
      fromE164: msg.fromE164,
      messageType: msg.messageType,
      text: msg.text,
      occurredAtMs: msg.occurredAtMs,
      now,
    });
    if (result.ok && result.duplicate) duplicates += 1;
    else if (result.ok) accepted += 1;
  }

  // Always 200 after valid signature so Meta does not retry forever on business rejects
  return res.status(200).json({
    success: true,
    accepted,
    duplicates,
    unresolved,
  });
}
