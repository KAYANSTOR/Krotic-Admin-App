/**
 * Delivery operations — deterministic id + transactional state transitions.
 *
 * Contract (docs/contracts/whatsapp-gateway-api.md):
 * - Operation stays sms_pending until real device result or reliable ACK.
 * - tryStartSmsFallback only moves to sms_pending (and caller enqueues task).
 * - completeSmsFallbackFromDevice is the only path to sms_sent from device.
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
 * Optional toLocalPhone + messageBody enable SMS device task enqueue later.
 */
export async function createDeliveryOperation(db, {
  networkId,
  ownerUid,
  saleUuid,
  inboundEventId = null,
  toLocalPhone = null,
  messageBody = null,
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
    toLocalPhone: typeof toLocalPhone === 'string' ? toLocalPhone : null,
    messageBody: typeof messageBody === 'string' ? messageBody.slice(0, 1000) : null,
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

/**
 * Start SMS fallback path: move to sms_pending ONLY.
 * Does NOT mark sms_sent. Caller must enqueue whatsapp_sms_device_tasks.
 * sms_sent happens only via completeSmsFallbackFromDevice after real device result.
 */
export async function tryStartSmsFallback(db, deliveryOperationId, now = Date.now()) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const current = snap.data() || {};
  if (current.smsFallbackSentAtMs != null) return { ok: false, error: 'sms_already_sent' };
  if (!canStartSmsFallback(current.status)) {
    return { ok: false, error: 'sms_not_allowed_from_status', status: current.status };
  }
  if (current.status === 'sms_pending') {
    return { ok: true, data: current, alreadyPending: true };
  }
  return transitionDeliveryStatus(db, deliveryOperationId, 'sms_pending', {}, now);
}

/**
 * Complete SMS fallback after real device outcome (task status sent|failed)
 * or reliable provider ACK. This is the ONLY path that sets sms_sent.
 *
 * @param {'sent'|'failed'} deviceOutcome
 * @param {{ deviceSentAtMs?: number, deviceError?: string|null }} meta
 */
export async function completeSmsFallbackFromDevice(db, deliveryOperationId, deviceOutcome, meta = {}, now = Date.now()) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const current = snap.data() || {};

  if (current.smsFallbackSentAtMs != null || current.status === 'sms_sent') {
    return { ok: true, data: current, alreadySent: true };
  }
  if (current.status !== 'sms_pending') {
    return { ok: false, error: 'not_sms_pending', status: current.status };
  }

  if (deviceOutcome === 'sent') {
    return transitionDeliveryStatus(db, deliveryOperationId, 'sms_sent', {
      deviceSentAtMs: meta.deviceSentAtMs ?? now,
      deviceError: null,
    }, now);
  }

  if (deviceOutcome === 'failed') {
    const next = {
      ...current,
      status: 'failed',
      smsOutcomeUnknown: false,
      deviceError: meta.deviceError ? String(meta.deviceError).slice(0, 120) : 'sms_device_failed',
      deviceFailedAtMs: now,
      updatedAtMs: now,
    };
    await ref.set(next, { merge: false });
    return { ok: true, data: next, deviceFailed: true };
  }

  return { ok: false, error: 'invalid_device_outcome', deviceOutcome };
}
