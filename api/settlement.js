// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/settlement — مسار التسوية الموحّد الخادمي (idempotent)
// ------------------------------------------------------------
// قرارات المالك (ج، هـ):
//   - الريال اليمني صحيح بالكامل: كل المبالغ أعداد صحيحة.
//   - مسار واحد للتسوية والمدفوعات؛ الكتابة من الخادم فقط (القواعد تمنع العميل).
//   - رصيد تراكمي وتسوية المبيعات غير المسوّاة بنظام الأقدم فالأحدث (FIFO).
//   - لا تعديل أو حذف لأي سجل بيع سابق؛ التمديد إجراء إداري صريح (30 يوماً).
// ============================================================

import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from './_lib/firebaseAdmin.js';
import { isPositiveRiyal } from './_lib/money.js';
import { parseNetworkId } from './_lib/networkId.js';
import { settleNetworkPayment } from './_lib/networkLedger.js';
import { legacyAccessFields } from './_lib/accessStatus.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SETTLEMENT_SALES = 400;

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
  if (!isPositiveRiyal(amountMinor)) return { ok: false, error: 'amount_invalid' };

  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!KEY_PATTERN.test(idempotencyKey)) return { ok: false, error: 'idempotency_key_invalid' };

  const month = typeof input.month === 'string' ? input.month.trim() : '';
  if (!MONTH_PATTERN.test(month)) return { ok: false, error: 'month_invalid' };

  const extendAccess = input.extendAccess === true;
  const extensionDays = input.extensionDays === undefined ? (extendAccess ? 30 : 0) : Number(input.extensionDays);
  if (![0, 30].includes(extensionDays)) return { ok: false, error: 'extension_days_invalid' };

  const note = typeof input.note === 'string' ? input.note.slice(0, 200) : '';
  return { ok: true, value: { uid, amountMinor, month, idempotencyKey, extensionDays, note } };
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

function formatMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-YE', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
}

export function settlementNotification(value, settlementId, callerUid) {
  const amount = new Intl.NumberFormat('ar-YE').format(value.amountMinor);
  const message = `تم سداد عمولة ${formatMonth(value.month)} بمبلغ ${amount} ريال.`;
  return {
    type: 'settlement_approved',
    title: 'تم اعتماد تسوية العمولة',
    message,
    body: message,
    settlementId,
    amountMinor: value.amountMinor,
    month: value.month,
    is_read: false,
    createdBy: callerUid,
    timestamp: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function approveSettlement({ db, callerUid, value, now = Date.now() }) {
  const settlementId = settlementDocId(value.uid, value.idempotencyKey);
  const userRef = db.collection('users').doc(value.uid);
  const userPre = await userRef.get();
  if (!userPre.exists) return { status: 'account_not_found', settlementId };
  // الرصيد التراكمي والتسويات تُخزَّن على مستند الشبكة (NET-xxxxx إن وُجد).
  const networkId = parseNetworkId(userPre.data()?.networkId) ? userPre.data().networkId : value.uid;
  const networkRef = db.collection('networks').doc(networkId);
  const settlementRef = networkRef.collection('settlements').doc(settlementId);
  const salesQuery = networkRef.collection('sales').orderBy('createdAt', 'asc').limit(MAX_SETTLEMENT_SALES);
  const notificationRef = db.collection('users').doc(value.uid).collection('notifications').doc(`settlement_${settlementId}`);
  const auditRef = db.collection('admin_audit_logs').doc(`settlement_${settlementId}`);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    amountMinor: value.amountMinor,
    month: value.month,
    extensionDays: value.extensionDays,
    note: value.note,
  })).digest('hex');

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(settlementRef);
    if (existing.exists) {
      const previous = existing.data() || {};
      if (previous.fingerprint === fingerprint) {
        const notification = await transaction.get(notificationRef);
        if (!notification.exists) transaction.set(notificationRef, settlementNotification(value, settlementId, callerUid));
        return { status: 'duplicate', settlementId };
      }
      return { status: 'conflict', settlementId };
    }

    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return { status: 'account_not_found', settlementId };
    const user = userSnap.data() || {};

    const previousEnd = toMillis(user.subscriptionEndsAt ?? user.subscription_end_date);
    const extensionApplied = value.extensionDays > 0;
    const base = Math.max(previousEnd, now);
    const nextEnd = extensionApplied ? base + value.extensionDays * DAY_MS : previousEnd;
    const endAt = extensionApplied ? new Date(nextEnd) : null;
    const accessPatch = extensionApplied
      ? {
          accessStatus: 'ACTIVE_PAID',
          ...legacyAccessFields('ACTIVE_PAID', endAt),
          subscriptionEndsAt: endAt,
        }
      : {};

    // دفتر الرصيد والتجديد يُكتبان على مستند الشبكة مرة واحدة داخل المعاملة.
    const ledger = await settleNetworkPayment(transaction, {
      networkRef,
      salesQuery,
      amountMinor: value.amountMinor,
      settlementId,
      networkAccessPatch: accessPatch,
    });
    const allocatedMinor = ledger.allocatedMinor;
    const outstandingAfterMinor = ledger.outstandingBalance;

    transaction.set(settlementRef, {
      settlementId,
      uid: value.uid,
      amountMinor: value.amountMinor,
      allocatedMinor,
      unallocatedMinor: ledger.unallocatedMinor,
      outstandingAfterMinor,
      allocations: ledger.allocations.map((entry) => ({
        id: entry.id,
        appliedMinor: entry.appliedMinor,
        fullySettled: entry.fullySettled,
      })),
      month: value.month,
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

    transaction.set(notificationRef, settlementNotification(value, settlementId, callerUid), { merge: false });

    if (extensionApplied) {
      transaction.update(userRef, {
        ...accessPatch,
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
      settledSales: ledger.settledSales,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
    }, { merge: false });

    return {
      status: 'created',
      settlementId,
      extensionApplied,
      subscriptionEndAfter: nextEnd || null,
      settledSales: ledger.settledSales,
      outstandingAfterMinor,
    };
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

