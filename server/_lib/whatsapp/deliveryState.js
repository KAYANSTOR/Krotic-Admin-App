/**
 * Delivery operation state machine (DB-level once-only).
 * Transitions are validated purely; Firestore transactions enforce them.
 */

export const DELIVERY_STATUSES = Object.freeze([
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'sms_pending',
  'sms_sent',
  'delivered_late_after_sms',
]);

/** Allowed single-step transitions. */
const TRANSITIONS = Object.freeze({
  accepted: ['sent', 'failed', 'sms_pending'],
  sent: ['delivered', 'read', 'failed', 'sms_pending'],
  delivered: [],
  read: [],
  failed: ['sms_pending'],
  sms_pending: ['sms_sent'],
  sms_sent: ['delivered_late_after_sms'],
  delivered_late_after_sms: [],
});

export function canTransition(fromStatus, toStatus) {
  if (!DELIVERY_STATUSES.includes(fromStatus) || !DELIVERY_STATUSES.includes(toStatus)) {
    return false;
  }
  return (TRANSITIONS[fromStatus] || []).includes(toStatus);
}

/**
 * Whether SMS fallback may be started from current status.
 * Requires smsFallbackSentAtMs to be null at call site.
 */
export function canStartSmsFallback(status) {
  return status === 'sent' || status === 'failed' || status === 'accepted' || status === 'sms_pending';
}

/** Late WhatsApp confirmation after SMS already sent. */
export function canMarkDeliveredLateAfterSms(status) {
  return status === 'sms_sent';
}

export const WHATSAPP_CONFIRMATION_WINDOW_MS = 10_000;

export function computeWhatsappDeadlineAtMs(sentAtMs, now = Date.now()) {
  const base = Number.isSafeInteger(sentAtMs) ? sentAtMs : now;
  return base + WHATSAPP_CONFIRMATION_WINDOW_MS;
}

export function isWhatsappDeadlineExpired(deadlineAtMs, now = Date.now()) {
  return Number.isSafeInteger(deadlineAtMs) && now >= deadlineAtMs;
}
