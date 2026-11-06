/**
 * Contract: server → network-owner Android SMS execution
 *
 * Source of truth (Krotak-Pro feature/paid-features docs):
 *  - MessageDeliveryWorker + NativeMessageSender + SmsBridge on device
 *  - Server creates durable SMS task tied to original sale/card
 *  - Device executes; no parallel SMS from old LocalTransferProcessor path
 *
 * This module defines Firestore task shape for the server side only.
 * Android changes are OUT OF SCOPE for this repo — documented below.
 *
 * Collection (proposed): whatsapp_sms_device_tasks/{taskId}
 * taskId === deliveryOperationId (once-only create)
 */

export const SMS_DEVICE_TASKS_COLLECTION = 'whatsapp_sms_device_tasks';

export const SMS_DEVICE_TASK_STATUSES = Object.freeze([
  'queued',       // waiting for owner device
  'claimed',      // device took the job
  'sent',         // device reports provider accepted / SmsManager sent
  'failed',       // device reports permanent failure
  'expired',      // optional TTL
]);

/**
 * Build task document — body must be the SAME card text as WhatsApp attempt.
 * Never include Meta tokens.
 */
export function buildSmsDeviceTask({ deliveryOperationId, networkId, ownerUid, toLocalPhone, body, now = Date.now() }) {
  if (!deliveryOperationId || !networkId || !ownerUid) {
    return { ok: false, error: 'task_identity_required' };
  }
  if (typeof toLocalPhone !== 'string' || toLocalPhone.length < 8) {
    return { ok: false, error: 'recipient_invalid' };
  }
  if (typeof body !== 'string' || body.length < 1 || body.length > 1000) {
    return { ok: false, error: 'body_invalid' };
  }
  return {
    ok: true,
    taskId: deliveryOperationId,
    data: {
      taskId: deliveryOperationId,
      deliveryOperationId,
      networkId,
      ownerUid,
      toLocalPhone,
      body,
      status: 'queued',
      claimOwnerDeviceId: null,
      claimUntilMs: null,
      deviceSentAtMs: null,
      deviceError: null,
      createdAtMs: now,
      updatedAtMs: now,
    },
  };
}

export async function enqueueSmsDeviceTask(db, args) {
  const built = buildSmsDeviceTask(args);
  if (!built.ok) return built;
  const ref = db.collection(SMS_DEVICE_TASKS_COLLECTION).doc(built.taskId);
  try {
    await ref.create(built.data);
    return { ok: true, taskId: built.taskId, duplicate: false };
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists' || /already exists/i.test(String(error?.message || ''))) {
      return { ok: true, taskId: built.taskId, duplicate: true };
    }
    throw error;
  }
}

/**
 * Android integration contract (NOT implemented in this repo):
 *
 * 1. Server creates task after SMS claim (once).
 * 2. Device polls or receives FCM: list tasks where ownerUid == signed-in uid AND status==queued.
 * 3. Device claims with deviceId + lease; sends via NativeMessageSender/SmsBridge.
 * 4. Device writes status sent|failed; server maps to completeSmsFallback / unknown.
 * 5. Offline phone → task stays queued (no second task).
 *
 * Required Android work (document only):
 *  - Poll or FCM handler for whatsapp_sms_device_tasks
 *  - Claim transaction compatible with this schema
 *  - Report result without creating new sale/card
 */
export const ANDROID_SMS_INTEGRATION_NOTES = Object.freeze({
  existingComponents: [
    'MessageDeliveryWorker',
    'NativeMessageSender',
    'SmsBridge',
    'CardDeliveryStore',
  ],
  serverCollection: SMS_DEVICE_TASKS_COLLECTION,
  onceKey: 'taskId === deliveryOperationId',
  noSecondCard: true,
  offlineBehavior: 'task remains queued until device recovers',
  outOfScopeInAdminRepo: true,
});
