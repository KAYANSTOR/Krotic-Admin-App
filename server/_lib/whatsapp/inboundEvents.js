/**
 * Atomic inbound event registration — create only, no raw webhook body storage.
 */
import {
  buildInboundEventDocId,
  WHATSAPP_PROVIDER_META,
} from './eventIdentity.js';
import {
  TEXT_RETENTION_MS,
  computeTextRetentionUntilMs,
  computeEventExpiresAtMs,
  INBOUND_EVENTS_COLLECTION,
} from './retention.js';

export { INBOUND_EVENTS_COLLECTION, TEXT_RETENTION_MS };

/**
 * Create inbound event document. Fails with duplicate when already exists.
 * @returns {Promise<{ ok: true, docId: string, duplicate?: boolean } | { ok: false, error: string }>}
 */
export async function createInboundEvent(db, {
  providerId = WHATSAPP_PROVIDER_META,
  networkId,
  inboundMessageId,
  ownerUid = null,
  fromE164 = null,
  messageType = null,
  text = null,
  occurredAtMs = null,
  now = Date.now(),
}) {
  const id = buildInboundEventDocId({ providerId, networkId, inboundMessageId });
  if (!id.ok) return id;

  const ref = db.collection(INBOUND_EVENTS_COLLECTION).doc(id.docId);
  const hasText = typeof text === 'string' && text.length > 0;
  const data = {
    providerId,
    inboundMessageId,
    networkId,
    ownerUid: typeof ownerUid === 'string' ? ownerUid : null,
    fromE164: typeof fromE164 === 'string' ? fromE164 : null,
    messageType: typeof messageType === 'string' ? messageType : null,
    // Store text only with retention deadline; purge job clears it without deleting the event.
    text: hasText ? text.slice(0, 4000) : null,
    textRetentionUntilMs: hasText ? computeTextRetentionUntilMs(now) : null,
    eventExpiresAtMs: computeEventExpiresAtMs(now),
    occurredAtMs: Number.isSafeInteger(occurredAtMs) ? occurredAtMs : null,
    receivedAtMs: now,
    signatureVerified: true,
    processingStatus: 'received',
    deliveryOperationId: null,
    lastErrorCode: null,
    updatedAtMs: now,
  };

  try {
    await ref.create(data);
    return { ok: true, docId: id.docId, duplicate: false };
  } catch (error) {
    // Firestore ALREADY_EXISTS ≈ code 6
    if (error?.code === 6 || error?.code === 'already-exists' || /already exists/i.test(String(error?.message || ''))) {
      return { ok: true, docId: id.docId, duplicate: true };
    }
    throw error;
  }
}
