/**
 * SMS fallback once-only claim — identity = deliveryOperationId (= networkId + saleUuid).
 * Reserve BEFORE external send (when real send exists). Crash after external send:
 * recovery sees smsClaimOwner without smsFallbackSentAtMs → complete without re-send.
 */
import { DELIVERY_OPS_COLLECTION, transitionDeliveryStatus } from './deliveryOperations.js';
import { canStartSmsFallback } from './deliveryState.js';

export const SMS_CLAIM_LOCK_MS = 60_000;

/**
 * Atomically claim the right to send exactly one SMS for this delivery op.
 * @returns {{ ok: true, claimed: boolean, alreadySent?: boolean, data? } | { ok: false, error: string }}
 */
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
    // Active claim by another worker
    if (
      current.smsClaimOwner
      && current.smsClaimOwner !== workerId
      && Number(current.smsClaimUntilMs) > now
    ) {
      return { ok: true, claimed: false, alreadySent: false, data: current, reason: 'locked' };
    }
    // Expired claim: do NOT re-send if provider was already accepted
    if (current.smsProviderAcceptedAtMs != null && current.smsFallbackSentAtMs == null) {
      return {
        ok: true,
        claimed: true,
        completeOnly: true,
        data: current,
        reason: 'complete_after_crash',
      };
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
        status: current.status === 'sms_pending' ? 'sms_pending' : 'sms_pending',
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

/** Mark SMS as accepted by provider (before or instead of final sms_sent). */
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

/** Finalize SMS sent — sets smsFallbackSentAtMs once. */
export async function completeSmsFallback(db, deliveryOperationId, now = Date.now()) {
  return transitionDeliveryStatus(db, deliveryOperationId, 'sms_sent', {}, now);
}

/**
 * High-level: claim → (optional provider accept) → complete.
 * No real SMS send. Concurrent callers: only one claims.
 */
export async function tryStartSmsFallbackOnce(db, deliveryOperationId, {
  workerId = `sms-${Date.now()}`,
  now = Date.now(),
} = {}) {
  const claim = await claimSmsFallbackSlot(db, deliveryOperationId, { workerId, now });
  if (!claim.ok) return claim;
  if (claim.alreadySent) return { ok: false, error: 'sms_already_sent' };
  if (!claim.claimed) return { ok: false, error: claim.reason || 'sms_not_claimed' };

  if (claim.completeOnly) {
    return completeSmsFallback(db, deliveryOperationId, now);
  }

  // Future: external SMS API here. On success:
  await markSmsProviderAccepted(db, deliveryOperationId, now);
  return completeSmsFallback(db, deliveryOperationId, now);
}
