/**
 * Delivery operations — deterministic id + transactional state transitions.
 */
import { buildDeliveryOperationId } from './eventIdentity.js';
import {
  canTransition,
  canStartSmsFallback,
  canMarkDeliveredLateAfterSms,
  computeWhatsappDeadlineAtMs,
} from './deliveryState.js';

export const DELIVERY_OPS_COLLECTION = 'whatsapp_delivery_operations';

/**
 * Create delivery operation once for networkId + saleUuid.
 */
export async function createDeliveryOperation(db, {
  networkId,
  ownerUid,
  saleUuid,
  inboundEventId = null,
  now = Date.now(),
}) {
  const id = buildDeliveryOperationId({ networkId, saleUuid });
  if (!id.ok) return id;

  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(id.deliveryOperationId);
  const data = {
    networkId,
    ownerUid,
    saleUuid,
    inboundEventId,
    channel: 'whatsapp',
    providerId: 'meta',
    providerMessageId: null,
    status: 'accepted',
    smsFallbackScheduledAtMs: null,
    smsFallbackSentAtMs: null,
    whatsappDeadlineAtMs: null,
    lockOwner: null,
    lockUntilMs: null,
    createdAtMs: now,
    updatedAtMs: now,
  };

  try {
    await ref.create(data);
    return { ok: true, deliveryOperationId: id.deliveryOperationId, duplicate: false, data };
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists' || /already exists/i.test(String(error?.message || ''))) {
      const existing = await ref.get();
      return {
        ok: true,
        deliveryOperationId: id.deliveryOperationId,
        duplicate: true,
        data: existing.exists ? existing.data() : null,
      };
    }
    throw error;
  }
}

/**
 * Transition status inside a transaction-like callback using get/set on fake or real db.
 * Callers should pass db.runTransaction when available.
 */
export async function transitionDeliveryStatus(db, deliveryOperationId, toStatus, patch = {}, now = Date.now()) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);

  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
      const current = snap.data() || {};
      if (!canTransition(current.status, toStatus)) {
        return { ok: false, error: 'transition_not_allowed', from: current.status, to: toStatus };
      }
      if (toStatus === 'sms_sent' && current.smsFallbackSentAtMs != null) {
        return { ok: false, error: 'sms_already_sent' };
      }
      if (toStatus === 'delivered_late_after_sms' && !canMarkDeliveredLateAfterSms(current.status)) {
        return { ok: false, error: 'transition_not_allowed', from: current.status, to: toStatus };
      }

      const next = {
        ...current,
        ...patch,
        status: toStatus,
        updatedAtMs: now,
      };
      if (toStatus === 'sent') {
        next.whatsappDeadlineAtMs = computeWhatsappDeadlineAtMs(now, now);
        next.channel = 'whatsapp';
      }
      if (toStatus === 'sms_pending') {
        next.smsFallbackScheduledAtMs = now;
      }
      if (toStatus === 'sms_sent') {
        next.smsFallbackSentAtMs = now;
        next.channel = 'sms';
        next.providerId = 'sms';
      }
      tx.set(ref, next, { merge: false });
      return { ok: true, data: next };
    });
  }

  // Fallback path for simple fakes without transaction
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const current = snap.data() || {};
  if (!canTransition(current.status, toStatus)) {
    return { ok: false, error: 'transition_not_allowed', from: current.status, to: toStatus };
  }
  if (toStatus === 'sms_sent' && current.smsFallbackSentAtMs != null) {
    return { ok: false, error: 'sms_already_sent' };
  }
  const next = { ...current, ...patch, status: toStatus, updatedAtMs: now };
  if (toStatus === 'sent') next.whatsappDeadlineAtMs = computeWhatsappDeadlineAtMs(now, now);
  if (toStatus === 'sms_pending') next.smsFallbackScheduledAtMs = now;
  if (toStatus === 'sms_sent') {
    next.smsFallbackSentAtMs = now;
    next.channel = 'sms';
    next.providerId = 'sms';
  }
  await ref.set(next, { merge: false });
  return { ok: true, data: next };
}

export async function tryStartSmsFallback(db, deliveryOperationId, now = Date.now()) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const current = snap.data() || {};
  if (current.smsFallbackSentAtMs != null) return { ok: false, error: 'sms_already_sent' };
  if (!canStartSmsFallback(current.status)) {
    return { ok: false, error: 'sms_not_allowed_from_status', status: current.status };
  }
  if (current.status !== 'sms_pending') {
    const pending = await transitionDeliveryStatus(db, deliveryOperationId, 'sms_pending', {}, now);
    if (!pending.ok) return pending;
  }
  return transitionDeliveryStatus(db, deliveryOperationId, 'sms_sent', {}, now);
}
