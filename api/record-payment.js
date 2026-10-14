// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/record-payment — تسجيل دفعة/تسوية آمنة (idempotent)
// ------------------------------------------------------------
// المسار الخادمي الوحيد المسموح لكتابة `networks/{uid}/payments`,
// لأن قواعد Firestore تمنع الكتابة من العميل (DEPLOY GATE).
//
// المدير الموثّق فقط. يشتق معرّف الدفعة من idempotencyKey كي لا تُنشأ
// دفعة مكرّرة عند إعادة المحاولة أو ضعف الشبكة:
//   - أول مرة: تُنشأ الدفعة وتُعاد { ack:false }.
//   - نفس المفتاح بنفس المحتوى: تُعاد الدفعة السابقة { ack:true }.
//   - نفس المفتاح بمحتوى مختلف: تُرفض كتعارض (409) بلا كتابة صامتة.
//
// يتطلب FIREBASE_SERVICE_ACCOUNT.
// ============================================================

import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from './_lib/firebaseAdmin.js';
import { parseNetworkId } from './_lib/networkId.js';
import { settleNetworkPayment } from './_lib/networkLedger.js';

const MAX_AMOUNT = 1_000_000_000_000;
const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

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

export function validatePaymentInput(body) {
  const input = normalizeBody(body);
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return { ok: false, error: 'uid_invalid' };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, error: 'amount_invalid' };

  const month = typeof input.month === 'string' ? input.month.trim() : '';
  if (!MONTH_PATTERN.test(month)) return { ok: false, error: 'month_invalid' };

  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(idempotencyKey)) {
    return { ok: false, error: 'idempotency_key_invalid' };
  }

  const note = typeof input.note === 'string' ? input.note.slice(0, 200) : '';
  return { ok: true, value: { uid, amount, month, idempotencyKey, note } };
}

/** Stable ID derived from the key, so retries land on the same document. */
export function paymentDocId(uid, idempotencyKey) {
  return createHash('sha256').update(`${uid}:${idempotencyKey}`).digest('hex').slice(0, 40);
}

export async function recordPayment({ db, callerUid, value, now = Date.now() }) {
  // الرصيد التراكمي يعيش على مستند الشبكة (NET-xxxxx إن وُجد، وإلا uid القديم).
  const userSnap = await db.collection('users').doc(value.uid).get();
  const networkId = parseNetworkId(userSnap.data()?.networkId) ? userSnap.data().networkId : value.uid;

  const networkRef = db.collection('networks').doc(networkId);
  const paymentRef = networkRef.collection('payments').doc(paymentDocId(value.uid, value.idempotencyKey));
  const salesQuery = networkRef.collection('sales').orderBy('createdAt', 'asc').limit(400);
  const fingerprint = createHash('sha256').update(JSON.stringify({ amount: value.amount, month: value.month })).digest('hex');

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(paymentRef);
    if (existing.exists) {
      const prev = existing.data() || {};
      if (prev.fingerprint === fingerprint) return { status: 'duplicate', paymentId: paymentRef.id, outstandingBalance: prev.outstandingBalance ?? null };
      return { status: 'conflict', paymentId: paymentRef.id };
    }

    // توحيد الدفعة في الرصيد التراكمي وتسوية المبيعات المعلقة (FIFO).
    const ledger = await settleNetworkPayment(transaction, {
      networkRef,
      salesQuery,
      amountMinor: value.amount,
      settlementId: paymentRef.id,
    });

    transaction.set(paymentRef, {
      amount: value.amount,
      month: value.month,
      networkId,
      timestamp: now,
      source: 'admin_api',
      recordedBy: callerUid,
      idempotencyKey: value.idempotencyKey,
      fingerprint,
      note: value.note || null,
      allocatedMinor: ledger.allocatedMinor,
      unallocatedMinor: ledger.unallocatedMinor,
      outstandingBalance: ledger.outstandingBalance,
      settledSales: ledger.settledSales,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: false });

    return { status: 'created', paymentId: paymentRef.id, outstandingBalance: ledger.outstandingBalance, settledSales: ledger.settledSales };
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

  const parsed = validatePaymentInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  try {
    const result = await recordPayment({ db: getFirestore(), callerUid: caller.callerUid, value: parsed.value });
    if (result.status === 'conflict') {
      return res.status(409).json({ success: false, error: 'payment_conflict', paymentId: result.paymentId });
    }
    return res.status(200).json({
      success: true,
      ack: result.status === 'duplicate',
      paymentId: result.paymentId,
      outstandingBalance: result.outstandingBalance ?? null,
      settledSales: result.settledSales ?? 0,
    });
  } catch (error) {
    console.error('record-payment failed', error);
    return res.status(500).json({ success: false, error: 'record_failed' });
  }
}
