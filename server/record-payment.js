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
import { monthlySalesQuery, settleNetworkPayment } from './_lib/networkLedger.js';

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
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, error: 'amount_invalid' };

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
  const networkRefs = networkId === value.uid
    ? [networkRef]
    : [networkRef, db.collection('networks').doc(value.uid)];
  const paymentId = paymentDocId(value.uid, value.idempotencyKey);
  const paymentRefs = networkRefs.map((ref) => ref.collection('payments').doc(paymentId));
  const salesQueries = networkRefs.map((ref) => monthlySalesQuery(ref, value.month, 400));
  const fingerprint = createHash('sha256').update(JSON.stringify({ amount: value.amount, month: value.month })).digest('hex');

  return db.runTransaction(async (transaction) => {
    const existingSnaps = await Promise.all(paymentRefs.map((ref) => transaction.get(ref)));
    const existing = existingSnaps.find((snapshot) => snapshot.exists);
    if (existing) {
      const prev = existing.data() || {};
      if (existingSnaps.some((snapshot) => snapshot.exists && snapshot.data()?.fingerprint !== fingerprint)) {
        return { status: 'conflict', paymentId };
      }
      if (prev.fingerprint !== fingerprint) return { status: 'conflict', paymentId };
      // Repair a missing mirror on retry without applying the sale allocation twice.
      existingSnaps.forEach((snapshot, index) => {
        if (!snapshot.exists) transaction.set(paymentRefs[index], {
          ...prev,
          networkId: networkRefs[index].id,
          canonicalNetworkId: networkId,
        }, { merge: false });
      });
      return { status: 'duplicate', paymentId, outstandingBalance: prev.outstandingBalance ?? null };
    }

    // تُخصَّص الدفعة لمبيعات الشهر المحدد فقط، من الأقدم إلى الأحدث داخل الشهر.
    const ledger = await settleNetworkPayment(transaction, {
      networkRef,
      networkRefs,
      salesQueries,
      amountMinor: value.amount,
      settlementId: paymentId,
      month: value.month,
      now,
    });
    if (ledger.status === 'month_balance_exceeded') {
      return {
        status: ledger.status,
        paymentId,
        month: value.month,
        monthlyOutstanding: ledger.monthlyOutstanding,
        requestedAmount: ledger.requestedAmount,
      };
    }

    paymentRefs.forEach((paymentRef, index) => transaction.set(paymentRef, {
      amount: value.amount,
      month: value.month,
      networkId: networkRefs[index].id,
      canonicalNetworkId: networkId,
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
      createdAtMs: now,
      updatedAtMs: now,
    }, { merge: false }));

    return { status: 'created', paymentId, outstandingBalance: ledger.outstandingBalance, settledSales: ledger.settledSales };
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
    if (result.status === 'month_balance_exceeded') {
      return res.status(409).json({
        success: false,
        error: 'month_balance_exceeded',
        month: result.month,
        monthlyOutstanding: result.monthlyOutstanding,
        requestedAmount: result.requestedAmount,
      });
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
