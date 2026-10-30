/**
 * Orchestration helpers: link delivery state transitions to Firestore queue.
 * No real Meta/SMS send here — only durable scheduling records.
 */
import { transitionDeliveryStatus } from './deliveryOperations.js';
import { enqueueDeliveryJob } from './deliveryQueue.js';
import { computeWhatsappDeadlineAtMs } from './deliveryState.js';

/**
 * Mark operation as WhatsApp-sent and enqueue a one-shot deadline check job.
 * jobId === deliveryOperationId (atomic once).
 * runAfterMs = whatsappDeadlineAtMs (policy 10s) — wake-up still depends on dispatcher.
 */
export async function markSentAndEnqueueDeadline(db, deliveryOperationId, {
  networkId,
  now = Date.now(),
  providerMessageId = null,
} = {}) {
  const transition = await transitionDeliveryStatus(
    db,
    deliveryOperationId,
    'sent',
    providerMessageId ? { providerMessageId } : {},
    now,
  );
  if (!transition.ok) return transition;

  const deadline = transition.data.whatsappDeadlineAtMs
    ?? computeWhatsappDeadlineAtMs(now, now);

  const job = await enqueueDeliveryJob(db, {
    jobId: deliveryOperationId,
    deliveryOperationId,
    networkId: networkId || transition.data.networkId || null,
    kind: 'deadline_check',
    runAfterMs: deadline,
    now,
    payload: { reason: 'whatsapp_10s_deadline' },
  });

  return {
    ok: true,
    delivery: transition.data,
    queue: job,
    deadlineAtMs: deadline,
    note: 'Job recorded; exact 10s fire requires an external or cron wake-up of dispatch',
  };
}
