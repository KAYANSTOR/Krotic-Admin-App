import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { signGatewayStatus, canonicalJson } from './status-signature.js';

const NETWORK_ID = /^[A-Za-z0-9_-]{6,128}$/;
const DELIVERY_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const PHONE = /^\+?[0-9]{8,15}$/;
const STATUSES = new Set(['unlinked', 'qr_pending', 'linking', 'linked', 'disconnected', 'relink_required', 'error', 'unknown']);
const STATUS_FIELDS = new Set(['networkId', 'status', 'lastSeenAtMs', 'reasonCode', 'deviceName', 'linkedAtMs', 'updatedAtMs', 'engineVersion']);

function jsonObject(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function networkFromRequest(req, res) {
  const networkId = String(req.get('X-Network-Id') || '').trim();
  if (!NETWORK_ID.test(networkId)) {
    res.status(400).json({ ok: false, error: 'network_id_invalid' });
    return null;
  }
  const body = jsonObject(req.body);
  if (body?.networkId != null && body.networkId !== networkId) {
    res.status(403).json({ ok: false, error: 'network_id_mismatch' });
    return null;
  }
  return networkId;
}

function authenticateService(token) {
  return (req, res, next) => {
    const header = String(req.get('Authorization') || '');
    const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !secureEqual(supplied, token)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    next();
  };
}

function statusPayloadValid(payload, networkId) {
  if (!payload || Object.keys(payload).some((key) => !STATUS_FIELDS.has(key))) return false;
  if (payload.networkId !== networkId || !STATUSES.has(payload.status)) return false;
  if (!Number.isSafeInteger(payload.updatedAtMs)) return false;
  if (payload.lastSeenAtMs != null && !Number.isSafeInteger(payload.lastSeenAtMs)) return false;
  if (payload.linkedAtMs != null && !Number.isSafeInteger(payload.linkedAtMs)) return false;
  if (payload.reasonCode != null && (typeof payload.reasonCode !== 'string' || payload.reasonCode.length > 64)) return false;
  if (payload.deviceName != null && (typeof payload.deviceName !== 'string' || payload.deviceName.length > 64)) return false;
  if (payload.engineVersion != null && (typeof payload.engineVersion !== 'string' || payload.engineVersion.length > 32)) return false;
  return true;
}

function verifyStatusCallback(req, secret, now = Date.now()) {
  const timestampText = String(req.get('X-Gateway-Timestamp') || '');
  const timestamp = Number(timestampText);
  const signature = String(req.get('X-Gateway-Signature') || '');
  const payload = jsonObject(req.body);
  const networkId = String(req.get('X-Network-Id') || '').trim();
  if (!secret || !/^\d{13}$/.test(timestampText) || !Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300_000) {
    return { ok: false, error: 'callback_timestamp_invalid' };
  }
  if (!NETWORK_ID.test(networkId) || !statusPayloadValid(payload, networkId) || payload.updatedAtMs !== timestamp) {
    return { ok: false, error: 'callback_payload_invalid' };
  }
  let expected;
  try { expected = signGatewayStatus(secret, timestampText, payload); } catch { return { ok: false, error: 'callback_signature_invalid' }; }
  if (!secureEqual(signature, expected)) return { ok: false, error: 'callback_signature_invalid' };
  return { ok: true, networkId, payload };
}

export function createGatewayApp({ manager, serviceToken, statusSecret = serviceToken, statusReporter, now = Date.now }) {
  if (!manager) throw new Error('session_manager_missing');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, engine: 'baileys', version: '6.7.24' }));

  // Engine callbacks are signed, time-bounded, strictly field-allowlisted, and only forwarded to Vercel.
  app.post('/v1/engine/status-callback', async (req, res) => {
    const verified = verifyStatusCallback(req, statusSecret, now());
    if (!verified.ok) return res.status(401).json({ ok: false, error: verified.error });
    if (!statusReporter) return res.status(503).json({ ok: false, error: 'status_callback_unavailable' });
    const result = await statusReporter.report(verified.networkId, verified.payload.status, verified.payload);
    if (!result.ok) return res.status(502).json({ ok: false, error: 'status_callback_forward_failed' });
    return res.status(200).json({ ok: true });
  });

  app.use('/v1', authenticateService(serviceToken));

  app.get('/v1/session', (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const result = manager.getStatus(networkId);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/v1/session/link', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const result = await manager.start(networkId);
    if (!result.ok) return res.status(result.error === 'session_limit_reached' ? 409 : 503).json(result);
    return res.status(200).json({ ok: true, status: result.status });
  });

  app.post('/v1/session/qr', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const result = await manager.waitForQr(networkId, 6_500);
    if (result.status === 'linked') return res.status(200).json({ ok: true, status: 'linked' });
    if (!result.ok) return res.status(503).json({ ok: false, error: result.error || 'qr_not_ready' });
    return res.status(200).json({
      ok: true,
      status: 'qr_pending',
      qrImageBase64: result.qrImageBase64,
      qrExpiresAtMs: result.qrExpiresAtMs,
    });
  });

  app.post('/v1/session/relink', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const result = await manager.relink(networkId);
    if (!result.ok) return res.status(503).json(result);
    return res.status(200).json({ ok: true, status: result.status });
  });

  app.post('/v1/session/disconnect', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const result = await manager.disconnect(networkId);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  const unlink = async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const result = await manager.unlink(networkId);
    return res.status(result.ok ? 200 : 400).json(result);
  };
  app.post('/v1/session/unlink', unlink);
  app.delete('/v1/session', unlink);

  app.post('/v1/messages', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const input = jsonObject(req.body);
    const allowed = new Set(['networkId', 'deliveryId', 'destination', 'toE164', 'body', 'text', 'templateKey']);
    if (!input || Object.keys(input).some((key) => !allowed.has(key))) {
      return res.status(400).json({ ok: false, error: 'request_invalid' });
    }
    const deliveryId = String(req.get('Idempotency-Key') || input.deliveryId || '').trim();
    if (!DELIVERY_ID.test(deliveryId) || (input.deliveryId != null && input.deliveryId !== deliveryId)) {
      return res.status(400).json({ ok: false, error: 'delivery_id_invalid' });
    }
    const destination = String(input.destination ?? input.toE164 ?? '').trim();
    const body = String(input.body ?? input.text ?? '').trim();
    if (!PHONE.test(destination)) return res.status(400).json({ ok: false, error: 'destination_invalid' });
    if (!body || body.length > 4096) return res.status(400).json({ ok: false, error: 'message_body_invalid' });
    const result = await manager.sendText({ networkId, deliveryId, destination, body });
    return res.status(result.httpStatus).json(result.data);
  });

  app.get('/v1/messages', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    const messages = await manager.listMessages(networkId, req.query.limit);
    return res.status(200).json({ ok: true, messages });
  });

  app.get('/v1/messages/:deliveryId', async (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    if (!DELIVERY_ID.test(req.params.deliveryId)) return res.status(400).json({ ok: false, error: 'delivery_id_invalid' });
    const message = await manager.getMessage(networkId, req.params.deliveryId);
    return message ? res.status(200).json({ ok: true, message }) : res.status(404).json({ ok: false, error: 'delivery_not_found' });
  });

  app.get('/v1/inbound', (req, res) => {
    const networkId = networkFromRequest(req, res);
    if (!networkId) return;
    return res.status(200).json({ ok: true, messages: manager.listInbound(networkId, req.query.limit) });
  });

  app.use((_req, res) => res.status(404).json({ ok: false, error: 'route_not_found' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const isBodyError = error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed';
    return res.status(isBodyError ? 400 : 500).json({ ok: false, error: isBodyError ? 'request_invalid' : 'internal_error' });
  });
  return app;
}

export { verifyStatusCallback, canonicalJson };
