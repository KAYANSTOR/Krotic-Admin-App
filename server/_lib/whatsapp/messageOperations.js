import { createHash } from 'node:crypto';

export const WHATSAPP_MESSAGE_REQUESTS = 'whatsapp_message_requests';

export function buildMessageRequestId(networkId, deliveryId) {
  return createHash('sha256').update(`${networkId}\u0000${deliveryId}`).digest('hex');
}

export function buildMessageRequestFingerprint({ networkId, destination, body, templateKey = null }) {
  return createHash('sha256')
    .update(JSON.stringify({ networkId, destination, body, templateKey }))
    .digest('hex');
}

/** Claim a delivery key before contacting a provider; a duplicate never sends twice. */
export async function createOutboundMessageRequest(db, {
  networkId,
  ownerUid,
  deliveryId,
  destination,
  body,
  templateKey = null,
  provider,
  now = Date.now(),
}) {
  const requestId = buildMessageRequestId(networkId, deliveryId);
  const requestHash = buildMessageRequestFingerprint({ networkId, destination, body, templateKey });
  const deliveryKeyHash = createHash('sha256').update(deliveryId).digest('hex');
  const ref = db.collection(WHATSAPP_MESSAGE_REQUESTS).doc(requestId);
  const data = {
    networkId,
    ownerUid: ownerUid || null,
    deliveryKeyHash,
    requestHash,
    provider,
    status: 'processing',
    providerMessageId: null,
    lastProviderStatus: null,
    lastProviderStatusAtMs: null,
    createdAtMs: now,
    updatedAtMs: now,
  };
  try {
    await ref.create(data);
    return { ok: true, requestId, duplicate: false, data };
  } catch (error) {
    if (error?.code !== 6 && error?.code !== 'already-exists' && !/already exists/i.test(String(error?.message || ''))) throw error;
    const snap = await ref.get();
    const current = snap.exists ? snap.data() || {} : null;
    if (!current || current.requestHash !== requestHash || current.deliveryKeyHash !== deliveryKeyHash) {
      return { ok: false, error: 'delivery_id_conflict', requestId };
    }
    if (['sent', 'delivered', 'read'].includes(current.status) && current.providerMessageId) {
      return { ok: true, requestId, duplicate: true, alreadySent: true, data: current };
    }
    return {
      ok: false,
      error: current.status === 'processing' ? 'delivery_in_progress' : 'delivery_id_already_used',
      uncertain: current.status === 'unknown' || current.status === 'processing',
      requestId,
      data: current,
    };
  }
}

export async function finishOutboundMessageRequest(db, requestId, {
  status,
  providerMessageId = null,
  reasonCode = null,
  now = Date.now(),
} = {}) {
  const ref = db.collection(WHATSAPP_MESSAGE_REQUESTS).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'message_request_not_found' };
  const current = snap.data() || {};
  const allowed = new Set(['sent', 'failed', 'unknown']);
  if (!allowed.has(status)) return { ok: false, error: 'message_status_invalid' };
  const next = {
    ...current,
    status: status === 'sent' && current.status !== 'processing' ? current.status : status,
    providerMessageId: providerMessageId || current.providerMessageId || null,
    reasonCode: typeof reasonCode === 'string' ? reasonCode.slice(0, 64) : null,
    updatedAtMs: now,
  };
  await ref.set(next, { merge: false });
  return { ok: true, data: next };
}

export async function findOutboundMessageRequestByProviderId(db, networkId, providerMessageId) {
  const matches = [];
  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith(`${WHATSAPP_MESSAGE_REQUESTS}/`)
          && data?.networkId === networkId && data?.providerMessageId === providerMessageId) {
        matches.push({ id: path.slice(WHATSAPP_MESSAGE_REQUESTS.length + 1), data });
      }
    }
  } else {
    try {
      const query = await db.collection(WHATSAPP_MESSAGE_REQUESTS)
        .where('providerMessageId', '==', providerMessageId)
        .limit(10)
        .get();
      for (const doc of query.docs || []) {
        const data = doc.data() || {};
        if (data.networkId === networkId) matches.push({ id: doc.id, data });
      }
    } catch {
      // Optional status persistence must not make Meta webhook retries fail.
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function findOutboundMessageRequestByDeliveryId(db, networkId, deliveryId) {
  if (!networkId || !deliveryId) return null;
  const requestId = buildMessageRequestId(networkId, deliveryId);
  const snap = await db.collection(WHATSAPP_MESSAGE_REQUESTS).doc(requestId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const deliveryKeyHash = createHash('sha256').update(deliveryId).digest('hex');
  return data.networkId === networkId && data.deliveryKeyHash === deliveryKeyHash
    ? { id: requestId, data }
    : null;
}

export async function applyStatusToOutboundMessageRequest(db, match, update, now = Date.now()) {
  if (!match?.id || !match.data) return { ok: false, error: 'message_request_not_found' };
  const current = match.data;
  const rank = { processing: 0, sent: 1, delivered: 2, read: 3, failed: 1 };
  if (['delivered', 'read'].includes(current.status) && update.internalStatus === 'failed') {
    return { ok: true, skipped: true, reason: 'ignore_failed_after_success' };
  }
  if ((rank[current.status] ?? -1) > (rank[update.internalStatus] ?? -1)) {
    return { ok: true, skipped: true, reason: 'no_regression' };
  }
  const next = {
    ...current,
    status: update.internalStatus,
    providerMessageId: current.providerMessageId || update.providerMessageId || null,
    lastProviderStatus: update.metaStatus,
    lastProviderStatusAtMs: Number.isSafeInteger(update.occurredAtMs) ? update.occurredAtMs : now,
    updatedAtMs: now,
  };
  await db.collection(WHATSAPP_MESSAGE_REQUESTS).doc(match.id).set(next, { merge: false });
  return { ok: true, data: next };
}
