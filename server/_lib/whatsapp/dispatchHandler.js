/**
 * Delivery dispatch — service secret only. Never trusts client saleUuid/card data.
 * Processes existing whatsapp_delivery_operations from DB.
 * Cloud Tasks/Scheduler wiring is a separate readiness step.
 */
import { timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { getDispatchServiceSecret } from './secrets.js';
import {
  DELIVERY_OPS_COLLECTION,
  tryStartSmsFallback,
  transitionDeliveryStatus,
} from './deliveryOperations.js';
import { isWhatsappDeadlineExpired } from './deliveryState.js';
import { isWhatsappCardDeliveryEnabled } from './entitlementsGate.js';

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

export default async function whatsappDispatchHandler(req, res, dependencies = {}) {
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
    return res.status(403).json({ success: false, error: 'dispatch_forbidden' });
  }

  // Reject any client-style card/sale injection in body — dispatch only reads DB.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.saleUuid || body.pin || body.cardNumber || body.cardPayload) {
    return res.status(400).json({ success: false, error: 'client_payload_forbidden' });
  }

  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  const now = dependencies.now ?? Date.now();
  const limit = Math.min(Number(body.limit) || 20, 50);

  // Collect candidate ops from in-memory store or limited queries
  const candidates = [];
  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith(`${DELIVERY_OPS_COLLECTION}/`) && data) {
        candidates.push({ id: path.slice(DELIVERY_OPS_COLLECTION.length + 1), data });
      }
    }
  }

  let smsStarted = 0;
  let skipped = 0;
  let processed = 0;

  for (const item of candidates.slice(0, limit)) {
    const { id, data } = item;
    processed += 1;

    // Entitlement re-check (Fail-Closed)
    if (data.ownerUid) {
      const userSnap = await db.collection('users').doc(data.ownerUid).get();
      const features = userSnap.exists ? (userSnap.data() || {}).account_features : null;
      if (!isWhatsappCardDeliveryEnabled(features)) {
        skipped += 1;
        continue;
      }
    }

    if (
      data.status === 'sent'
      && isWhatsappDeadlineExpired(data.whatsappDeadlineAtMs, now)
      && data.smsFallbackSentAtMs == null
    ) {
      const result = await tryStartSmsFallback(db, id, now);
      if (result.ok) smsStarted += 1;
      else skipped += 1;
      continue;
    }

    skipped += 1;
  }

  return res.status(200).json({
    success: true,
    processed,
    smsStarted,
    skipped,
    note: 'Cloud Tasks/Scheduler not wired until GCP readiness verified',
  });
}
