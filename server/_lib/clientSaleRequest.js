// ============================================================
// قواعد جسم طلبات المبيعات القادمة من تطبيق Android
// (POST /api/sales/ingest و POST /api/sales/cancel).
// ------------------------------------------------------------
// مصدر واحد لقوائم الحقول المملوكة للخادم ولقاعدة معرّف البيع، كي لا
// يقبل مسارٌ حقلًا يرفضه الآخر. أي حقل هوية أو مال أو تسوية من العميل
// يُرفض بنفس رموز الخطأ في كل المسارات.
// ============================================================

import { MAX_SALE_ID_LENGTH, SALE_ID_PATTERN } from './saleIdentity.js';

// These fields are server-owned. Presence is rejected even when the client
// sends a zero/false value; silently ignoring such fields hides contract bugs.
export const CLIENT_IDENTITY_FIELDS = Object.freeze([
  'uid', 'userId', 'accountId', 'owner_uid', 'networkId', 'network_id',
]);
export const CLIENT_FINANCIAL_FIELDS = Object.freeze([
  'amount', 'amountRiyal', 'faceValue', 'face_value',
  'commission', 'commissionAmount', 'commissionMinor', 'commissionRiyal',
  'commissionRate', 'commissionRateBps', 'commission_rate', 'commission_rate_bps',
  'netAmount', 'netAmountMinor', 'paidMinor', 'paidRiyal',
  'settlement_status', 'settlementStatus', 'is_settled', 'settled',
  'settlementId', 'settledAt', 'settledBy',
  'moneyPolicyVersion', 'payloadPolicyVersion', 'verified',
  'verificationReceipt', 'verification_receipt',
  'status', 'source', 'outstandingBalance', 'totalSalesAmount',
  'totalCommissionDue', 'totalPaidAmount',
]);

export function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

const has = (input, field) => Object.prototype.hasOwnProperty.call(input, field);

/**
 * Rejects server-owned identity/financial fields first (specific codes), then
 * any field outside `allowedFields`. Returns the error code or null.
 */
export function serverOwnedFieldError(input, allowedFields) {
  if (CLIENT_IDENTITY_FIELDS.some((field) => has(input, field))) return 'client_identity_field_forbidden';
  if (CLIENT_FINANCIAL_FIELDS.some((field) => has(input, field))) return 'client_financial_field_forbidden';
  if (Object.keys(input).some((field) => !allowedFields.has(field))) return 'client_field_forbidden';
  return null;
}

/**
 * `saleUuid` is the current name, `saleId` the legacy alias. When both are
 * present they must be equal strings.
 */
export function resolveSaleUuid(input) {
  if (has(input, 'saleId') && has(input, 'saleUuid')
      && (typeof input.saleId !== 'string'
        || typeof input.saleUuid !== 'string'
        || input.saleId.trim() !== input.saleUuid.trim())) {
    return { ok: false, error: 'sale_id_mismatch' };
  }
  const saleUuid = typeof input.saleUuid === 'string' ? input.saleUuid.trim()
    : (typeof input.saleId === 'string' ? input.saleId.trim() : '');
  if (!saleUuid) return { ok: false, error: 'sale_id_required' };
  if (saleUuid.length > MAX_SALE_ID_LENGTH || !SALE_ID_PATTERN.test(saleUuid)) {
    return { ok: false, error: 'sale_id_invalid' };
  }
  return { ok: true, saleUuid };
}
