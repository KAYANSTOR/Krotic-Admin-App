// ============================================================
// Krotak Pro — Android Integration Contracts & Lifecycle Engine
// عقود التكامل الرسمية بين لوحة الإدارة وتطبيق Android (Krotak Pro)
// ------------------------------------------------------------
// الإصدار: 1.0.0 (Versioned Contract)
// يحدد الحالات الدقيقة للتطبيق، والتحقق الخادمي من ACK،
// وفصل المحافظ كمصادر رسائل، وفصل الاستحقاقات عن عقود Lease الموقعة.
// ============================================================

import { createHash } from 'node:crypto';

export const CONTRACT_VERSION = '1.0.0';

/**
 * حالات دورة حياة التطبيق على أجهزة Android
 * تنبيه صارم: لا يجوز عرض "مطبّق على الجهاز" إلا بحالة APPLIED_LOCALLY أو PARSER_REFRESHED
 * بناء على ACK موثوق ومطابق لرقم الإصدار والبصمة ومعرف التثبيت.
 */
export const APPLICATION_LIFECYCLE_STATES = Object.freeze({
  DRAFT: 'Draft',
  PUBLISHED_CENTRALLY: 'Published centrally',
  FETCHED: 'Fetched',
  CACHED: 'Cached',
  APPLIED_LOCALLY: 'Applied locally',
  PARSER_REFRESHED: 'Parser refreshed',
  CONFLICT: 'Conflict',
  FAILED: 'Failed',
  UNKNOWN: 'Unknown',
});

export const VALID_ACK_STATUSES = Object.freeze([
  'applied',
  'cached',
  'fetched',
  'failed',
  'conflict',
]);

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeString(value, maxLen = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen;
}

/**
 * يحسب بصمة الهاش القياسية لمحتوى الإصدار
 */
export function computeTemplatePayloadHash(payload) {
  const serialized = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * يتحقق من صحة حمولة ACK القادمة من تطبيق Android
 * العقد المقترح:
 * {
 *   schemaVersion: 1,
 *   uid: string,
 *   installationId: string,
 *   releaseId: string,
 *   payloadHash: string (64 hex sha256),
 *   status: 'applied' | 'cached' | 'fetched' | 'failed' | 'conflict',
 *   appliedAt: string (ISO8601) | number (ms),
 *   walletsCount: number (int >= 0),
 *   transferTemplatesCount: number (int >= 0),
 *   outboundTemplatesCount: number (int >= 0),
 *   conflictsCount: number (int >= 0),
 *   parserRefreshed: boolean,
 *   appVersion?: string,
 *   appBuild?: number,
 *   failureReason?: string
 * }
 */
export function validateTemplateAckPayload(rawPayload, expectedRelease = null) {
  if (!isRecord(rawPayload)) {
    return { ok: false, error: 'payload_must_be_an_object' };
  }

  const {
    schemaVersion = rawPayload.ackVersion || 1,
    uid,
    installationId,
    releaseId,
    payloadHash,
    status = rawPayload.outcome || 'applied',
    appliedAt,
    walletsCount = rawPayload.insertedCount ?? 0,
    transferTemplatesCount = 0,
    outboundTemplatesCount = 0,
    conflictsCount = rawPayload.conflictCount ?? 0,
    parserRefreshed = false,
    appVersion = null,
    appBuild = null,
    failureReason = null,
  } = rawPayload;

  if (schemaVersion !== 1 && schemaVersion !== 2) {
    return { ok: false, error: 'unsupported_schema_version' };
  }

  if (!isSafeString(uid, 128) || !SAFE_ID.test(uid)) {
    return { ok: false, error: 'uid_invalid' };
  }

  if (!isSafeString(installationId, 128) || !SAFE_ID.test(installationId)) {
    return { ok: false, error: 'installation_id_invalid' };
  }

  if (!isSafeString(releaseId, 128) || !SAFE_ID.test(releaseId)) {
    return { ok: false, error: 'release_id_invalid' };
  }

  if (typeof payloadHash !== 'string' || !HEX_SHA256.test(payloadHash.toLowerCase())) {
    return { ok: false, error: 'payload_hash_invalid' };
  }

  if (!VALID_ACK_STATUSES.includes(status)) {
    return { ok: false, error: 'status_invalid' };
  }

  // التحقق من توقيت التطبيق
  let appliedAtMs = null;
  if (typeof appliedAt === 'number' && Number.isFinite(appliedAt) && appliedAt > 1_600_000_000_000) {
    appliedAtMs = Math.round(appliedAt);
  } else if (typeof appliedAt === 'string') {
    const parsed = Date.parse(appliedAt);
    if (Number.isFinite(parsed) && parsed > 1_600_000_000_000) {
      appliedAtMs = parsed;
    }
  }
  if (appliedAtMs === null) {
    return { ok: false, error: 'applied_at_invalid' };
  }

  // التحقق من الأعداد
  const counts = [
    ['walletsCount', walletsCount],
    ['transferTemplatesCount', transferTemplatesCount],
    ['outboundTemplatesCount', outboundTemplatesCount],
    ['conflictsCount', conflictsCount],
  ];

  for (const [name, val] of counts) {
    if (!Number.isInteger(val) || val < 0 || val > 100_000) {
      return { ok: false, error: `${name}_invalid` };
    }
  }

  if (typeof parserRefreshed !== 'boolean') {
    return { ok: false, error: 'parser_refreshed_invalid' };
  }

  if ((status === 'failed' || status === 'conflict') && (!isSafeString(failureReason, 500))) {
    return { ok: false, error: 'failure_reason_required_for_error_status' };
  }

  if (appVersion !== null && (typeof appVersion !== 'string' || appVersion.length > 32)) {
    return { ok: false, error: 'app_version_invalid' };
  }

  if (appBuild !== null && (!Number.isInteger(appBuild) || appBuild < 0)) {
    return { ok: false, error: 'app_build_invalid' };
  }

  // مطابقة الإصدار المتوقع والبصمة إن توفر الإصدار المنشور
  if (expectedRelease) {
    if (expectedRelease.releaseId && expectedRelease.releaseId !== releaseId) {
      return {
        ok: false,
        error: 'release_id_mismatch',
        details: { expected: expectedRelease.releaseId, received: releaseId },
      };
    }

    const expectedHash = expectedRelease.payloadHash
      || expectedRelease.payloadHashSha256
      || (expectedRelease.payload ? computeTemplatePayloadHash(expectedRelease.payload) : null);
    if (expectedHash && expectedHash.toLowerCase() !== payloadHash.toLowerCase()) {
      return {
        ok: false,
        error: 'payload_hash_mismatch',
        details: { expected: expectedHash, received: payloadHash },
      };
    }
  }

  const sanitized = {
    schemaVersion,
    uid,
    installationId,
    releaseId,
    payloadHash: payloadHash.toLowerCase(),
    status,
    appliedAtMs,
    appliedAtIso: new Date(appliedAtMs).toISOString(),
    walletsCount,
    transferTemplatesCount,
    outboundTemplatesCount,
    conflictsCount,
    parserRefreshed,
    appVersion: appVersion ? appVersion.trim() : null,
    appBuild,
    failureReason: failureReason ? failureReason.trim() : null,
  };

  return { ok: true, value: sanitized };
}

/**
 * يحدد حالة النشر والتطبيق الفعلي لجهاز محدد بناءً على بيانات الإصدار وACK المستلم
 */
export function resolveDeviceReleaseStatus(deviceAck, publishedRelease) {
  if (!publishedRelease) {
    return {
      state: APPLICATION_LIFECYCLE_STATES.UNKNOWN,
      verifiedOnDevice: false,
      label: 'غير معروف (لا يوجد إصدار منشور)',
      code: 'no_published_release',
    };
  }

  if (!deviceAck) {
    return {
      state: APPLICATION_LIFECYCLE_STATES.PUBLISHED_CENTRALLY,
      verifiedOnDevice: false,
      label: 'منشور مركزياً (بانتظار مزامنة الجهاز)',
      code: 'awaiting_device_sync',
      releaseId: publishedRelease.releaseId,
    };
  }

  // فحص أخطاء التطبيق
  if (deviceAck.status === 'failed' || deviceAck.status === 'conflict') {
    return {
      state: APPLICATION_LIFECYCLE_STATES.FAILED,
      verifiedOnDevice: false,
      label: 'فشل التطبيق على الجهاز',
      code: deviceAck.status === 'conflict' ? 'device_conflict' : 'device_apply_failed',
      reason: deviceAck.failureReason || 'unknown_failure',
      installationId: deviceAck.installationId,
    };
  }

  // فحص تعارض البصمة
  const expectedHash = (publishedRelease.payloadHash || computeTemplatePayloadHash(publishedRelease.payload)).toLowerCase();
  const ackHash = String(deviceAck.payloadHash || '').toLowerCase();

  if (deviceAck.releaseId === publishedRelease.releaseId && ackHash !== expectedHash) {
    return {
      state: APPLICATION_LIFECYCLE_STATES.CONFLICT,
      verifiedOnDevice: false,
      label: 'تعارض بصمة المحتوى',
      code: 'payload_hash_mismatch',
      reason: 'بصمة الإصدار المستلم من الجهاز لا تطابق بصمة الإصدار المنشور في الخادم',
      installationId: deviceAck.installationId,
    };
  }

  // فحص إصدار قديم مطبق
  if (deviceAck.releaseId !== publishedRelease.releaseId) {
    return {
      state: APPLICATION_LIFECYCLE_STATES.UNKNOWN,
      verifiedOnDevice: false,
      label: 'إصدار سابق مطبق على الجهاز (يحتاج تحديث)',
      code: 'device_release_outdated',
      appliedReleaseId: deviceAck.releaseId,
      publishedReleaseId: publishedRelease.releaseId,
      installationId: deviceAck.installationId,
    };
  }

  // نجاح كامل مع تحديث محرك التحليل
  if (deviceAck.status === 'applied' && deviceAck.parserRefreshed === true) {
    return {
      state: APPLICATION_LIFECYCLE_STATES.PARSER_REFRESHED,
      verifiedOnDevice: true,
      label: 'مطبّق ومفعّل في محرك التحليل المحلي',
      code: 'applied_and_parser_refreshed',
      appliedAtIso: deviceAck.appliedAtIso,
      installationId: deviceAck.installationId,
      walletsCount: deviceAck.walletsCount,
      transferTemplatesCount: deviceAck.transferTemplatesCount,
      outboundTemplatesCount: deviceAck.outboundTemplatesCount,
    };
  }

  // تطبيق محلي في Drift لكن المحلل لم يبلغ عن إعادة التحميل
  if (deviceAck.status === 'applied') {
    return {
      state: APPLICATION_LIFECYCLE_STATES.APPLIED_LOCALLY,
      verifiedOnDevice: true,
      label: 'مطبّق في قاعدة Drift المحلية',
      code: 'applied_in_drift_local_db',
      appliedAtIso: deviceAck.appliedAtIso,
      installationId: deviceAck.installationId,
    };
  }

  if (deviceAck.status === 'cached') {
    return {
      state: APPLICATION_LIFECYCLE_STATES.CACHED,
      verifiedOnDevice: false,
      label: 'محفوظ في التخزين المؤقت المحلي (لم يُدمج بعد)',
      code: 'cached_locally',
      installationId: deviceAck.installationId,
    };
  }

  if (deviceAck.status === 'fetched') {
    return {
      state: APPLICATION_LIFECYCLE_STATES.FETCHED,
      verifiedOnDevice: false,
      label: 'تم جلب الإصدار من الخادم (قيد المعالجة)',
      code: 'fetched_from_server',
      installationId: deviceAck.installationId,
    };
  }

  return {
    state: APPLICATION_LIFECYCLE_STATES.UNKNOWN,
    verifiedOnDevice: false,
    label: 'حالة غير محددة',
    code: 'unknown_ack_state',
    installationId: deviceAck.installationId,
  };
}

/**
 * تعريفات الاستحقاقات المدفوعة ومستوياتها
 * مفصولة كلياً عن توقيع عقد Lease المربوط بالجهاز
 */
export const FEATURE_ENTITLEMENT_TIERS = Object.freeze({
  BASIC: {
    tierId: 'BASIC',
    label: 'الأساسية',
    maxPosCount: 1,
    allowNotificationSource: false,
    allowCustomSmsVariables: false,
    allowOfflineOutboxSync: true,
    allowMultiDevice: false,
  },
  PRO: {
    tierId: 'PRO',
    label: 'الاحترافية',
    maxPosCount: 5,
    allowNotificationSource: true,
    allowCustomSmsVariables: true,
    allowOfflineOutboxSync: true,
    allowMultiDevice: false,
  },
  ENTERPRISE: {
    tierId: 'ENTERPRISE',
    label: 'المؤسسية',
    maxPosCount: 50,
    allowNotificationSource: true,
    allowCustomSmsVariables: true,
    allowOfflineOutboxSync: true,
    allowMultiDevice: true,
  },
});

/**
 * يتحقق من صحة خريطة الاستحقاقات المدفوعة
 */
export function validateFeatureEntitlements(raw) {
  if (!isRecord(raw)) return { ok: false, error: 'entitlements_must_be_object' };

  const tierId = raw.tierId || 'BASIC';
  if (!FEATURE_ENTITLEMENT_TIERS[tierId]) {
    return { ok: false, error: 'invalid_entitlement_tier' };
  }

  const base = FEATURE_ENTITLEMENT_TIERS[tierId];

  const maxPosCount = raw.maxPosCount != null ? Number(raw.maxPosCount) : base.maxPosCount;
  if (!Number.isInteger(maxPosCount) || maxPosCount < 1 || maxPosCount > 500) {
    return { ok: false, error: 'max_pos_count_invalid' };
  }

  const allowNotificationSource = typeof raw.allowNotificationSource === 'boolean'
    ? raw.allowNotificationSource
    : base.allowNotificationSource;

  const allowCustomSmsVariables = typeof raw.allowCustomSmsVariables === 'boolean'
    ? raw.allowCustomSmsVariables
    : base.allowCustomSmsVariables;

  const allowOfflineOutboxSync = typeof raw.allowOfflineOutboxSync === 'boolean'
    ? raw.allowOfflineOutboxSync
    : base.allowOfflineOutboxSync;

  const allowMultiDevice = typeof raw.allowMultiDevice === 'boolean'
    ? raw.allowMultiDevice
    : base.allowMultiDevice;

  return {
    ok: true,
    value: {
      tierId,
      maxPosCount,
      allowNotificationSource,
      allowCustomSmsVariables,
      allowOfflineOutboxSync,
      allowMultiDevice,
      effectiveFrom: raw.effectiveFrom || new Date().toISOString(),
    },
  };
}

/**
 * نماذج اختبار اصطناعية غير حساسة وموثقة صراحة بأنها ليست بيانات إنتاجية
 */
export const SYNTHETIC_CONTRACT_FIXTURES = Object.freeze({
  _disclaimer: 'SYNTHETIC_NON_PRODUCTION_FIXTURE_DO_NOT_USE_IN_PRODUCTION',

  // 1. المحافظ كمعرّف لمصدر الرسائل فقط (بدون أي أرصدة مالية)
  wallets: [
    {
      _nonProduction: true,
      id: 'synth-wallet-kuraimi',
      name: 'الكريمي جوال (تجريبي اصطناعي)',
      status: 'active',
      sourceMode: 'sms',
      senderId: 'Kuraimi',
      packageName: 'com.kuraimi.bank.test',
      createdAt: '2026-10-19T00:00:00.000Z',
    },
    {
      _nonProduction: true,
      id: 'synth-wallet-jeeb',
      name: 'محفظة جيب (تجريبي اصطناعي)',
      status: 'active',
      sourceMode: 'notification',
      senderId: 'Jeeb',
      packageName: 'com.jeeb.wallet.test',
      createdAt: '2026-10-19T00:00:00.000Z',
    },
  ],

  // 2. قوالب التحويل الواردة
  transferTemplates: [
    {
      _nonProduction: true,
      id: 'synth-transfer-kuraimi-01',
      name: 'تحويل وارد الكريمي (اصطناعي)',
      pattern: 'تم تحويل مبلغ {amount} ريال الى {phone}',
      identifierKind: 'phone',
      walletId: 'synth-wallet-kuraimi',
      priority: 10,
      isActive: true,
      requireReference: false,
      sampleBody: 'تم تحويل مبلغ 5000 ريال الى 771234567',
    },
    {
      _nonProduction: true,
      id: 'synth-transfer-pos-02',
      name: 'استلام نقطة بيع مع مرجع (اصطناعي)',
      pattern: 'عملية شراء {amount} مرجع {ref} لحساب {account}',
      identifierKind: 'account',
      walletId: 'synth-wallet-kuraimi',
      posId: 'POS-TEST-01',
      priority: 20,
      isActive: true,
      requireReference: true,
      sampleBody: 'عملية شراء 12000 مرجع TX-9988 لحساب 10203040',
    },
  ],

  // 3. الرسائل الصادرة (مفصولة تماماً عن إشعارات FCM)
  outboundTemplates: [
    {
      _nonProduction: true,
      key: 'customer_debt_payment_template',
      body: 'تم استلام دفعة بقيمة {amount} ريال لحسابكم. شكراً لتعاملكم معنا.',
      scope: 'outboundCustomer',
      requiredVariables: ['amount'],
    },
    {
      _nonProduction: true,
      key: 'pos_instant_charge_confirm_template',
      body: 'تأكيد شحن فوري بمبلغ {amount} ريال للرقم {customer_phone}',
      scope: 'outboundPos',
      requiredVariables: ['amount', 'customer_phone'],
    },
  ],

  // 4. استجابة ACK ناجحة من جهاز Android
  validAppliedAck: {
    _nonProduction: true,
    schemaVersion: 1,
    uid: 'synth-user-uid-101',
    installationId: 'synth-inst-uuid-202',
    releaseId: 'rel-global-v1',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'applied',
    appliedAt: 1_771_400_000_000,
    walletsCount: 2,
    transferTemplatesCount: 2,
    outboundTemplatesCount: 2,
    conflictsCount: 0,
    parserRefreshed: true,
    appVersion: '1.0.15',
    appBuild: 15,
  },

  // 5. استجابة ACK فاشلة مع سبب موثق
  failedConflictAck: {
    _nonProduction: true,
    schemaVersion: 1,
    uid: 'synth-user-uid-101',
    installationId: 'synth-inst-uuid-202',
    releaseId: 'rel-global-v1',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    status: 'failed',
    appliedAt: 1_771_400_000_000,
    walletsCount: 0,
    transferTemplatesCount: 0,
    outboundTemplatesCount: 0,
    conflictsCount: 1,
    parserRefreshed: false,
    failureReason: 'drift_table_lock_or_constraint_failed',
    appVersion: '1.0.15',
    appBuild: 15,
  },

  // 6. خريطة استحقاقات مدفوعة
  featureEntitlements: {
    _nonProduction: true,
    tierId: 'PRO',
    maxPosCount: 5,
    allowNotificationSource: true,
    allowCustomSmsVariables: true,
    allowOfflineOutboxSync: true,
    allowMultiDevice: false,
    effectiveFrom: '2026-10-19T00:00:00.000Z',
  },

  // 7. محاكاة عقد Lease موقّع (للمقارنة وتأكيد الانفصال)
  mockSignedLease: {
    _nonProduction: true,
    leaseId: 'lease-synth-789',
    uid: 'synth-user-uid-101',
    installationId: 'synth-inst-uuid-202',
    serverTime: 1_771_400_000_000,
    expiry: 1_774_000_000_000,
    accessStatus: 'ACTIVE_PAID',
    signatureAlgorithm: 'Ed25519',
    keyId: 'ed25519-krotak-2026-10-v1',
    signature: 'mock_signature_hex_or_base64_for_testing_only',
  },
});
