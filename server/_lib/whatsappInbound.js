// ============================================================
// Inbound WhatsApp messages from the Railway gateway.
// Verifies HMAC, writes networks/{networkId}/wa_inbox/{messageId} (create only).
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from './firebaseAdmin.js';

const MAX_SKEW_MS = 5 * 60 * 1000;
const NETWORK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,200}$/;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function inboundSecret(env = process.env) {
  return String(env.WHATSAPP_INBOUND_SECRET || '').trim();
}

export function verifyInboundSignature({ signature, timestampHeader, bodyText, secret, now = Date.now() }) {
  if (!secret || secret.length < 32) return { ok: false, error: 'inbound_secret_not_configured' };
  const ts = Number(timestampHeader);
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > MAX_SKEW_MS) {
    return { ok: false, error: 'timestamp_expired_or_invalid' };
  }
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, error: 'signature_invalid' };
  }
  const expected = createHmac('sha256', secret).update(`${ts}.${bodyText}`).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'signature_mismatch' };
  }
  return { ok: true, timestamp: ts };
}

function parseInboundBody(raw) {
  let body = raw;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return { ok: false, error: 'invalid_json' }; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_json' };
  }
  const networkId = typeof body.networkId === 'string' ? body.networkId.trim() : '';
  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const fromJid = typeof body.fromJid === 'string' ? body.fromJid : '';
  const fromPhone = body.fromPhone == null ? null
    : (typeof body.fromPhone === 'string' ? body.fromPhone.trim() || null : null);
  const timestamp = Number(body.timestamp);

  if (!NETWORK_ID_PATTERN.test(networkId)) return { ok: false, error: 'invalid_network_id' };
  if (!MESSAGE_ID_PATTERN.test(messageId)) return { ok: false, error: 'invalid_message_id' };
  if (typeof text !== 'string' || text.length === 0 || text.length > 8192) {
    return { ok: false, error: 'invalid_text' };
  }
  if (!Number.isFinite(timestamp)) return { ok: false, error: 'invalid_timestamp' };

  return {
    ok: true,
    value: {
      networkId,
      messageId,
      text,
      fromJid: fromJid || null,
      fromPhone,
      timestamp,
      pushName: typeof body.pushName === 'string' ? body.pushName.slice(0, 120) : null,
    },
  };
}

async function writeWaInbox(db, msg, { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const ref = db.collection('networks').doc(msg.networkId).collection('wa_inbox').doc(msg.messageId);
  const expiresAtMs = now + ttlMs;
  const doc = {
    networkId: msg.networkId,
    messageId: msg.messageId,
    text: msg.text,
    fromJid: msg.fromJid,
    fromPhone: msg.fromPhone,
    pushName: msg.pushName,
    timestamp: msg.timestamp,
    status: 'pending',
    receivedAt: FieldValue.serverTimestamp(),
    receivedAtMs: now,
    expiresAtMs,
  };
  try {
    await ref.create(doc);
    return { status: 'created' };
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(error?.message))) {
      return { status: 'duplicate' };
    }
    throw error;
  }
}

export default async function whatsappInboundHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const init = ensure();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error || 'server_not_configured' });

  const secret = dependencies.inboundSecret ?? inboundSecret();
  const bodyText = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body ?? {});
  const signature = String(req.headers['x-gateway-signature'] || '').trim();
  const timestampHeader = String(req.headers['x-gateway-timestamp'] || '').trim();
  const now = dependencies.now ?? Date.now();
  const rawBodyText = typeof req.rawBody === 'string' ? req.rawBody
    : Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8')
      : bodyText;

  const sig = verifyInboundSignature({
    signature,
    timestampHeader,
    bodyText: rawBodyText,
    secret,
    now,
  });
  // Prefer raw body when available; fall back to re-serialized body (Vercel parses JSON).
  if (!sig.ok) {
    // Retry with re-serialized body if rawBody path failed and body is object
    if (sig.error === 'signature_mismatch' && typeof req.body === 'object' && req.body) {
      const retry = verifyInboundSignature({
        signature,
        timestampHeader,
        bodyText: JSON.stringify(req.body),
        secret,
        now,
      });
      if (!retry.ok) {
        return res.status(401).json({ success: false, error: retry.error });
      }
    } else {
      return res.status(401).json({ success: false, error: sig.error });
    }
  }

  const parsed = parseInboundBody(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  const db = (dependencies.getFirestore || getFirestore)();
  try {
    const result = await writeWaInbox(db, parsed.value, { now });
    return res.status(200).json({ success: true, status: result.status, messageId: parsed.value.messageId });
  } catch (error) {
    console.error('whatsapp/inbound write failed', {
      networkId: parsed.value.networkId,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({ success: false, error: 'inbox_write_failed' });
  }
}

export { parseInboundBody, inboundSecret, MAX_SKEW_MS, DEFAULT_TTL_MS };
