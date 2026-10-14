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
//
// ملاحظة أمنية صريحة: الخادم لا يمنح اعتماداً مالياً إلا بعد إثبات عملية
// خارجي. لحين توفيره (قرار المالك)، يُشترط هيدر `x-verification-receipt`
// ليكون السجل `verified: true`؛ بدونه يُرفض الطلب (412).
//
// يتطلب FIREBASE_SERVICE_ACCOUNT. لا يحتاج أي كتابة عميل في Firestore.
// ============================================================

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin } from '../_lib/firebaseAdmin.js';

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
  const saleId = typeof input.saleId === 'string' ? input.saleId.trim() : '';
  if (!saleId) return { ok: false, error: 'sale_id_required' };
  if (saleId.length > MAX_SALE_ID_LENGTH || !SALE_ID_PATTERN.test(saleId)) return { ok: false, error: 'sale_id_invalid' };

  const amountMinor = Number(input.amountMinor);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'amount_invalid' };
  }
  const currencyCode = typeof input.currencyCode === 'string' ? input.currencyCode.trim().toUpperCase() : '';
  if (!currencyCode || currencyCode.length > 8) return { ok: false, error: 'currency_invalid' };

  const createdMs = Number(input.createdMs);
  if (!Number.isFinite(createdMs) || createdMs <= 0) return { ok: false, error: 'created_at_invalid' };

  const customerId = typeof input.customerId === 'string' ? input.customerId.slice(0, 128) : '';
  const cardId = typeof input.cardId === 'string' ? input.cardId.slice(0, 128) : '';

  return { ok: true, value: { saleId, amountMinor, currencyCode, createdMs, customerId, cardId } };
}

/**
 * Persists a verified sale idempotently.
 * Returns { status: 'created' | 'duplicate' | 'conflict', ... }.
 */
export async function ingestSale({ db, uid, payload, payloadHash, receipt, commissionRateBps = 500, now = Date.now() }) {
  const saleRef = db.collection('networks').doc(uid).collection('sales').doc(payload.saleId);
  const registryRef = db.collection('sale_ingest_registry').doc(`${uid}_${payload.saleId}`);

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(saleRef);
    if (existing.exists) {
      const prev = existing.data() || {};
      if (prev.payloadHash === payloadHash) return { status: 'duplicate', saleId: payload.saleId, payloadHash: prev.payloadHash };
      transaction.set(registryRef, {
        uid,
        saleId: payload.saleId,
        reason: 'payload_hash_conflict',
        previousHash: prev.payloadHash || null,
        incomingHash: payloadHash,
        rejectedAt: FieldValue.serverTimestamp(),
      }, { merge: false });
      return { status: 'conflict', saleId: payload.saleId, previousHash: prev.payloadHash || null, incomingHash: payloadHash };
    }

    const amount = payload.amountMinor / 100;
    const commissionMinor = Math.floor((payload.amountMinor * commissionRateBps) / 10000);
    const commissionAmount = commissionMinor / 100;
    transaction.set(saleRef, {
      saleId: payload.saleId,
      customerId: payload.customerId || null,
      cardId: payload.cardId || null,
      amountMinor: payload.amountMinor,
      currencyCode: payload.currencyCode,
      amount,
      faceValue: amount,
      face_value: amount,
      netAmount: amount,
      commission: commissionAmount,
      commissionAmount,
      commissionMinor,
      commissionRateBps,
      status: 'PENDING_SETTLEMENT',
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
    return { status: 'created', saleId: payload.saleId, payloadHash, commissionMinor, commissionRateBps };
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
  const hmacSecret = process.env.KROTAK_HMAC_SECRET || '';
  if (!hmacSecret) return res.status(503).json({ success: false, error: 'hmac_not_configured' });
  const receiptCheck = verifyInternalReceipt({ token: receipt, payload, secret: hmacSecret });
  if (!receiptCheck.ok) return res.status(401).json({ success: false, error: receiptCheck.error });

  let commissionRateBps = 500;
  try {
    const userSnap = await getFirestore().collection('users').doc(uid).get();
    const rawRate = Number(userSnap.data()?.commission_rate);
    if (Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100) commissionRateBps = Math.round(rawRate * 100);
  } catch (error) {
    console.error('sales/ingest: commission lookup failed', error);
    return res.status(500).json({ success: false, error: 'commission_lookup_failed' });
  }

  try {
    const result = await ingestSale({ db: getFirestore(), uid, payload, payloadHash, receipt, commissionRateBps });
    if (result.status === 'conflict') {
      return res.status(409).json({ success: false, error: 'sale_id_conflict', ...result });
    }
    return res.status(200).json({ success: true, policyVersion: 1, ack: result.status === 'duplicate', ...result });
  } catch (error) {
    console.error('sales/ingest failed', error);
    return res.status(500).json({ success: false, error: 'ingest_failed' });
  }
}
