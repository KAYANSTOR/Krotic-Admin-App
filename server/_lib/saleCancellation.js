// ============================================================
// إلغاء بيع من جهاز مالك الشبكة — POST /api/sales/cancel (#24)
// ------------------------------------------------------------
// قرارا المالك O-08 / O-07 (ق11 / ق12 في docs/BASELINE_AR.md):
//   - جهاز المالك هو المصدر الوحيد للإلغاء، وبنفس توثيق sales/ingest.
//   - البيع غير المدفوع (paidRiyal == 0 و PENDING_SETTLEMENT) يُعلَّم
//     CANCELLED في مستنده الأصلي (لا يُحذف، ولا تتغير حقول الرفع)، وتُعكس
//     قيمته وعمولته من إجماليات الشبكة في نفس المعاملة (بحد أدنى صفر).
//   - البيع الذي عليه أي دفعة لا يُلغى آليًا: 409 sale_already_settled
//     ويُسجَّل الطلب في sale_cancellation_registry لمراجعة الإدارة.
//   - الإلغاء idempotent على مستوى البيع: إعادة الطلب تعيد ACK بلا كتابة.
// ============================================================

import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { saleDocumentId } from './saleIdentity.js';
import { normalizeBody, resolveSaleUuid, serverOwnedFieldError } from './clientSaleRequest.js';
import { signCanonicalReceipt, verifyCanonicalReceiptWithCandidates } from './clientRequestAuth.js';

export const CANCEL_REASONS = Object.freeze([
  'device_reversal', 'customer_return', 'delivery_failed', 'operator_error',
]);
export const CANCELLATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
export const CANCELLED_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
export const SALE_CANCELLED_AUDIT_ACTION = 'SALE_CANCELLED_BY_DEVICE';
export const CANCELLATION_REGISTRY = 'sale_cancellation_registry';

const CANCEL_ALLOWED_FIELDS = new Set(['saleId', 'saleUuid', 'cancellationId', 'cancelledMs', 'reason']);
const PAID_SETTLEMENT_STATUSES = new Set(['PARTIAL', 'SETTLED']);

/** Client rule (documented for the app): deterministic, so every retry has the same id. */
export function cancellationIdFor(saleUuid) {
  return `cxl_${createHash('sha256').update(`sale_cancel:${saleUuid}`).digest('hex').slice(0, 32)}`;
}

export function validateCancelInput(body) {
  const input = normalizeBody(body);
  const fieldError = serverOwnedFieldError(input, CANCEL_ALLOWED_FIELDS);
  if (fieldError) return { ok: false, error: fieldError };

  const sale = resolveSaleUuid(input);
  if (!sale.ok) return sale;

  if (input.cancellationId == null || input.cancellationId === '') {
    return { ok: false, error: 'cancellation_id_required' };
  }
  if (typeof input.cancellationId !== 'string' || !CANCELLATION_ID_PATTERN.test(input.cancellationId)) {
    return { ok: false, error: 'cancellation_id_invalid' };
  }

  // JSON integer only; strings/booleans are not coerced (same rule as createdMs).
  const { cancelledMs } = input;
  if (typeof cancelledMs !== 'number' || !Number.isSafeInteger(cancelledMs) || cancelledMs <= 0) {
    return { ok: false, error: 'cancelled_at_invalid' };
  }

  if (input.reason == null || input.reason === '') return { ok: false, error: 'reason_required' };
  if (typeof input.reason !== 'string' || !CANCEL_REASONS.includes(input.reason)) {
    return { ok: false, error: 'reason_invalid' };
  }

  return {
    ok: true,
    value: {
      saleId: sale.saleUuid,
      saleUuid: sale.saleUuid,
      cancellationId: input.cancellationId,
      cancelledMs,
      reason: input.reason,
    },
  };
}

/** Exact key order is part of the signed bytes (see contracts/schemas/sales-cancel-request). */
export function canonicalCancelPayload(input) {
  return JSON.stringify({
    saleId: input.saleUuid ?? input.saleId,
    uid: input.uid,
    cancellationId: input.cancellationId,
    cancelledMs: input.cancelledMs,
    reason: input.reason,
  });
}

export function createCancelReceipt({ payload, timestamp, secret }) {
  return signCanonicalReceipt({ canonical: canonicalCancelPayload(payload), timestamp, secret });
}

export function verifyCancelReceiptWithCandidates({ token, payload, candidates, now = Date.now() }) {
  return verifyCanonicalReceiptWithCandidates({ token, canonical: canonicalCancelPayload(payload), candidates, now });
}

const finiteNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/** O-07 rule 2: any payment against the sale blocks automatic cancellation. */
export function saleHasPayment(sale) {
  return Number(sale?.paidRiyal) > 0
    || Number(sale?.paidMinor) > 0
    || PAID_SETTLEMENT_STATUSES.has(sale?.settlement_status);
}

/**
 * O-07 rule 1: only an active (COMPLETED or legacy status-less), unpaid
 * (PENDING_SETTLEMENT) sale with known server amounts can be reversed
 * automatically. Anything else needs an admin and is `sale_not_cancellable`.
 */
export function saleIsCancellable(sale) {
  const status = sale?.status;
  if (status !== undefined && status !== null && status !== 'COMPLETED') return false;
  if (sale?.settlement_status !== 'PENDING_SETTLEMENT') return false;
  return finiteNumber(sale?.amountRiyal) && finiteNumber(sale?.commissionRiyal);
}

/** Network totals after reversing one sale (each total floored at 0). */
export function reversedNetworkTotals(network, { amountRiyal, commissionRiyal }) {
  const data = network || {};
  const totalSalesAmount = Math.max(0, (Number(data.totalSalesAmount) || 0) - amountRiyal);
  const totalCommissionDue = Math.max(0, (Number(data.totalCommissionDue) || 0) - commissionRiyal);
  const totalPaidAmount = Number(data.totalPaidAmount) || 0;
  return {
    totalSalesAmount,
    totalCommissionDue,
    totalPaidAmount,
    outstandingBalance: Math.max(0, totalCommissionDue - totalPaidAmount),
  };
}

/**
 * Applies a verified cancellation in one Firestore transaction.
 * Returns { status: 'not_found' | 'already_cancelled' | 'already_settled' | 'not_cancellable' | 'cancelled', ... }.
 */
export async function cancelSale({ db, uid, networkId = uid, payload, receipt, secretVersion = null, now = Date.now() }) {
  const networkRef = db.collection('networks').doc(networkId);
  const saleDocId = saleDocumentId(payload.saleUuid);
  const saleRef = networkRef.collection('sales').doc(saleDocId);
  const registryRef = db.collection(CANCELLATION_REGISTRY).doc(`${uid}_${saleDocId}`);
  const auditRef = db.collection('admin_audit_logs').doc(`sale_cancel_${saleDocId}`);

  return db.runTransaction(async (transaction) => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists) return { status: 'not_found', saleUuid: payload.saleUuid };
    const sale = saleSnap.data() || {};

    if (sale.status === 'CANCELLED') {
      return {
        status: 'already_cancelled',
        saleUuid: payload.saleUuid,
        cancellationId: sale.cancellationId || payload.cancellationId,
      };
    }

    if (saleHasPayment(sale)) {
      transaction.set(registryRef, {
        uid,
        networkId,
        saleUuid: payload.saleUuid,
        saleDocumentId: saleDocId,
        cancellationId: payload.cancellationId,
        cancelReason: payload.reason,
        cancelledAtMs: payload.cancelledMs,
        reason: 'sale_already_settled',
        paidRiyal: Number(sale.paidRiyal) || 0,
        settlementStatus: sale.settlement_status ?? null,
        verificationReceipt: receipt,
        recordedAt: FieldValue.serverTimestamp(),
        recordedAtMs: now,
      }, { merge: false });
      return { status: 'already_settled', saleUuid: payload.saleUuid };
    }

    if (!saleIsCancellable(sale)) return { status: 'not_cancellable', saleUuid: payload.saleUuid };

    // Firestore requires every transaction read before the first write.
    const networkSnap = await transaction.get(networkRef);
    const amountRiyal = Number(sale.amountRiyal);
    const commissionRiyal = Number(sale.commissionRiyal);

    // Merge only the cancellation fields: ingest fields, payloadHash,
    // verificationReceipt and createdAt stay exactly as they were.
    transaction.set(saleRef, {
      status: 'CANCELLED',
      settlement_status: 'CANCELLED',
      cancellationId: payload.cancellationId,
      cancelReason: payload.reason,
      cancelledAtMs: payload.cancelledMs,
      cancelledAt: new Date(payload.cancelledMs),
      cancelReceivedAtMs: now,
      cancelVerificationReceipt: receipt,
      cancelledAmountRiyal: amountRiyal,
      cancelledCommissionRiyal: commissionRiyal,
      ...(secretVersion ? { cancelNetworkSecretVersion: secretVersion } : {}),
      updatedAtMs: now,
    }, { merge: true });

    transaction.set(networkRef, {
      ...reversedNetworkTotals(networkSnap.exists ? networkSnap.data() : {}, { amountRiyal, commissionRiyal }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    }, { merge: true });

    transaction.set(auditRef, {
      action: 'SALE_CANCELLED_BY_DEVICE',
      actorUid: uid,
      uid,
      networkId,
      details: {
        saleUuid: payload.saleUuid,
        saleDocumentId: saleDocId,
        cancellationId: payload.cancellationId,
        reason: payload.reason,
        cancelledAtMs: payload.cancelledMs,
        reversedAmountRiyal: amountRiyal,
        reversedCommissionRiyal: commissionRiyal,
      },
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
    }, { merge: false });

    return {
      status: 'cancelled',
      saleUuid: payload.saleUuid,
      cancellationId: payload.cancellationId,
      reversedAmountRiyal: amountRiyal,
      reversedCommissionRiyal: commissionRiyal,
    };
  });
}
