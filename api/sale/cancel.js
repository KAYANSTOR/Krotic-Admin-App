// POST /api/sale/cancel — إلغاء/عكس بيع بإذن إداري (idempotent)
// لا يحذف وثيقة البيع؛ يضيف أثر الإلغاء ويغير حالتها فقط.

import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from '../_lib/firebaseAdmin.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export function validateCancelInput(body) {
  const input = normalizeBody(body);
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  const saleId = typeof input.saleId === 'string' ? input.saleId.trim() : '';
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!ID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
  if (!ID_PATTERN.test(saleId)) return { ok: false, error: 'sale_id_invalid' };
  if (!KEY_PATTERN.test(idempotencyKey)) return { ok: false, error: 'idempotency_key_invalid' };
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 200) : '';
  if (!reason) return { ok: false, error: 'reason_required' };
  return { ok: true, value: { uid, saleId, idempotencyKey, reason } };
}

export function cancellationDocId(uid, saleId, idempotencyKey) {
  return createHash('sha256').update(`${uid}:${saleId}:${idempotencyKey}`).digest('hex').slice(0, 40);
}

export async function cancelSale({ db, callerUid, value, now = Date.now() }) {
  const cancellationId = cancellationDocId(value.uid, value.saleId, value.idempotencyKey);
  const saleRef = db.collection('networks').doc(value.uid).collection('sales').doc(value.saleId);
  const cancellationRef = db.collection('networks').doc(value.uid).collection('sale_cancellations').doc(cancellationId);
  const auditRef = db.collection('admin_audit_logs').doc(`sale_cancel_${cancellationId}`);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    saleId: value.saleId,
    reason: value.reason,
  })).digest('hex');

  return db.runTransaction(async (transaction) => {
    const existingCancellation = await transaction.get(cancellationRef);
    if (existingCancellation.exists) {
      const previous = existingCancellation.data() || {};
      if (previous.fingerprint === fingerprint) return { status: 'duplicate', cancellationId };
      return { status: 'conflict', cancellationId };
    }

    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists) return { status: 'sale_not_found', cancellationId };
    const sale = saleSnap.data() || {};
    if (sale.status === 'CANCELLED' || sale.status === 'ROLLED_BACK') {
      return { status: 'already_cancelled', cancellationId };
    }

    transaction.set(cancellationRef, {
      cancellationId,
      saleId: value.saleId,
      uid: value.uid,
      reason: value.reason,
      originalStatus: sale.status || null,
      amountMinor: Number(sale.amountMinor) || null,
      commissionMinor: Number(sale.commissionMinor) || null,
      fingerprint,
      cancelledBy: callerUid,
      cancelledAt: FieldValue.serverTimestamp(),
      recordedAtMs: now,
    }, { merge: false });

    transaction.update(saleRef, {
      status: 'CANCELLED',
      cancellationId,
      cancellationReason: value.reason,
      cancelledBy: callerUid,
      cancelledAt: FieldValue.serverTimestamp(),
    });

    transaction.set(auditRef, {
      action: 'sale_cancelled',
      actorUid: callerUid,
      targetType: 'sale',
      targetId: value.saleId,
      networkUid: value.uid,
      cancellationId,
      reason: value.reason,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    return { status: 'created', cancellationId };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });
  const caller = await authenticateAdmin(req, { getAuth, getFirestore });
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });
  const parsed = validateCancelInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  try {
    const result = await cancelSale({ db: getFirestore(), callerUid: caller.callerUid, value: parsed.value });
    if (result.status === 'conflict') return res.status(409).json({ success: false, error: 'cancellation_conflict', cancellationId: result.cancellationId });
    if (result.status === 'sale_not_found') return res.status(404).json({ success: false, error: 'sale_not_found' });
    if (result.status === 'already_cancelled') return res.status(409).json({ success: false, error: 'sale_already_cancelled', cancellationId: result.cancellationId });
    return res.status(200).json({ success: true, ack: result.status === 'duplicate', ...result });
  } catch (error) {
    console.error('sale cancellation failed', error);
    return res.status(500).json({ success: false, error: 'cancellation_failed' });
  }
}
