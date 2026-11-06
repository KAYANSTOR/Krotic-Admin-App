/**
 * Admin review of smsOutcomeUnknown delivery operations.
 * Actions: list | acknowledge | mark_resolved
 * NO resend action — prevents accidental duplicate SMS.
 */
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { authenticateAdmin, ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { DELIVERY_OPS_COLLECTION } from './deliveryOperations.js';

function respond(res, status, body) {
  return res.status(status).json(body);
}

function bodyObject(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export async function listUnknownSmsOutcomes(db, { networkId = null, limit = 50 } = {}) {
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const items = [];

  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (!path.startsWith(`${DELIVERY_OPS_COLLECTION}/`) || !data?.smsOutcomeUnknown) continue;
      if (networkId && data.networkId !== networkId) continue;
      items.push({ id: path.slice(DELIVERY_OPS_COLLECTION.length + 1), ...data });
    }
  } else {
    try {
      let q = db.collection(DELIVERY_OPS_COLLECTION).where('smsOutcomeUnknown', '==', true).limit(max);
      if (networkId) {
        q = db.collection(DELIVERY_OPS_COLLECTION)
          .where('smsOutcomeUnknown', '==', true)
          .where('networkId', '==', networkId)
          .limit(max);
      }
      const snap = await q.get();
      for (const doc of snap.docs || []) {
        items.push({ id: doc.id, ...doc.data() });
      }
    } catch {
      // missing index — return empty rather than 500
    }
  }

  items.sort((a, b) => (b.smsOutcomeUnknownAtMs || 0) - (a.smsOutcomeUnknownAtMs || 0));
  return items.slice(0, max).map((row) => ({
    deliveryOperationId: row.id,
    networkId: row.networkId,
    saleUuid: row.saleUuid,
    ownerUid: row.ownerUid,
    status: row.status,
    smsOutcomeUnknownReason: row.smsOutcomeUnknownReason || null,
    smsOutcomeUnknownAtMs: row.smsOutcomeUnknownAtMs || null,
    smsRequestStartedAtMs: row.smsRequestStartedAtMs || null,
    smsProviderAcceptedAtMs: row.smsProviderAcceptedAtMs || null,
    smsFallbackSentAtMs: row.smsFallbackSentAtMs || null,
    smsIdempotencyKey: row.smsIdempotencyKey || null,
    adminReviewStatus: row.adminReviewStatus || 'open',
    adminReviewedAtMs: row.adminReviewedAtMs || null,
    adminReviewedBy: row.adminReviewedBy || null,
    adminReviewNote: row.adminReviewNote || null,
  }));
}

/**
 * Mark reviewed without sending. Clears unknown flag only when action=mark_resolved
 * after explicit admin acknowledgment that no resend is needed / handled offline.
 */
export async function reviewUnknownOutcome(db, deliveryOperationId, {
  action,
  note = '',
  actorUid,
  now = Date.now(),
}) {
  if (!deliveryOperationId) return { ok: false, error: 'delivery_id_required' };
  if (!['acknowledge', 'mark_resolved'].includes(action)) {
    return { ok: false, error: 'action_invalid' };
  }

  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const cur = snap.data() || {};
  if (!cur.smsOutcomeUnknown && action === 'acknowledge') {
    return { ok: true, data: cur, note: 'already_clear' };
  }

  const next = {
    ...cur,
    adminReviewStatus: action === 'mark_resolved' ? 'resolved' : 'acknowledged',
    adminReviewedAtMs: now,
    adminReviewedBy: actorUid || null,
    adminReviewNote: String(note || '').slice(0, 500),
    updatedAtMs: now,
  };

  if (action === 'mark_resolved') {
    // Clear unknown so it leaves the review queue — does NOT enable resend
    // (smsRequestStartedAtMs / accepted remain; claim still blocks without explicit new policy)
    next.smsOutcomeUnknown = false;
    next.smsOutcomeResolvedAtMs = now;
  }

  await ref.set(next, { merge: false });
  return { ok: true, data: next };
}

export default async function whatsappUnknownOutcomeHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) return respond(res, 503, { success: false, error: configured?.error || 'server_not_configured' });

  const authorize = dependencies.authenticateAdmin || authenticateAdmin;
  const caller = await authorize(req, {
    getAuth: dependencies.getAuth || getAuth,
    getFirestore: dependencies.getFirestore || getFirestore,
  });
  if (!caller.ok) return respond(res, caller.status, { success: false, error: caller.error });

  const input = bodyObject(req.body);
  if (!input) return respond(res, 400, { success: false, error: 'invalid_json' });

  const action = input.action;
  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  const now = dependencies.now ?? Date.now();

  if (action === 'list') {
    const items = await listUnknownSmsOutcomes(db, {
      networkId: typeof input.networkId === 'string' ? input.networkId.trim() || null : null,
      limit: input.limit,
    });
    return respond(res, 200, { success: true, items, count: items.length });
  }

  if (action === 'acknowledge' || action === 'mark_resolved') {
    const result = await reviewUnknownOutcome(db, input.deliveryOperationId, {
      action,
      note: input.note,
      actorUid: caller.callerUid,
      now,
    });
    if (!result.ok) return respond(res, 400, { success: false, error: result.error });
    return respond(res, 200, {
      success: true,
      deliveryOperationId: input.deliveryOperationId,
      adminReviewStatus: result.data.adminReviewStatus,
      // never expose tokens
    });
  }

  return respond(res, 400, { success: false, error: 'unknown_action' });
}
