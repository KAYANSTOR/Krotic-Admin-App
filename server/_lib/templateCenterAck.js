// ============================================================
// ACK من Android — التحقق والتسجيل (خادمي فقط)
// ------------------------------------------------------------
// يستقبل إعلان تطبيق إصدار مركزي على جهاز، ويتحقق منه قبل اعتباره دليلًا:
//   1. مصادقة المستخدم بـ Firebase ID token (uid من الرمز، لا من الحقل).
//   2. ربط الجهاز: installationId يجب أن يطابق installation المرتبط بالحساب إن وُجد.
//   3. مطابقة الإصدار: releaseId موجود ومنشور، وpayloadHash يطابق البصمة الفعلية.
//   4. مطابقة النطاق: scopeKey يطابق نطاق الإصدار.
//   5. مقاومة التكرار: معرّف حتمي (uid+installationId+releaseId+payloadHash+outcome).
//
// لا يُخزَّن أي سر أو محتوى رسائل؛ أعداد ورموز حالة فقط.
// ============================================================

import { createHash } from 'node:crypto';

export const ACK_SCHEMA_VERSION = 1;
export const ACK_COLLECTION = 'template_center_acks';

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INSTALLATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const ACK_OUTCOMES = Object.freeze(['applied', 'partially_applied', 'failed', 'rejected']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseIntField(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * يتحقق من شكل ACK ويرجع القيمة المُنقّاة. لا يعتمد على أي حقل هوية من العميل
 * (uid يُضاف لاحقًا من الرمز الموثّق).
 */
export function validateAckInput(input) {
  if (!isPlainObject(input)) return { ok: false, error: 'ack_body_invalid' };
  if (input.ackVersion !== ACK_SCHEMA_VERSION) return { ok: false, error: 'ack_version_unsupported' };
  if (typeof input.installationId !== 'string' || !INSTALLATION_PATTERN.test(input.installationId)) {
    return { ok: false, error: 'installation_id_invalid' };
  }
  if (typeof input.releaseId !== 'string' || !RELEASE_ID_PATTERN.test(input.releaseId)) {
    return { ok: false, error: 'release_id_invalid' };
  }
  if (typeof input.payloadHash !== 'string' || !HASH_PATTERN.test(input.payloadHash)) {
    return { ok: false, error: 'payload_hash_invalid' };
  }
  if (input.scopeKey !== undefined && input.scopeKey !== 'global') {
    return { ok: false, error: 'scope_key_invalid' };
  }
  if (!ACK_OUTCOMES.includes(input.outcome)) return { ok: false, error: 'outcome_invalid' };
  if (typeof input.appliedAt !== 'string' || Number.isNaN(Date.parse(input.appliedAt))) {
    return { ok: false, error: 'applied_at_invalid' };
  }
  if (input.uid !== undefined && (typeof input.uid !== 'string' || !UID_PATTERN.test(input.uid))) {
    return { ok: false, error: 'uid_invalid' };
  }
  const insertedCount = parseIntField(input.insertedCount);
  const conflictCount = parseIntField(input.conflictCount);
  const appBuild = parseIntField(input.appBuild);
  if (insertedCount === null || conflictCount === null || appBuild === null) {
    return { ok: false, error: 'ack_counts_invalid' };
  }
  if (input.appVersion != null && (typeof input.appVersion !== 'string' || !VERSION_PATTERN.test(input.appVersion))) {
    return { ok: false, error: 'app_version_invalid' };
  }
  if (input.failureReason != null && (typeof input.failureReason !== 'string' || input.failureReason.length > 200)) {
    return { ok: false, error: 'failure_reason_invalid' };
  }
  if (input.parserRefreshed != null && typeof input.parserRefreshed !== 'boolean') {
    return { ok: false, error: 'parser_refreshed_invalid' };
  }
  return {
    ok: true,
    value: {
      installationId: input.installationId,
      releaseId: input.releaseId,
      payloadHash: input.payloadHash.toLowerCase(),
      scopeKey: input.scopeKey || 'global',
      outcome: input.outcome,
      appliedAt: input.appliedAt,
      insertedCount: insertedCount ?? 0,
      conflictCount: conflictCount ?? 0,
      parserRefreshed: input.parserRefreshed ?? null,
      failureReason: input.failureReason ?? null,
      appVersion: input.appVersion ?? null,
      appBuild: appBuild ?? null,
    },
  };
}

/** معرّف حتمي يمنع إنشاء سجل ثانٍ عند إعادة الإرسال بنفس المفتاح. */
export function ackIdempotencyKey({ uid, installationId, releaseId, payloadHash, outcome }) {
  return createHash('sha256')
    .update([uid, installationId, releaseId, payloadHash.toLowerCase(), outcome].join('|'), 'utf8')
    .digest('hex');
}

/**
 * يتحقق من ACK مقابل وثيقة الإصدار والحساب. `release` هي وثيقة
 * template_center_releases/{releaseId} أو null إن لم تُوجد.
 * `boundInstallationId` هي users/{uid}.entitlementInstallationId أو null.
 */
export function verifyAck({ ack, uid, release, boundInstallationId = null }) {
  if (!release) return { ok: false, status: 404, error: 'release_not_found' };
  if (release.status !== 'published') return { ok: false, status: 409, error: 'release_not_published' };
  if (typeof release.payloadHashSha256 !== 'string'
      || release.payloadHashSha256.toLowerCase() !== ack.payloadHash) {
    return { ok: false, status: 409, error: 'payload_hash_mismatch' };
  }
  const releaseScopeKey = release.scopeKey || 'global';
  if (releaseScopeKey !== ack.scopeKey) return { ok: false, status: 409, error: 'scope_mismatch' };
  if (boundInstallationId && boundInstallationId !== ack.installationId) {
    return { ok: false, status: 403, error: 'installation_mismatch' };
  }
  return {
    ok: true,
    record: {
      ackVersion: ACK_SCHEMA_VERSION,
      uid,
      installationId: ack.installationId,
      releaseId: ack.releaseId,
      payloadHash: ack.payloadHash,
      scopeKey: ack.scopeKey,
      scope: release.scope || { type: 'global', networkId: null },
      outcome: ack.outcome,
      appliedAt: ack.appliedAt,
      insertedCount: ack.insertedCount,
      conflictCount: ack.conflictCount,
      parserRefreshed: ack.parserRefreshed,
      failureReason: ack.failureReason,
      appVersion: ack.appVersion,
      appBuild: ack.appBuild,
      verified: true,
      deviceBound: Boolean(boundInstallationId),
    },
  };
}

/**
 * يختار أحدث ACK موثوق لنطاق معيّن من قائمة سجلات، لأغراض العرض فقط.
 * لا يُشتق أي نجاح من سجلات غير موثوقة.
 */
export function latestVerifiedAck(records = [], scopeKey = 'global') {
  return records
    .filter((record) => record?.verified === true && (record.scopeKey || 'global') === scopeKey)
    .sort((left, right) => Date.parse(right.appliedAt || 0) - Date.parse(left.appliedAt || 0))[0] || null;
}
