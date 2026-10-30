/**
 * Retention purge endpoint — separate from delivery dispatch.
 * Auth: service secret only (same class as dispatch). Never client-callable.
 */
import { timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { getDispatchServiceSecret } from './secrets.js';
import { runRetentionPass, retentionPolicySummary } from './retention.js';

function getHeader(req, name) {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function safeEqualString(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export default async function whatsappRetentionPurgeHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) {
    return res.status(503).json({ success: false, error: configured?.error || 'server_not_configured' });
  }

  const secretResult = await (dependencies.getDispatchServiceSecret || getDispatchServiceSecret)();
  if (!secretResult.ok) {
    return res.status(503).json({ success: false, error: secretResult.error });
  }

  const provided = getHeader(req, 'x-dispatch-service-secret') || getHeader(req, 'x-whatsapp-dispatch-secret');
  if (!safeEqualString(provided, secretResult.value)) {
    return res.status(403).json({ success: false, error: 'purge_forbidden' });
  }

  // Never log the secret
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.saleUuid || body.pin || body.cardNumber) {
    return res.status(400).json({ success: false, error: 'client_payload_forbidden' });
  }

  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  const now = dependencies.now ?? Date.now();
  const limit = Math.min(Number(body.limit) || 100, 500);

  if (body.policyOnly === true) {
    return res.status(200).json({ success: true, policy: retentionPolicySummary() });
  }

  const result = await runRetentionPass(db, { now, limit });
  return res.status(200).json({ success: true, ...result, policy: retentionPolicySummary() });
}
