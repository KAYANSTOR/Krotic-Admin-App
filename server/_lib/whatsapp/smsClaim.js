/**
 * SMS fallback once-only claim — identity = deliveryOperationId (= networkId + saleUuid).
 * Reserve BEFORE external send. Crash recovery via smsProviderAcceptedAtMs / smsOutcomeUnknown.
 * See smsProvider.js for idempotency key + reconciliation limits.
 */
import { DELIVERY_OPS_COLLECTION, transitionDeliveryStatus } from './deliveryOperations.js';
import { canStartSmsFallback } from './deliveryState.js';
import {
  executeSmsFallbackPipeline,
  reconcileSmsAfterCrash,
  markSmsOutcomeUnknown,
} from './smsProvider.js';

export const SMS_CLAIM_LOCK_MS = 60_000;

export async function claimSmsFallbackSlot(db, deliveryOperationId, {
  workerId,
  now = Date.now(),
  lockMs = SMS_CLAIM_LOCK_MS,
} = {}) {
  if (!deliveryOperationId) return { ok: false, error: 'delivery_id_required' };
  if (!workerId) return { ok: false, error: 'worker_id_required' };

  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);

  const apply = (current) => {
    if (!current) return { ok: false, error: 'delivery_not_found' };
    if (current.smsFallbackSentAtMs != null) {
      return { ok: true, claimed: false, alreadySent: true, data: current };
    }
    if (current.smsOutcomeUnknown === true) {
      return { ok: true, claimed: false, alreadySent: false, data: current, reason: 'outcome_unknown_no_resend' };
    }
    // Provider already accepted: complete without re-send even if another worker still holds the lock.
    if (current.smsProviderAcceptedAtMs != null && current.smsFallbackSentAtMs == null) {
      return {
        ok: true,
        claimed: true,
        completeOnly: true,
        data: current,
        reason: 'complete_after_crash',
      };
    }
    if (
      current.smsClaimOwner
      && current.smsClaimOwner !== workerId
      && Number(current.smsClaimUntilMs) > now
    ) {
      return { ok: true, claimed: false, alreadySent: false, data: current, reason: 'locked' };
    }
    if (!canStartSmsFallback(current.status) && current.status !== 'sms_pending') {
      return { ok: false, error: 'sms_not_allowed_from_status', status: current.status };
    }
    return {
      ok: true,
      claimed: true,
      completeOnly: false,
      next: {
        ...current,
        status: 'sms_pending',
        smsClaimOwner: workerId,
        smsClaimUntilMs: now + lockMs,
        smsFallbackScheduledAtMs: current.smsFallbackScheduledAtMs ?? now,
        updatedAtMs: now,
      },
    };
  };

  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      const result = apply(current);
      if (!result.ok || !result.claimed || result.alreadySent || result.completeOnly) {
        return result;
      }
      tx.set(ref, result.next, { merge: false });
      return { ok: true, claimed: true, completeOnly: false, data: result.next };
    });
  }

  const snap = await ref.get();
  const result = apply(snap.exists ? snap.data() : null);
  if (!result.ok || !result.claimed || result.alreadySent || result.completeOnly) return result;
  await ref.set(result.next, { merge: false });
  return { ok: true, claimed: true, completeOnly: false, data: result.next };
}

export async function markSmsProviderAccepted(db, deliveryOperationId, now = Date.now()) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const current = snap.data() || {};
  if (current.smsFallbackSentAtMs != null) return { ok: true, data: current };
  const next = {
    ...current,
    smsProviderAcceptedAtMs: now,
    updatedAtMs: now,
  };
  await ref.set(next, { merge: false });
  return { ok: true, data: next };
}

export async function completeSmsFallback(db, deliveryOperationId, now = Date.now()) {
  return transitionDeliveryStatus(db, deliveryOperationId, 'sms_sent', {}, now);
}

export async function tryStartSmsFallbackOnce(db, deliveryOperationId, {
  workerId = `sms-${Date.now()}`,
  now = Date.now(),
  simulateAccept = true,
  throwAfter = null,
  sendSms = null,
} = {}) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (snap.exists) {
    const plan = reconcileSmsAfterCrash(snap.data());
    if (plan.action === 'manual_review') {
      await markSmsOutcomeUnknown(db, deliveryOperationId, now, plan.reason);
      return { ok: false, error: 'sms_outcome_unknown', reason: plan.reason };
    }
    if (plan.action === 'noop') return { ok: false, error: 'sms_already_sent' };
  }

  try {
    return await executeSmsFallbackPipeline(db, deliveryOperationId, {
      workerId,
      now,
      claimSmsFallbackSlot,
      markSmsProviderAccepted,
      completeSmsFallback,
      throwAfter,
      providerDeps: {
        simulateAccept,
        sendSms,
      },
    });
  } catch (error) {
    if (error?.phase === 'request_started') {
      await markSmsOutcomeUnknown(db, deliveryOperationId, now, 'crash_after_request_started');
    }
    throw error;
  }
}

export { reconcileSmsAfterCrash, markSmsOutcomeUnknown };
