/**
 * High-level: create/send WhatsApp card message for an existing delivery op.
 * Safe retries: never creates a second deliveryOperationId; only updates providerMessageId once.
 */
import { DELIVERY_OPS_COLLECTION, transitionDeliveryStatus } from './deliveryOperations.js';
import { markSentAndEnqueueDeadline } from './deliveryOrchestration.js';
import { sendCloudTextMessage } from './metaCloudSend.js';
import { isWhatsappCardDeliveryEnabled } from './entitlementsGate.js';

/**
 * Attempt Cloud send for delivery op already in accepted (or retry from accepted after transient fail).
 * On success: markSentAndEnqueueDeadline with providerMessageId.
 */
export async function sendWhatsappForDeliveryOperation(db, deliveryOperationId, {
  toE164,
  text,
  now = Date.now(),
  sendDeps = {},
} = {}) {
  const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const op = snap.data() || {};

  if (op.providerMessageId) {
    return { ok: true, alreadySent: true, providerMessageId: op.providerMessageId, status: op.status };
  }
  if (op.status !== 'accepted' && op.status !== 'failed') {
    return { ok: false, error: 'send_not_allowed_from_status', status: op.status };
  }

  if (op.ownerUid) {
    const userSnap = await db.collection('users').doc(op.ownerUid).get();
    const features = userSnap.exists ? (userSnap.data() || {}).account_features : null;
    if (!isWhatsappCardDeliveryEnabled(features)) {
      return { ok: false, error: 'entitlement_closed' };
    }
  }

  const sendResult = await sendCloudTextMessage(db, {
    networkId: op.networkId,
    toE164,
    text,
    clientReferenceId: deliveryOperationId,
  }, sendDeps);

  if (!sendResult.ok) {
    // Permanent failure → mark failed (no new op)
    if (sendResult.classification?.class === 'final') {
      await transitionDeliveryStatus(db, deliveryOperationId, 'failed', {
        lastSendError: sendResult.error,
        lastSendMetaCode: sendResult.metaCode ?? null,
      }, now);
    }
    return sendResult;
  }

  return markSentAndEnqueueDeadline(db, deliveryOperationId, {
    networkId: op.networkId,
    now,
    providerMessageId: sendResult.providerMessageId,
  });
}
