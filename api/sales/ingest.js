// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/sales/ingest — استقبال مبيعات موثّقة خادمياً (idempotent)
// ------------------------------------------------------------
// الهدف: أن يكتب الخادم سجلّ البيع الموثوق بدل أن يثق بقيم Android
// (المسودة في ANDROID_ADMIN_INTEGRATION_CONTRACT_AR.md). الخادم:
//   1) يتحقق من Firebase ID token ويستخرج UID من التوكن فقط.
//   2) يتحقق أن الحساب ليس مديراً (عملاء فقط).
//   3) يعيد حساب payloadHash من تمثيل canonical ويقارنه بالمرسل.
//   4) يعالج التكرار: نفس saleId + نفس الهاش => يعيد ACK السابق.
//      نفس saleId + هاش مختلف => تعارض مسجّل، بلا كتابة صامتة.
//   5) يكتب سجلاً معتمداً: status=COMPLETED, verified=true, source='admin_api'.
//   6) يتحقق من HMAC بمفتاح networkSecret الخاص بالشبكة، بعد فك تشفيره خادمياً.
//
// ملاحظة أمنية صريحة: الخادم لا يمنح اعتماداً مالياً إلا بعد إثبات عملية
// خارجي. لحين توفيره (قرار المالك)، يُشترط هيدر `x-verification-receipt`
// ليكون السجل `verified: true`؛ بدونه يُرفض الطلب (401). يسترد التطبيق مفتاحه
// عبر POST /api/network-secret بعد التحقق من Firebase ID Token؛ الـ Master Secret خادمي فقط.
//
// يتطلب FIREBASE_SERVICE_ACCOUNT. لا يحتاج أي كتابة عميل في Firestore.
// ============================================================

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, isAdminUid } from '../../server/_lib/firebaseAdmin.js';
import { CURRENCY, commissionFromBps } from '../../server/_lib/money.js';
import { networkSecretCandidates } from '../../server/_lib/networkSecretStore.js';
import { expiryMillis, shouldLockExpiredAccount } from '../../server/_lib/subscriptionExpiry.js';

const MAX_SALE_ID_LENGTH = 128;
const MINOR_UNITS_PER_RIYAL = 100;
const MAX_AMOUNT_RIYAL = 1_000_000_000_000;
const MAX_AMOUNT_MINOR = MAX_AMOUNT_RIYAL * MINOR_UNITS_PER_RIYAL;
const SALE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HMAC_MAX_SKEW_MS = 5 * 60 * 1000;
const SALE_CREATED_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

// These fields are server-owned. Presence is rejected even when the client
// sends a zero/false value; silently ignoring such fields hides contract bugs.
const CLIENT_IDENTITY_FIELDS = [
  'uid', 'userId', 'accountId', 'owner_uid', 'networkId', 'network_id',
];
const CLIENT_FINANCIAL_FIELDS = [
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
];
const CLIENT_ALLOWED_FIELDS = new Set([
  'saleId', 'saleUuid', 'amountMinor', 'currencyCode',
  'createdMs', 'customerId', 'cardId', 'payloadHash',
]);

function normalizeBody(body) {
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

/**
 * Canonical, version-pinned representation the server hashes. The client may
 * send its own payloadHash for diagnostics, but verification always uses this
 * server-recomputed value (never the client's).
 */
export function canonicalSalePayload(input) {
  return JSON.stringify({
    saleId: input.saleId,
    uid: input.uid,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    customerId: input.customerId || null,
    cardId: input.cardId || null,
    createdMs: input.createdMs,
  });
}

export function computePayloadHash(input) {
  return createHash('sha256').update(canonicalSalePayload(input)).digest('hex');
}

/**
 * HMAC داخلي للتأكد من أن الطلب صادر من نسخة التطبيق المهيأة للتكامل.
 * الصيغة: timestamp.signature، والتوقيع على الحمولة القانونية + UID.
 * لا يُعامل هذا التوقيع كإثبات دفع خارجي؛ المبيعات تبقى مستحقة للتسوية.
 */
export function canonicalReceiptPayload(input, timestamp) {
  return `${timestamp}.${canonicalSalePayload(input)}`;
}

export function createInternalReceipt({ payload, timestamp, secret }) {
  return `${timestamp}.${createHmac('sha256', secret)
    .update(canonicalReceiptPayload(payload, timestamp))
    .digest('hex')}`;
}

export function verifyInternalReceipt({ token, payload, secret, now = Date.now(), maxSkewMs = HMAC_MAX_SKEW_MS }) {
  if (!token || !secret) return { ok: false, error: 'hmac_invalid' };
  const separator = token.indexOf('.');
  if (separator <= 0) return { ok: false, error: 'hmac_invalid' };
  const timestamp = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > maxSkewMs || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, error: 'hmac_expired_or_malformed' };
  }
  const expected = createHmac('sha256', secret)
    .update(canonicalReceiptPayload(payload, timestamp))
    .digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, error: 'hmac_invalid' };
  }
  return { ok: true, timestamp };
}

/**
 * Tries the current network key first and the previous key only while the
 * server-defined rotation grace window still includes it. Returning the key
 * version lets the sale record document which key proved the upload.
 */
export function verifyReceiptWithCandidates({ token, payload, candidates, now = Date.now() }) {
  let lastError = 'hmac_invalid';
  for (const candidate of candidates || []) {
    const attempt = verifyInternalReceipt({
      token,
      payload,
      secret: candidate.secret,
      now,
    });
    if (attempt.ok) {
      return { ...attempt, secretVersion: candidate.version, usedPrevious: candidate.current === false };
    }
    if (attempt.error !== 'hmac_invalid') lastError = attempt.error;
  }
  return { ok: false, error: lastError };
}

export function validateIngestInput(body) {
  const input = normalizeBody(body);
  if (CLIENT_IDENTITY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    return { ok: false, error: 'client_identity_field_forbidden' };
  }
  if (CLIENT_FINANCIAL_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    return { ok: false, error: 'client_financial_field_forbidden' };
  }
  if (Object.keys(input).some((field) => !CLIENT_ALLOWED_FIELDS.has(field))) {
    return { ok: false, error: 'client_field_forbidden' };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'saleId')
      && Object.prototype.hasOwnProperty.call(input, 'saleUuid')
      && (typeof input.saleId !== 'string'
        || typeof input.saleUuid !== 'string'
        || input.saleId.trim() !== input.saleUuid.trim())) {
    return { ok: false, error: 'sale_id_mismatch' };
  }
  if (input.payloadHash != null && typeof input.payloadHash !== 'string') {
    return { ok: false, error: 'payload_hash_invalid' };
  }
  // يقبل التطبيق `saleUuid` (المعتمد) مع دعم `saleId` القديم.
  const saleUuid = typeof input.saleUuid === 'string' ? input.saleUuid.trim()
    : (typeof input.saleId === 'string' ? input.saleId.trim() : '');
  if (!saleUuid) return { ok: false, error: 'sale_id_required' };
  if (saleUuid.length > MAX_SALE_ID_LENGTH || !SALE_ID_PATTERN.test(saleUuid)) return { ok: false, error: 'sale_id_invalid' };

  // The actual Android payload uses a JSON integer; do not coerce strings or booleans.
  const amountMinor = input.amountMinor;
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor)
      || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'amount_invalid' };
  }
  const currencyCode = typeof input.currencyCode === 'string' ? input.currencyCode.trim().toUpperCase() : '';
  if (currencyCode !== CURRENCY) return { ok: false, error: 'currency_invalid' };
  if (amountMinor % MINOR_UNITS_PER_RIYAL !== 0) {
    return { ok: false, error: 'amount_not_whole_riyal' };
  }
  const amountRiyal = amountMinor / MINOR_UNITS_PER_RIYAL;
  if (!Number.isSafeInteger(amountRiyal) || amountRiyal <= 0 || amountRiyal > MAX_AMOUNT_RIYAL) {
    return { ok: false, error: 'amount_invalid' };
  }


  const createdMs = input.createdMs;
  if (typeof createdMs !== 'number' || !Number.isSafeInteger(createdMs) || createdMs <= 0) {
    return { ok: false, error: 'created_at_invalid' };
  }

  if (input.customerId != null && typeof input.customerId !== 'string') {
    return { ok: false, error: 'customer_id_invalid' };
  }
  if (input.cardId != null && typeof input.cardId !== 'string') {
    return { ok: false, error: 'card_id_invalid' };
  }
  const customerId = typeof input.customerId === 'string' ? input.customerId.slice(0, 128) : '';
  const cardId = typeof input.cardId === 'string' ? input.cardId.slice(0, 128) : '';

  return { ok: true, value: { saleId: saleUuid, saleUuid, amountMinor, amountRiyal, currencyCode, createdMs, customerId, cardId } };
}

/**
 * ACK is successful only when the stored payload hash matches exactly.
 * Reusing a sale ID with different content is a conflict, never a successful sync.
 */
export function ackForExistingSale(existingData, payloadHash) {
  const prev = existingData || {};
  const samePayload = prev.payloadHash === payloadHash;
  return {
    status: samePayload ? 'ALREADY_EXISTS_ACKED' : 'PAYLOAD_CONFLICT',
    saleUuid: prev.saleUuid || prev.saleId || null,
    samePayload,
  };
}

/**
 * Persists a verified sale idempotently.
 * Returns { status: 'created' | 'duplicate' | 'conflict', ... }.
 */
export async function ingestSale({ db, uid, networkId = uid, payload, payloadHash, receipt, commissionRateBps = 500, secretVersion = null, now = Date.now() }) {
  // الشبكات الجديدة تستخدم NET-xxxxx كمفتاح المستند، بينما الحسابات القديمة
  // تستخدم UID مباشرة؛ يمرر المستدعي المعرّف المحسوب من users/{uid}.networkId.
  const networkRef = db.collection('networks').doc(networkId);
  const saleRef = networkRef.collection('sales').doc(payload.saleUuid);
  const registryRef = db.collection('sale_ingest_registry').doc(`${uid}_${payload.saleUuid}`);

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(saleRef);
    if (existing.exists) {
      const prev = existing.data() || {};
      const ack = ackForExistingSale(prev, payloadHash);
      const currentMoneyPolicy = Number(prev.moneyPolicyVersion) === 2
        && prev.amountRiyal !== null && prev.amountRiyal !== undefined
        && Number.isFinite(Number(prev.amountRiyal))
        && prev.commissionRiyal !== null && prev.commissionRiyal !== undefined
        && Number.isFinite(Number(prev.commissionRiyal));
      if (ack.status !== 'ALREADY_EXISTS_ACKED' || !currentMoneyPolicy) {
        const conflictCode = ack.samePayload
          ? 'legacy_sale_schema_requires_reconciliation'
          : 'payload_conflict';
        transaction.set(registryRef, {
          uid,
          saleUuid: payload.saleUuid,
          reason: conflictCode,
          previousHash: prev.payloadHash || null,
          incomingHash: payloadHash,
          samePayload: ack.samePayload,
          recordedAt: FieldValue.serverTimestamp(),
        }, { merge: false });
        return { status: 'conflict', error: conflictCode, saleId: payload.saleUuid, samePayload: ack.samePayload };
      }
      return { ...ack, saleId: payload.saleUuid };
    }

    // Firestore requires every transaction read before the first write.
    const networkSnap = await transaction.get(networkRef);
    // Android sends fixed-point currency minor units; financial ledgers use whole Riyals.
    const amount = payload.amountRiyal;
    const commissionRiyal = commissionFromBps(amount, commissionRateBps);
    const commissionMinor = commissionRiyal * MINOR_UNITS_PER_RIYAL;
    transaction.set(saleRef, {
      saleId: payload.saleUuid, saleUuid: payload.saleUuid,
      customerId: payload.customerId || null, cardId: payload.cardId || null,
      amountMinor: payload.amountMinor, amountRiyal: amount, currencyCode: payload.currencyCode,
      amount, faceValue: amount, face_value: amount,
      netAmount: amount - commissionRiyal, netAmountMinor: payload.amountMinor - commissionMinor,
      commission: commissionRiyal, commissionAmount: commissionRiyal, commissionMinor, commissionRiyal,
      commissionRateBps, status: 'COMPLETED', settlement_status: 'PENDING_SETTLEMENT',
      paidMinor: 0, paidRiyal: 0, verified: true, source: 'admin_api',
      verificationReceipt: receipt, payloadHash, payloadPolicyVersion: 2, moneyPolicyVersion: 2,
      ...(secretVersion ? { networkSecretVersion: secretVersion } : {}),
      createdAt: new Date(payload.createdMs), created_at: new Date(payload.createdMs),
      createdAtMs: payload.createdMs, updatedAtMs: now,
      verifiedAt: FieldValue.serverTimestamp(), ingestedAtMs: now,
      serverReceivedAt: new Date(now).toISOString(), serverReceivedAtMs: now,
      serverReceivedAtTimestamp: FieldValue.serverTimestamp(),
    }, { merge: false });

    const network = networkSnap.exists ? networkSnap.data() : {};
    const totalSalesAmount = (Number(network.totalSalesAmount) || 0) + amount;
    const totalCommissionDue = (Number(network.totalCommissionDue) || 0) + commissionRiyal;
    const totalPaidAmount = Number(network.totalPaidAmount) || 0;
    transaction.set(networkRef, {
      totalSalesAmount, totalCommissionDue, totalPaidAmount,
      outstandingBalance: Math.max(0, totalCommissionDue - totalPaidAmount),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    }, { merge: true });

    return {
      status: 'created', saleId: payload.saleUuid, saleUuid: payload.saleUuid,
      payloadHash, amountMinor: payload.amountMinor, amountRiyal: amount,
      commissionMinor, commissionRiyal, commissionRateBps,
    };
  });
}

async function resolveClientUid(req, dependencies = {}) {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return { ok: false, status: 401, error: 'missing_token' };

  const getAuthFn = dependencies.getAuth || getAuth;
  let uid;
  try {
    uid = (await getAuthFn().verifyIdToken(idToken)).uid;
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  // Ingest is for client accounts only: an Admins/{uid} document is rejected.
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const adminCheck = dependencies.isAdminUid || isAdminUid;
  try {
    if (await adminCheck(uid, getFirestoreFn)) return { ok: false, status: 403, error: 'not_client_account' };
  } catch (error) {
    console.error('sales/ingest: admin lookup failed', { code: error?.code, message: error?.message });
    if (error?.code === 8 || error?.code === 'RESOURCE_EXHAUSTED') {
      return { ok: false, status: 503, error: 'firestore_quota_exceeded' };
    }
    return { ok: false, status: 500, error: 'admin_check_failed' };
  }
  return { ok: true, uid };
}

/**
 * Checks if a sale is permitted based on user access status and subscription expiry.
 * In accordance with OWNER_ACCESS_COMMISSION_POLICY_AR:
 * - If subscription is expired, commercial activity is locked for NEW sales.
 * - However, pending older sales created before expiration (from offline outbox) ARE allowed.
 */
export function isSaleAllowedForAccount(user, saleCreatedMs, now = Date.now()) {
  if (!user || typeof user !== 'object') {
    return { ok: false, status: 404, error: 'account_not_found' };
  }

  const accessStatus = typeof user.accessStatus === 'string'
    ? user.accessStatus.trim().toUpperCase()
    : '';

  // 1. Manually suspended account
  if (accessStatus === 'SUSPENDED_GRACE'
      || accessStatus === 'SUSPENDED_MANUAL'
      || accessStatus === 'SUSPENDED'
      || user.blocked === true
      || (user.is_active === false && accessStatus !== 'TRIAL' && accessStatus !== 'LOCKED_EXPIRED')) {
    return { ok: false, status: 403, error: 'account_suspended' };
  }

  // 2. Subscription Expiry
  const endMs = expiryMillis(user.subscriptionEndsAt ?? user.subscription_end_date);
  const isExpired = shouldLockExpiredAccount(user, now) || accessStatus === 'LOCKED_EXPIRED';

  if (isExpired && endMs > 0 && typeof saleCreatedMs === 'number' && saleCreatedMs > endMs) {
    return {
      ok: false,
      status: 403,
      error: 'subscription_expired_new_sales_locked',
      subscriptionEndsAtMs: endMs,
      saleCreatedMs,
    };
  }

  return { ok: true };
}

/**
 * تشخيص فقط: يسجّل سبب رفض البيع وشكل الحقول دون تغيير السلوك أو الرد.
 * لا يُسجَّل السرّ ولا التوقيع ولا التوكن؛ المعرّفات تُقصّ.
 */
function describeField(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `string(${value.length}):${value.slice(0, 60)}`;
  if (typeof value === 'number') return `number:${value}`;
  return typeof value;
}

function logIngestRejection(uid, error, body) {
  try {
    const input = normalizeBody(body);
    const fields = {};
    for (const key of Object.keys(input).slice(0, 20)) {
      fields[key.slice(0, 40)] = describeField(input[key]);
    }
    console.warn('sales/ingest: rejected', JSON.stringify({ uid, error, fields }));
  } catch {
    // التشخيص لا يجوز أن يغيّر مسار الطلب.
  }
}

export default async function handler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const caller = await resolveClientUid(req, dependencies);
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });
  const uid = caller.uid;

  const parsed = validateIngestInput(req.body);
  if (!parsed.ok) {
    logIngestRejection(uid, parsed.error, req.body);
    return res.status(400).json({ success: false, error: parsed.error });
  }

  const payload = { ...parsed.value, uid };
  const payloadHash = computePayloadHash(payload);

  const claimedHash = normalizeBody(req.body).payloadHash;
  if (typeof claimedHash === 'string' && claimedHash.trim() && claimedHash.trim() !== payloadHash) {
    logIngestRejection(uid, 'payload_hash_mismatch', req.body);
    return res.status(400).json({ success: false, error: 'payload_hash_mismatch', expected: payloadHash });
  }

  const receipt = String(req.headers['x-verification-receipt'] || '').trim();
  const db = (dependencies.getFirestore || getFirestore)();
  const serverNow = dependencies.now ?? Date.now();
  if (payload.createdMs > serverNow + SALE_CREATED_MAX_FUTURE_MS) {
    logIngestRejection(uid, 'created_at_in_future', req.body);
    return res.status(400).json({
      success: false,
      error: 'created_at_in_future',
      serverTime: new Date(serverNow).toISOString(),
    });
  }
  let userSnapshot;
  let secretCandidates;
  let networkId;
  try {
    userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists) return res.status(404).json({ success: false, error: 'account_not_found' });
        const user = userSnapshot.data() || {};
    const accessCheck = isSaleAllowedForAccount(user, payload.createdMs, serverNow);
    if (!accessCheck.ok) {
      return res.status(accessCheck.status).json({
        success: false,
        error: accessCheck.error,
        ...(accessCheck.subscriptionEndsAtMs ? { subscriptionEndsAtMs: accessCheck.subscriptionEndsAtMs, saleCreatedMs: accessCheck.saleCreatedMs } : {}),
      });
    }
    networkId = typeof user.networkId === 'string' && user.networkId.trim() ? user.networkId.trim()
      : typeof user.network_id === 'string' && user.network_id.trim() ? user.network_id.trim()
        : uid;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(networkId)) {
      return res.status(409).json({ success: false, error: 'network_mapping_invalid' });
    }
    const networkSnapshot = await db.collection('networks').doc(networkId).get();
    if (!networkSnapshot.exists) return res.status(409).json({ success: false, error: 'network_not_provisioned' });
    const network = networkSnapshot.data() || {};
    if ((network.owner_uid && network.owner_uid !== uid) || (!network.owner_uid && networkId !== uid)) {
      return res.status(403).json({ success: false, error: 'network_owner_mismatch' });
    }
    secretCandidates = networkSecretCandidates(network, { now: serverNow });
    if (secretCandidates.length === 0) {
      return res.status(409).json({ success: false, error: 'network_secret_not_provisioned' });
    }
  } catch (error) {
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'hmac_not_configured' });
    }
    if (error?.message === 'network_secret_decryption_failed' || error?.message === 'network_secret_envelope_invalid') {
      console.error('sales/ingest: network key unavailable', { uid });
      return res.status(503).json({ success: false, error: 'network_secret_unavailable' });
    }
    console.error('sales/ingest: network key lookup failed', {
      uid,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({ success: false, error: 'network_secret_lookup_failed' });
  }
  // Accept the current key first; a previous key is only tried during the
  // server-defined rotation grace window.
  const receiptCheck = verifyReceiptWithCandidates({
    token: receipt,
    payload,
    candidates: secretCandidates,
    now: serverNow,
  });
  if (!receiptCheck.ok) {
    return res.status(401).json({
      success: false,
      error: receiptCheck.error,
      serverTime: new Date(serverNow).toISOString(),
    });
  }
  const matchedSecretVersion = receiptCheck.secretVersion ?? null;

  let commissionRateBps = 500;
  try {
    const rawRate = Number(userSnapshot.data()?.commission_rate);
    if (Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100) commissionRateBps = Math.round(rawRate * 100);
  } catch (error) {
    console.error('sales/ingest: commission lookup failed', error);
    return res.status(500).json({ success: false, error: 'commission_lookup_failed' });
  }

  try {
    const result = await ingestSale({ db, uid, networkId, payload, payloadHash, receipt, commissionRateBps, secretVersion: matchedSecretVersion, now: serverNow });
    if (result.status === 'created') {
      return res.status(201).json({ success: true, ...result, status: 'CREATED', policyVersion: 2 });
    }
    if (result.status === 'conflict') {
      return res.status(409).json({ success: false, ...result, error: result.error });
    }
    return res.status(200).json({ success: true, ...result, status: 'ALREADY_EXISTS_ACKED', ack: true, policyVersion: 2 });
  } catch (error) {
    console.error('sales/ingest failed', { uid, code: error?.code, message: error?.message });
    return res.status(500).json({ success: false, error: 'ingest_failed' });
  }
}
