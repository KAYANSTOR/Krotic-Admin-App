// ============================================================
// Krotak Pro — Vercel Serverless Function (عبر api/router.js)
// POST /api/sales/cancel — إلغاء بيع من جهاز مالك الشبكة (idempotent)
// ------------------------------------------------------------
// العقد: contracts/schemas/sales-cancel-request.schema.json، والقرارات
// O-08 / O-07 (ق11 / ق12 في docs/BASELINE_AR.md).
// التوثيق مطابق لـ sales/ingest (ID token لحساب عميل + HMAC بسر الشبكة)،
// ولا يُشترط اشتراك ساري لأن الإلغاء مزامنة ويخفض العمولة فقط، لكن ملكية
// الشبكة شرط. منطق المعاملة في server/_lib/saleCancellation.js.
// ============================================================

import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../_lib/firebaseAdmin.js';
import { networkSecretCandidates } from '../_lib/networkSecretStore.js';
import {
  networkLookupFailure,
  resolveClientUid,
  resolveOwnedNetwork,
} from '../_lib/clientRequestAuth.js';
import {
  CANCELLED_MAX_FUTURE_MS,
  cancelSale,
  validateCancelInput,
  verifyCancelReceiptWithCandidates,
} from '../_lib/saleCancellation.js';

export {
  cancellationIdFor,
  canonicalCancelPayload,
  createCancelReceipt,
  validateCancelInput,
} from '../_lib/saleCancellation.js';

const LABEL = 'sales/cancel';

export default async function handler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const caller = await resolveClientUid(req, dependencies, { label: LABEL });
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });
  const uid = caller.uid;

  const parsed = validateCancelInput(req.body);
  if (!parsed.ok) {
    console.warn(`${LABEL}: rejected`, JSON.stringify({ uid, error: parsed.error }));
    return res.status(400).json({ success: false, error: parsed.error });
  }
  const payload = { ...parsed.value, uid };

  const serverNow = dependencies.now ?? Date.now();
  if (payload.cancelledMs > serverNow + CANCELLED_MAX_FUTURE_MS) {
    return res.status(400).json({
      success: false,
      error: 'cancelled_at_in_future',
      serverTime: new Date(serverNow).toISOString(),
    });
  }

  const db = (dependencies.getFirestore || getFirestore)();
  let networkId;
  let secretCandidates;
  try {
    const owned = await resolveOwnedNetwork(db, uid);
    if (!owned.ok) return res.status(owned.status).json({ success: false, error: owned.error });
    networkId = owned.networkId;
    secretCandidates = networkSecretCandidates(owned.network, { now: serverNow });
    if (secretCandidates.length === 0) {
      return res.status(409).json({ success: false, error: 'network_secret_not_provisioned' });
    }
  } catch (error) {
    const failure = networkLookupFailure(error, { label: LABEL, uid });
    return res.status(failure.status).json({ success: false, error: failure.error });
  }

  const receipt = String(req.headers['x-verification-receipt'] || '').trim();
  const receiptCheck = verifyCancelReceiptWithCandidates({
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

  try {
    const result = await cancelSale({
      db, uid, networkId, payload, receipt,
      secretVersion: receiptCheck.secretVersion ?? null,
      now: serverNow,
    });
    switch (result.status) {
      case 'not_found':
        return res.status(404).json({ success: false, error: 'sale_not_found', saleUuid: result.saleUuid });
      case 'already_cancelled':
        return res.status(200).json({
          success: true, status: 'ALREADY_CANCELLED_ACKED', ack: true,
          saleUuid: result.saleUuid, cancellationId: result.cancellationId,
        });
      case 'already_settled':
        return res.status(409).json({ success: false, error: 'sale_already_settled', saleUuid: result.saleUuid });
      case 'not_cancellable':
        return res.status(409).json({ success: false, error: 'sale_not_cancellable', saleUuid: result.saleUuid });
      default:
        return res.status(200).json({
          success: true, status: 'CANCELLED', ack: true,
          saleUuid: result.saleUuid, cancellationId: result.cancellationId,
          reversedAmountRiyal: result.reversedAmountRiyal,
          reversedCommissionRiyal: result.reversedCommissionRiyal,
          policyVersion: 2,
        });
    }
  } catch (error) {
    console.error(`${LABEL} failed`, { uid, code: error?.code, message: error?.message });
    return res.status(500).json({ success: false, error: 'cancel_failed' });
  }
}
