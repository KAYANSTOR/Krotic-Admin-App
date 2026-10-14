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
import { ensureFirebaseAdmin } from '../_lib/firebaseAdmin.js';
import { CURRENCY, commissionFromBps } from '../_lib/money.js';
import { decryptNetworkSecret } from '../_lib/networkSecret.js';

const MAX_SALE_ID_LENGTH = 128;
const MAX_AMOUNT_MINOR = 1_000_000_000_000;
const SALE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HMAC_MAX_SKEW_MS = 5 * 60 * 1000;

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

export function validateIngestInput(body) {
  const input = normalizeBody(body);
  // يقبل التطبيق `saleUuid` (المعتمد) مع دعم `saleId` القديم.
  const saleUuid = typeof input.saleUuid === 'string' ? input.saleUuid.trim()
    : (typeof input.saleId === 'string' ? input.saleId.trim() : '');
  if (!saleUuid) return { ok: false, error: 'sale_id_required' };
  if (saleUuid.length > MAX_SALE_ID_LENGTH || !SALE_ID_PATTERN.test(saleUuid)) return { ok: false, error: 'sale_id_invalid' };

  const amountMinor = Number(input.amountMinor);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'amount_invalid' };
  }
  const currencyCode = typeof input.currencyCode === 'string' ? input.currencyCode.trim().toUpperCase() : '';
  if (currencyCode !== CURRENCY) return { ok: false, error: 'currency_invalid' };

  const createdMs = Number(input.createdMs);
  if (!Number.isFinite(createdMs) || createdMs <= 0) return { ok: false, error: 'created_at_invalid' };

  const customerId = typeof input.customerId === 'string' ? input.customerId.slice(0, 128) : '';
  const cardId = typeof input.cardId === 'string' ? input.cardId.slice(0, 128) : '';

  return { ok: true, value: { saleId: saleUuid, saleUuid, amountMinor, currencyCode, createdMs, customerId, cardId } };
}

/**
 * استجابة ACK موحّدة لسجل موجود مسبقاً: لا نُرجع خطأ تعارض حتى لا يفشل
 * التطبيق محلياً في تسجيل الـ ACK بعد انقطاع الاتصال وإعادة المحاولة.
 * نُرجع دائماً نجاحاً، ونُميّز فقط إن كان المحتوى مطابقاً أم مختلفاً (للتدقيق).
 */
export function ackForExistingSale(existingData, payloadHash) {
  const prev = existingData || {};
  return {
    status: 'ALREADY_EXISTS_ACKED',
    saleUuid: prev.saleUuid || prev.saleId || null,
    samePayload: prev.payloadHash === payloadHash,
  };
}

/**
 * Persists a verified sale idempotently.
 * Returns { status: 'created' | 'duplicate' | 'conflict', ... }.
 */
export async function ingestSale({ db, uid, payload, payloadHash, receipt, commissionRateBps = 500, now = Date.now() }) {
  const saleRef = db.collection('networks').doc(uid).collection('sales').doc(payload.saleUuid);
  const registryRef = db.collection('sale_ingest_registry').doc(`${uid}_${payload.saleUuid}`);
  const networkRef = db.collection('networks').doc(uid);

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(saleRef);
    if (existing.exists) {
      const prev = existing.data() || {};
      // محتوى مختلف لنفس المعرّف: يُسجَّل للتدقيق لكن لا نُفشل التطبيق (ACK ناجح).
      if (prev.payloadHash !== payloadHash) {
        transaction.set(registryRef, {
          uid,
          saleUuid: payload.saleUuid,
          reason: 'payload_hash_conflict_acked',
          previousHash: prev.payloadHash || null,
          incomingHash: payloadHash,
          recordedAt: FieldValue.serverTimestamp(),
        }, { merge: false });
      }
      return { ...ackForExistingSale(prev, payloadHash), saleId: payload.saleUuid };
    }

    // الريال اليمني صحيح بالكامل: لا كسور. العمولة لقطة ثابتة وقت البيع
    // (commission_rate_snapshot) تُقرَّب لأقرب ريال، وتُعلَّم غير مسوّاة.
    const amount = payload.amountMinor;
    const commissionMinor = commissionFromBps(payload.amountMinor, commissionRateBps);
    transaction.set(saleRef, {
      saleId: payload.saleUuid,
      saleUuid: payload.saleUuid,
      customerId: payload.customerId || null,
      cardId: payload.cardId || null,
      amountMinor: payload.amountMinor,
      currencyCode: payload.currencyCode,
      amount,
      faceValue: amount,
      face_value: amount,
      netAmount: amount,
      commission: commissionMinor,
      commissionAmount: commissionMinor,
      commissionMinor,
      commissionRateBps,
      status: 'COMPLETED',
      settlement_status: 'PENDING_SETTLEMENT',
      paidMinor: 0,
      verified: true,
      source: 'admin_api',
      verificationReceipt: receipt,
      payloadHash,
      payloadPolicyVersion: 1,
      createdAt: new Date(payload.createdMs),
      created_at: new Date(payload.createdMs),
      verifiedAt: FieldValue.serverTimestamp(),
      ingestedAtMs: now,
    }, { merge: false });

    // تحديث الرصيد التراكمي للشبكة (المرجع الوحيد لتطبيق الهاتف واللوحة).
    const networkSnap = await transaction.get(networkRef);
    const network = networkSnap.exists ? networkSnap.data() : {};
    const totalSalesAmount = (Number(network.totalSalesAmount) || 0) + amount;
    const totalCommissionDue = (Number(network.totalCommissionDue) || 0) + commissionMinor;
    const totalPaidAmount = Number(network.totalPaidAmount) || 0;
    transaction.set(networkRef, {
      totalSalesAmount,
      totalCommissionDue,
      totalPaidAmount,
      outstandingBalance: Math.max(0, totalCommissionDue - totalPaidAmount),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { status: 'created', saleId: payload.saleUuid, saleUuid: payload.saleUuid, payloadHash, commissionMinor, commissionRateBps };
  });
}

async function resolveClientUid(req) {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return { ok: false, status: 401, error: 'missing_token' };

  let uid;
  try {
    uid = (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }

  // Ingest is for client accounts only: an Admins/{uid} document is rejected.
  try {
    const adminSnap = await getFirestore().collection('Admins').doc(uid).get();
    if (adminSnap.exists) return { ok: false, status: 403, error: 'not_client_account' };
  } catch (error) {
    console.error('sales/ingest: admin lookup failed', error);
    return { ok: false, status: 500, error: 'admin_check_failed' };
  }
  return { ok: true, uid };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const caller = await resolveClientUid(req);
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });
  const uid = caller.uid;

  const parsed = validateIngestInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  const payload = { ...parsed.value, uid };
  const payloadHash = computePayloadHash(payload);

  const claimedHash = normalizeBody(req.body).payloadHash;
  if (typeof claimedHash === 'string' && claimedHash.trim() && claimedHash.trim() !== payloadHash) {
    return res.status(400).json({ success: false, error: 'payload_hash_mismatch', expected: payloadHash });
  }

  const receipt = String(req.headers['x-verification-receipt'] || '').trim();
  const db = getFirestore();
  let userSnapshot;
  let networkSecret;
  try {
    userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists) return res.status(404).json({ success: false, error: 'account_not_found' });
    const user = userSnapshot.data() || {};
    const networkId = typeof user.networkId === 'string' && user.networkId.trim() ? user.networkId.trim() : uid;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(networkId)) {
      return res.status(409).json({ success: false, error: 'network_mapping_invalid' });
    }
    const networkSnapshot = await db.collection('networks').doc(networkId).get();
    if (!networkSnapshot.exists) return res.status(409).json({ success: false, error: 'network_not_provisioned' });
    const network = networkSnapshot.data() || {};
    if ((network.owner_uid && network.owner_uid !== uid) || (!network.owner_uid && networkId !== uid)) {
      return res.status(403).json({ success: false, error: 'network_owner_mismatch' });
    }
    if (!network.networkSecretEncrypted) {
      return res.status(409).json({ success: false, error: 'network_secret_not_provisioned' });
    }
    networkSecret = decryptNetworkSecret(network.networkSecretEncrypted);
  } catch (error) {
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'hmac_not_configured' });
    }
    if (error?.message === 'network_secret_decryption_failed' || error?.message === 'network_secret_envelope_invalid') {
      console.error('sales/ingest: network key unavailable', { uid });
      return res.status(503).json({ success: false, error: 'network_secret_unavailable' });
    }
    console.error('sales/ingest: network key lookup failed', { uid, error });
    return res.status(500).json({ success: false, error: 'network_secret_lookup_failed' });
  }
  const receiptCheck = verifyInternalReceipt({ token: receipt, payload, secret: networkSecret });
  if (!receiptCheck.ok) return res.status(401).json({ success: false, error: receiptCheck.error });

  let commissionRateBps = 500;
  try {
    const rawRate = Number(userSnapshot.data()?.commission_rate);
    if (Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100) commissionRateBps = Math.round(rawRate * 100);
  } catch (error) {
    console.error('sales/ingest: commission lookup failed', error);
    return res.status(500).json({ success: false, error: 'commission_lookup_failed' });
  }

  try {
    const result = await ingestSale({ db, uid, payload, payloadHash, receipt, commissionRateBps });
    if (result.status === 'created') {
      return res.status(201).json({ success: true, status: 'CREATED', policyVersion: 1, ...result });
    }
    // السجل موجود مسبقاً: نجاح دائماً (ACK) بلا خطأ تعارض، حتى لا يفشل التطبيق محلياً.
    return res.status(200).json({ success: true, status: 'ALREADY_EXISTS_ACKED', ack: true, policyVersion: 1, ...result });
  } catch (error) {
    console.error('sales/ingest failed', error);
    return res.status(500).json({ success: false, error: 'ingest_failed' });
  }
}
