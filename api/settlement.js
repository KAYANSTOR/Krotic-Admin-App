// POST /api/settlement — اعتماد تسوية عمولة من مدير (idempotent)
// يسجل التسوية دون تعديل أو حذف المبيعات السابقة. التمديد اختياري وصريح.

import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from './_lib/firebaseAdmin.js';

const MAX_AMOUNT_MINOR = 1_000_000_000_000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

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

export function validateSettlementInput(body) {
  const input = normalizeBody(body);
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return { ok: false, error: 'uid_invalid' };

  const amountMinor = Number(input.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'amount_invalid' };
  }

  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!KEY_PATTERN.test(idempotencyKey)) return { ok: false, error: 'idempotency_key_invalid' };

  const extendAccess = input.extendAccess === true;
  const extensionDays = input.extensionDays === undefined ? (extendAccess ? 30 : 0) : Number(input.extensionDays);
  if (![0, 30].includes(extensionDays)) return { ok: false, error: 'extension_days_invalid' };

  const note = typeof input.note === 'string' ? input.note.slice(0, 200) : '';
  return { ok: true, value: { uid, amountMinor, idempotencyKey, extensionDays, note } };
}

export function settlementDocId(uid, idempotencyKey) {
  return createHash('sha256').update(`${uid}:${idempotencyKey}`).digest('hex').slice(0, 40);
}

function toMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function approveSettlement({ db, callerUid, value, now = Date.now() }) {
  const settlementId = settlementDocId(value.uid, value.idempotencyKey);
  const settlementRef = db.collection('networks').doc(value.uid).collection('settlements').doc(settlementId);
  const userRef = db.collection('users').doc(value.uid);
  const auditRef = db.collection('admin_audit_logs').doc(`settlement_${settlementId}`);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    amountMinor: value.amountMinor,
    extensionDays: value.extensionDays,
    note: value.note,
  })).digest('hex');

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(settlementRef);
    if (existing.exists) {
      const previous = existing.data() || {};
      if (previous.fingerprint === fingerprint) return { status: 'duplicate', settlementId };
      return { status: 'conflict', settlementId };
    }

    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return { status: 'account_not_found', settlementId };
    const user = userSnap.data() || {};
    const previousEnd = toMillis(user.subscription_end_date);
    const extensionApplied = value.extensionDays > 0;
    const base = Math.max(previousEnd, now);
    const nextEnd = extensionApplied ? base + value.extensionDays * 24 * 60 * 60 * 1000 : previousEnd;

    transaction.set(settlementRef, {
      settlementId,
      uid: value.uid,
      amountMinor: value.amountMinor,
      status: 'APPROVED',
      extensionDays: value.extensionDays,
      extensionApplied,
      previousSubscriptionEnd: previousEnd || null,
      subscriptionEndAfter: nextEnd || null,
      note: value.note || null,
      idempotencyKey: value.idempotencyKey,
      fingerprint,
      approvedBy: callerUid,
      approvedAt: FieldValue.serverTimestamp(),
      recordedAtMs: now,
    }, { merge: false });

    if (extensionApplied) {
      transaction.update(userRef, {
        subscription_end_date: new Date(nextEnd),
        is_active: true,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    transaction.set(auditRef, {
      action: 'settlement_approved',
      actorUid: callerUid,
      targetType: 'network',
      targetId: value.uid,
      settlementId,
      amountMinor: value.amountMinor,
      extensionDays: value.extensionDays,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    return { status: 'created', settlementId, extensionApplied, subscriptionEndAfter: nextEnd || null };
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
  const parsed = validateSettlementInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  try {
    const result = await approveSettlement({ db: getFirestore(), callerUid: caller.callerUid, value: parsed.value });
    if (result.status === 'conflict') return res.status(409).json({ success: false, error: 'settlement_conflict', settlementId: result.settlementId });
    if (result.status === 'account_not_found') return res.status(404).json({ success: false, error: 'account_not_found' });
    return res.status(200).json({ success: true, ack: result.status === 'duplicate', ...result });
  } catch (error) {
    console.error('settlement failed', error);
    return res.status(500).json({ success: false, error: 'settlement_failed' });
  }
}
