/**
 * Meta delivery status callbacks → whatsapp_delivery_operations.
 * No raw webhook body storage. Deduped by providerId+networkId+providerMessageId+status.
 */
import { WHATSAPP_PROVIDER_META } from './eventIdentity.js';
import { canTransition, canMarkDeliveredLateAfterSms } from './deliveryState.js';
import { transitionDeliveryStatus, DELIVERY_OPS_COLLECTION } from './deliveryOperations.js';

export const STATUS_EVENTS_COLLECTION = 'whatsapp_status_events';

const STATUS_RANK = Object.freeze({
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 1,
  sms_pending: 2,
  sms_sent: 3,
  delivered_late_after_sms: 4,
});

const META_TO_INTERNAL = Object.freeze({
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
});

export function mapMetaStatus(metaStatus) {
  if (typeof metaStatus !== 'string') return null;
  return META_TO_INTERNAL[metaStatus.toLowerCase()] || null;
}

export function buildStatusEventDocId({
  providerId = WHATSAPP_PROVIDER_META,
  networkId,
  providerMessageId,
  status,
}) {
  if (!networkId || !providerMessageId || !status) {
    return { ok: false, error: 'status_event_id_invalid' };
  }
  const safe = String(providerMessageId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  return {
    ok: true,
    docId: `${providerId}_${networkId}_${safe}_${status}`,
  };
}

export function extractMetaStatusUpdates(payload) {
  const out = [];
  if (!payload || payload.object !== 'whatsapp_business_account') return out;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      for (const st of value.statuses || []) {
        const internal = mapMetaStatus(st.status);
        if (!internal || !st.id) continue;
        out.push({
          providerMessageId: st.id,
          metaStatus: String(st.status).toLowerCase(),
          internalStatus: internal,
          phoneNumberId,
          recipientId: st.recipient_id || null,
          occurredAtMs: st.timestamp ? Number(st.timestamp) * 1000 : null,
          errorCode: st.errors?.[0]?.code ?? null,
        });
      }
    }
  }
  return out;
}

export async function findDeliveryByProviderMessageId(db, networkId, providerMessageId) {
  const matches = [];

  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (
        path.startsWith(`${DELIVERY_OPS_COLLECTION}/`)
        && data?.networkId === networkId
        && data?.providerMessageId === providerMessageId
      ) {
        matches.push({ id: path.slice(DELIVERY_OPS_COLLECTION.length + 1), data });
      }
    }
  } else {
    try {
      const q = await db.collection(DELIVERY_OPS_COLLECTION)
        .where('networkId', '==', networkId)
        .where('providerMessageId', '==', providerMessageId)
        .limit(5)
        .get();
      for (const doc of q.docs || []) {
        matches.push({ id: doc.id, data: doc.data() });
      }
    } catch {
      // missing composite index — fall through empty
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

export async function recordStatusEvent(db, {
  networkId,
  providerMessageId,
  internalStatus,
  metaStatus,
  occurredAtMs,
  now = Date.now(),
  deliveryOperationId = null,
}) {
  const id = buildStatusEventDocId({
    networkId,
    providerMessageId,
    status: internalStatus,
  });
  if (!id.ok) return id;

  const ref = db.collection(STATUS_EVENTS_COLLECTION).doc(id.docId);
  const data = {
    providerId: WHATSAPP_PROVIDER_META,
    networkId,
    providerMessageId,
    status: internalStatus,
    metaStatus: metaStatus || internalStatus,
    deliveryOperationId,
    occurredAtMs: Number.isSafeInteger(occurredAtMs) ? occurredAtMs : null,
    receivedAtMs: now,
  };
  try {
    await ref.create(data);
    return { ok: true, docId: id.docId, duplicate: false, data };
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists' || /already exists/i.test(String(error?.message || ''))) {
      return { ok: true, docId: id.docId, duplicate: true };
    }
    throw error;
  }
}

export async function applyStatusToDelivery(db, deliveryOperationId, current, internalStatus, {
  now = Date.now(),
  occurredAtMs = null,
} = {}) {
  if (!current) return { ok: false, error: 'delivery_not_found' };

  if (current.status === 'sms_sent' || current.status === 'delivered_late_after_sms') {
    if (internalStatus === 'delivered' || internalStatus === 'read') {
      if (current.status === 'delivered_late_after_sms') {
        return { ok: true, skipped: true, reason: 'already_late_confirmed' };
      }
      if (canMarkDeliveredLateAfterSms(current.status)) {
        return transitionDeliveryStatus(db, deliveryOperationId, 'delivered_late_after_sms', {
          lastProviderStatusAtMs: occurredAtMs ?? now,
          lastProviderStatus: internalStatus,
        }, now);
      }
    }
    return { ok: true, skipped: true, reason: 'post_sms_ignore', from: current.status, to: internalStatus };
  }

  if (current.status === 'delivered' || current.status === 'read') {
    if (internalStatus === 'failed') {
      return { ok: true, skipped: true, reason: 'ignore_failed_after_success' };
    }
    if (internalStatus === 'read' && current.status === 'delivered') {
      const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
      await ref.set({
        ...current,
        status: 'read',
        lastProviderStatusAtMs: occurredAtMs ?? now,
        lastProviderStatus: 'read',
        updatedAtMs: now,
      }, { merge: false });
      return { ok: true, data: { ...current, status: 'read' } };
    }
    if (STATUS_RANK[internalStatus] <= STATUS_RANK[current.status]) {
      return { ok: true, skipped: true, reason: 'no_regression' };
    }
  }

  if (!canTransition(current.status, internalStatus)) {
    if (
      (current.status === 'accepted' || current.status === 'sent')
      && (internalStatus === 'delivered' || internalStatus === 'read')
    ) {
      if (current.status === 'accepted' && internalStatus === 'delivered') {
        const sent = await transitionDeliveryStatus(db, deliveryOperationId, 'sent', {
          lastProviderStatusAtMs: occurredAtMs ?? now,
        }, now);
        if (!sent.ok) return sent;
        return transitionDeliveryStatus(db, deliveryOperationId, 'delivered', {
          lastProviderStatusAtMs: occurredAtMs ?? now,
          lastProviderStatus: internalStatus,
        }, now);
      }
      if (current.status === 'sent' && internalStatus === 'delivered') {
        return transitionDeliveryStatus(db, deliveryOperationId, 'delivered', {
          lastProviderStatusAtMs: occurredAtMs ?? now,
          lastProviderStatus: 'delivered',
        }, now);
      }
      if (current.status === 'sent' && internalStatus === 'read') {
        const del = await transitionDeliveryStatus(db, deliveryOperationId, 'delivered', {
          lastProviderStatusAtMs: occurredAtMs ?? now,
        }, now);
        if (!del.ok) return del;
        const ref = db.collection(DELIVERY_OPS_COLLECTION).doc(deliveryOperationId);
        const after = (await ref.get()).data();
        await ref.set({
          ...after,
          status: 'read',
          lastProviderStatus: 'read',
          lastProviderStatusAtMs: occurredAtMs ?? now,
          updatedAtMs: now,
        }, { merge: false });
        return { ok: true, data: { ...after, status: 'read' } };
      }
    }
    return { ok: true, skipped: true, reason: 'transition_not_allowed', from: current.status, to: internalStatus };
  }

  return transitionDeliveryStatus(db, deliveryOperationId, internalStatus, {
    lastProviderStatusAtMs: occurredAtMs ?? now,
    lastProviderStatus: internalStatus,
  }, now);
}

export async function processMetaStatusUpdate(db, update, {
  resolveNetworkIdByPhoneNumberId,
  now = Date.now(),
} = {}) {
  if (!update?.providerMessageId || !update.internalStatus) {
    return { ok: false, error: 'status_update_invalid' };
  }

  const networkId = await resolveNetworkIdByPhoneNumberId(db, update.phoneNumberId);
  if (!networkId) {
    return { ok: true, skipped: true, reason: 'network_unresolved' };
  }

  const delivery = await findDeliveryByProviderMessageId(db, networkId, update.providerMessageId);
  if (!delivery) {
    const recorded = await recordStatusEvent(db, {
      networkId,
      providerMessageId: update.providerMessageId,
      internalStatus: update.internalStatus,
      metaStatus: update.metaStatus,
      occurredAtMs: update.occurredAtMs,
      now,
      deliveryOperationId: null,
    });
    return {
      ok: true,
      skipped: true,
      reason: 'delivery_unlinked',
      statusEventDuplicate: recorded.duplicate,
    };
  }

  const recorded = await recordStatusEvent(db, {
    networkId,
    providerMessageId: update.providerMessageId,
    internalStatus: update.internalStatus,
    metaStatus: update.metaStatus,
    occurredAtMs: update.occurredAtMs,
    now,
    deliveryOperationId: delivery.id,
  });
  if (recorded.duplicate) {
    return { ok: true, skipped: true, reason: 'status_event_duplicate', deliveryOperationId: delivery.id };
  }

  const applied = await applyStatusToDelivery(db, delivery.id, delivery.data, update.internalStatus, {
    now,
    occurredAtMs: update.occurredAtMs,
  });
  return {
    ok: true,
    deliveryOperationId: delivery.id,
    applied,
  };
}
