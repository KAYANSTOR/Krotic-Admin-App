import { createHmac, timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { normalizeNetworkId } from './requestAuth.js';
import { validateGatewaySessionWrite, GATEWAY_SESSIONS_COLLECTION } from './gatewaySessionStatus.js';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function bodyObject(body) {
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function canonicalStatusJson(payload) {
  const sorted = Object.fromEntries(Object.keys(payload).sort().map((key) => [key, payload[key]]));
  return JSON.stringify(sorted);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function header(req, name) {
  if (typeof req.get === 'function') return String(req.get(name) || '');
  return String(req.headers?.[name.toLowerCase()] || '');
}

function verifyCallback(req, secret, now) {
  const timestampText = header(req, 'X-Gateway-Timestamp');
  const signature = header(req, 'X-Gateway-Signature');
  const networkHeader = header(req, 'X-Network-Id').trim();
  const timestamp = Number(timestampText);
  const input = bodyObject(req.body);
  if (!secret || !/^\d{13}$/.test(timestampText) || !Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 401, error: 'gateway_timestamp_invalid' };
  }
  if (!input || Buffer.byteLength(JSON.stringify(input), 'utf8') > 8_192) {
    return { ok: false, status: 400, error: 'gateway_payload_invalid' };
  }
  const networkId = normalizeNetworkId(input.networkId);
  if (!networkId || networkId !== networkHeader || input.updatedAtMs !== timestamp) {
    return { ok: false, status: 400, error: 'gateway_payload_invalid' };
  }
  const validated = validateGatewaySessionWrite(networkId, input);
  if (!validated.ok) return { ok: false, status: 400, error: 'gateway_payload_invalid' };
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestampText}.${canonicalStatusJson(input)}`, 'utf8').digest('hex')}`;
  if (!safeEqual(signature, expected)) return { ok: false, status: 401, error: 'gateway_signature_invalid' };
  return { ok: true, networkId, data: validated.data };
}

export default async function gatewayStatusCallbackHandler(req, res, dependencies = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const now = dependencies.now ?? Date.now();
  const secret = (dependencies.getGatewayServiceToken || (() => process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN))();
  const verified = verifyCallback(req, secret, now);
  if (!verified.ok) return res.status(verified.status).json({ ok: false, error: verified.error });

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) return res.status(503).json({ ok: false, error: configured?.error || 'server_not_configured' });

  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  const ref = db.collection(GATEWAY_SESSIONS_COLLECTION).doc(verified.networkId);
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const currentUpdatedAt = snapshot.exists ? snapshot.data()?.updatedAtMs : null;
      if (Number.isSafeInteger(currentUpdatedAt) && currentUpdatedAt >= verified.data.updatedAtMs) {
        const stale = new Error('stale_gateway_update');
        stale.code = 'stale_gateway_update';
        throw stale;
      }
      transaction.set(ref, verified.data, { merge: false });
    });
  } catch (error) {
    if (error?.code === 'stale_gateway_update') return res.status(409).json({ ok: false, error: 'gateway_update_stale' });
    console.error('whatsapp gateway status persistence failed', { code: error?.code || 'unknown' });
    return res.status(503).json({ ok: false, error: 'gateway_status_persist_failed' });
  }

  return res.status(200).json({ ok: true });
}

export { verifyCallback, canonicalStatusJson };
