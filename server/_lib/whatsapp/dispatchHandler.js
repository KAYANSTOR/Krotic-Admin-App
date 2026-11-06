/**
 * Delivery dispatch — service secret or Vercel CRON_SECRET Bearer.
 * 1) Drain Firestore queue jobs whose runAfterMs elapsed (deadline checks).
 * 2) On SMS fallback: sms_pending + enqueue whatsapp_sms_device_tasks (no sms_sent).
 * 3) Settle terminal device task outcomes → completeSmsFallbackFromDevice.
 * 4) Recovery scan for lost jobs.
 * Exact 10s latency is NOT claimed without an external wake-up.
 */
import { timingSafeEqual } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { getDispatchServiceSecret } from './secrets.js';
import {
  DELIVERY_OPS_COLLECTION,
  tryStartSmsFallback,
} from './deliveryOperations.js';
import { isWhatsappDeadlineExpired } from './deliveryState.js';
import { isWhatsappCardDeliveryEnabled } from './entitlementsGate.js';
import { claimNextJob, completeJob, failJob } from './deliveryQueue.js';
import { enqueueSmsDeviceTask } from './smsDeviceTaskContract.js';
import { settleTerminalSmsDeviceTasks } from './smsDeviceCompletion.js';

function getHeader(req, name) {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function safeEqualString(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function isAuthorizedDispatch(req, dispatchSecret) {
  const provided = getHeader(req, 'x-dispatch-service-secret') || getHeader(req, 'x-whatsapp-dispatch-secret');
  if (dispatchSecret && safeEqualString(provided, dispatchSecret)) return true;

  const authHeader = String(getHeader(req, 'authorization') || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearer && safeEqualString(bearer, cronSecret)) return true;

  return false;
}

async function enqueueSmsTaskFromOp(db, opId, data, now) {
  if (!data?.ownerUid || !data?.networkId) {
    return { ok: false, error: 'missing_owner_or_network' };
  }
  if (typeof data.toLocalPhone !== 'string' || typeof data.messageBody !== 'string') {
    return { ok: false, error: 'missing_sms_payload' };
  }
  return enqueueSmsDeviceTask(db, {
    deliveryOperationId: opId,
    networkId: data.networkId,
    ownerUid: data.ownerUid,
    toLocalPhone: data.toLocalPhone,
    body: data.messageBody,
    now,
  });
}

async function processDeadlineJob(db, job, now) {
  const opId = job.deliveryOperationId || job.jobId;
  if (!opId) return { smsStarted: false, taskEnqueued: false, reason: 'missing_op' };

  const snap = await db.collection(DELIVERY_OPS_COLLECTION).doc(opId).get();
  if (!snap.exists) return { smsStarted: false, taskEnqueued: false, reason: 'op_missing' };
  const data = snap.data() || {};

  if (data.ownerUid) {
    const userSnap = await db.collection('users').doc(data.ownerUid).get();
    const features = userSnap.exists ? (userSnap.data() || {}).account_features : null;
    if (!isWhatsappCardDeliveryEnabled(features)) {
      return { smsStarted: false, taskEnqueued: false, reason: 'entitlement_closed' };
    }
  }

  if (data.smsFallbackSentAtMs != null) {
    return { smsStarted: false, taskEnqueued: false, reason: 'sms_already_sent' };
  }

  if (data.status === 'delivered' || data.status === 'read' || data.status === 'delivered_late_after_sms') {
    return { smsStarted: false, taskEnqueued: false, reason: 'already_delivered' };
  }

  if (
    (data.status === 'sent' || data.status === 'sms_pending')
    && isWhatsappDeadlineExpired(data.whatsappDeadlineAtMs, now)
  ) {
    const result = await tryStartSmsFallback(db, opId, now);
    if (!result.ok) {
      return { smsStarted: false, taskEnqueued: false, reason: result.error };
    }
    const after = result.data || data;
    const enq = await enqueueSmsTaskFromOp(db, opId, after, now);
    return {
      smsStarted: true,
      taskEnqueued: Boolean(enq.ok),
      reason: enq.ok ? (enq.duplicate ? 'sms_pending_task_exists' : 'sms_pending_task_created') : (enq.error || 'task_enqueue_failed'),
    };
  }

  return { smsStarted: false, taskEnqueued: false, reason: 'not_due_or_wrong_status', status: data.status };
}

export default async function whatsappDispatchHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader?.('Allow', 'POST, GET');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) {
    return res.status(503).json({ success: false, error: configured?.error || 'server_not_configured' });
  }

  const secretResult = await (dependencies.getDispatchServiceSecret || getDispatchServiceSecret)();
  if (!secretResult.ok && !process.env.CRON_SECRET) {
    return res.status(503).json({ success: false, error: secretResult.error || 'dispatch_secret_not_configured' });
  }

  if (!isAuthorizedDispatch(req, secretResult.ok ? secretResult.value : null)) {
    return res.status(403).json({ success: false, error: 'dispatch_forbidden' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.saleUuid || body.pin || body.cardNumber || body.cardPayload) {
    return res.status(400).json({ success: false, error: 'client_payload_forbidden' });
  }

  const db = dependencies.db || (dependencies.getFirestore || getFirestore)();
  const now = dependencies.now ?? Date.now();
  const limit = Math.min(Number(body.limit) || 20, 50);
  const workerId = `dispatch-${now}`;

  let queueProcessed = 0;
  let smsStarted = 0;
  let tasksEnqueued = 0;
  let skipped = 0;

  for (let i = 0; i < limit; i += 1) {
    const claim = await claimNextJob(db, { workerId, now, lockMs: 30_000 });
    if (!claim.ok || !claim.jobId) break;
    queueProcessed += 1;
    try {
      const outcome = await processDeadlineJob(db, claim.data, now);
      if (outcome.smsStarted) smsStarted += 1;
      else skipped += 1;
      if (outcome.taskEnqueued) tasksEnqueued += 1;
      await completeJob(db, claim.jobId, { now, result: outcome });
    } catch (error) {
      await failJob(db, claim.jobId, {
        now,
        error: error?.message || 'process_failed',
        requeue: true,
        runAfterMs: now + 60_000,
      });
      skipped += 1;
    }
  }

  const candidates = [];
  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith(`${DELIVERY_OPS_COLLECTION}/`) && data) {
        candidates.push({ id: path.slice(DELIVERY_OPS_COLLECTION.length + 1), data });
      }
    }
  }

  let recoveryProcessed = 0;
  for (const item of candidates.slice(0, limit)) {
    const { id, data } = item;
    recoveryProcessed += 1;

    if (data.ownerUid) {
      const userSnap = await db.collection('users').doc(data.ownerUid).get();
      const features = userSnap.exists ? (userSnap.data() || {}).account_features : null;
      if (!isWhatsappCardDeliveryEnabled(features)) {
        skipped += 1;
        continue;
      }
    }

    if (
      data.status === 'sent'
      && isWhatsappDeadlineExpired(data.whatsappDeadlineAtMs, now)
      && data.smsFallbackSentAtMs == null
    ) {
      const result = await tryStartSmsFallback(db, id, now);
      if (result.ok) {
        smsStarted += 1;
        const enq = await enqueueSmsTaskFromOp(db, id, result.data || data, now);
        if (enq.ok) tasksEnqueued += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    skipped += 1;
  }

  const settle = await (dependencies.settleTerminalSmsDeviceTasks || settleTerminalSmsDeviceTasks)(db, {
    now,
    limit,
  });

  return res.status(200).json({
    success: true,
    queueProcessed,
    recoveryProcessed,
    smsStarted,
    tasksEnqueued,
    deviceSettled: settle.settled || 0,
    skipped,
    note: 'Queue + SMS task enqueue + device settle; exact 10s wake-up not claimed without external scheduler',
  });
}
