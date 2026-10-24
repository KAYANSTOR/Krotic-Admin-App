const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

const DEFAULT_TOPIC = process.env.FCM_DEFAULT_TOPIC || 'krotak_all_users';
// Keep the same channel as the live Vercel senders (`api/send-fcm.js` and
// `api/dispatch-notifications.js`); a different channel id silently drops the
// notification on devices that only register the current channel.
const ANDROID_CHANNEL_ID = process.env.FCM_ANDROID_CHANNEL_ID || 'krotak_admin_v2';

function stringifyData(data) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]));
}

/**
 * Builds the notification_deliveries row. `updatedAtMs` is required by the
 * admin dashboard's incremental sync; without it the delivery never reaches the
 * local history view.
 */
function buildDeliveryRecord({
  requestId,
  title,
  body,
  target,
  audienceType,
  targetUid = null,
  sent,
  failed,
  now = Date.now(),
}) {
  return {
    requestId,
    title,
    body,
    message: body,
    target,
    ...(targetUid ? { targetUid } : {}),
    audienceType,
    sent,
    failed,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
    updatedAtMs: now,
    timestamp: now,
    status: failed && !sent ? 'failed' : 'sent',
  };
}

function chunksOf(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

const RETRYABLE_FCM_CODES = new Set([
  'messaging/server-unavailable',
  'messaging/internal-error',
  'messaging/unknown-error',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'messaging/quota-exceeded',
]);
const INVALID_FCM_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

async function sendTokensInBatches({
  tokens,
  tokenDocIds,
  message,
  sendEachForMulticast,
  onAttempt = () => {},
  onAccepted = () => {},
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  maxAttempts = 3,
}) {
  let sent = 0;
  let failed = 0;
  const invalidDeviceDocIds = new Set();
  for (const tokenBatch of chunksOf(tokens, 500)) {
    let pendingTokens = tokenBatch;
    for (let attempt = 1; pendingTokens.length && attempt <= maxAttempts; attempt += 1) {
      const attemptedTokens = pendingTokens;
      onAttempt();
      const result = await sendEachForMulticast({ ...message, tokens: attemptedTokens });
      onAccepted();
      const responses = result?.responses;
      const responseSuccesses = Array.isArray(responses) ? responses.filter((response) => response?.success === true).length : -1;
      const responseFailures = Array.isArray(responses) ? responses.filter((response) => response?.success === false).length : -1;
      const malformed = !Array.isArray(responses)
        || responses.length !== attemptedTokens.length
        || !Number.isInteger(result.successCount)
        || !Number.isInteger(result.failureCount)
        || result.successCount + result.failureCount !== attemptedTokens.length
        || result.successCount !== responseSuccesses
        || result.failureCount !== responseFailures
        || responses.some((response) => !response
          || typeof response.success !== 'boolean'
          || (response.success === false && typeof response.error?.code !== 'string'));
      if (malformed) {
        throw new Error('fcm_malformed_multicast_response');
      }
      const retryTokens = [];
      result.responses.forEach((response, index) => {
        if (response.success) {
          sent += 1;
          return;
        }
        const code = response.error?.code;
        if (INVALID_FCM_TOKEN_CODES.has(code)) {
          failed += 1;
          (tokenDocIds.get(attemptedTokens[index]) || []).forEach((docId) => invalidDeviceDocIds.add(docId));
        } else if (RETRYABLE_FCM_CODES.has(code) && attempt < maxAttempts) {
          retryTokens.push(attemptedTokens[index]);
        } else {
          failed += 1;
        }
      });
      pendingTokens = retryTokens;
      if (pendingTokens.length && attempt < maxAttempts) await sleep(250 * (2 ** (attempt - 1)));
    }
  }
  return { sent, failed, invalidDeviceDocIds: [...invalidDeviceDocIds] };
}

async function deleteInvalidDeviceDocs(uid, docIds) {
  const deviceCollection = db.collection('users').doc(uid).collection('devices');
  for (const idBatch of chunksOf(docIds, 450)) {
    const batch = db.batch();
    idBatch.forEach((docId) => batch.delete(deviceCollection.doc(docId)));
    await batch.commit();
  }
}

const DISPATCH_LEASE_MS = 10 * 60 * 1000;
const TERMINAL_DISPATCH_STATUSES = new Set(['sent', 'partial', 'no_devices', 'rejected', 'failed', 'delivery_uncertain']);

function millis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

/**
 * Claims a request before any FCM call. Only a stale processing lease is
 * recoverable; a delivery outcome that crossed the FCM boundary is terminal.
 */
async function claimDispatchRequest(snapshot, { firestore = db, now = Date.now(), leaseMs = DISPATCH_LEASE_MS } = {}) {
  return firestore.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(snapshot.ref);
    if (!currentSnap.exists) return null;
    const request = currentSnap.data() || {};
    const status = String(request.status || '');
    if (TERMINAL_DISPATCH_STATUSES.has(status)) return null;

    const scheduledAt = Number(request.scheduledAt) || 0;
    if (scheduledAt > now) {
      if (status !== 'scheduled') transaction.update(snapshot.ref, { status: 'scheduled' });
      return null;
    }

    const leaseUntil = millis(request.dispatchLeaseUntil);
    if (status === 'processing' && leaseUntil > now) return null;

    const claimId = crypto.randomUUID();
    transaction.update(snapshot.ref, {
      status: 'processing',
      dispatchClaimId: claimId,
      dispatchAttempt: (Number(request.dispatchAttempt) || 0) + 1,
      dispatchClaimedAt: now,
      dispatchLeaseUntil: now + leaseMs,
      deliveryUncertain: false,
    });
    return { claimId, request, leaseUntil: now + leaseMs };
  });
}

async function updateClaimedRequest(ref, claim, patch, { firestore = db, fieldValue = FieldValue, delivery, inbox } = {}) {
  return firestore.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(ref);
    const current = currentSnap.exists ? currentSnap.data() || {} : {};
    if (!currentSnap.exists || current.dispatchClaimId !== claim.claimId || current.status !== 'processing') return false;
    transaction.update(ref, {
      ...patch,
      dispatchLeaseUntil: null,
      updatedAt: fieldValue.serverTimestamp(),
    });
    if (delivery) {
      transaction.set(firestore.collection('notification_deliveries').doc(ref.id), delivery, { merge: true });
    }
    if (inbox) {
      transaction.set(
        firestore.collection('users').doc(inbox.uid).collection('notifications').doc(ref.id),
        inbox.data,
        { merge: true },
      );
    }
    return true;
  });
}

async function schedulePreFcmRetry(ref, claim, error, { firestore = db, fieldValue = FieldValue, now = Date.now() } = {}) {
  const attempt = Math.max(1, Number(claim.request?.dispatchAttempt) || 1);
  const delayMs = Math.min(60_000 * (2 ** Math.min(attempt - 1, 5)), 30 * 60_000);
  return updateClaimedRequest(ref, claim, {
    status: 'scheduled',
    scheduledAt: now + delayMs,
    error: String(error.message || error),
  }, { firestore, fieldValue });
}

/**
 * FCM does not provide exactly-once delivery. A network error while sending or
 * persisting the result leaves delivery uncertain; the
 * request is marked terminal delivery_uncertain so a scheduler does not resend
 * successful batches and create duplicate notifications. An administrator may
 * inspect and manually resolve that status; FCM itself cannot guarantee exactly once.
 */
async function markDeliveryUncertain(ref, claim, error, { firestore = db } = {}) {
  return firestore.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(ref);
    const current = currentSnap.exists ? currentSnap.data() || {} : {};
    if (!currentSnap.exists || current.dispatchClaimId !== claim.claimId || current.status !== 'processing') return false;
    transaction.update(ref, {
      status: 'delivery_uncertain',
      deliveryUncertain: true,
      error: 'fcm_outcome_uncertain',
      errorDetail: String(error.message || error),
      dispatchLeaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

/**
 * ينفّذ طلب إشعار واحد ويسجّل النتيجة. مشترك بين الإرسال الفوري والمُجدوَل.
 */
async function dispatchRequest(snapshot) {
  const initialRequest = snapshot.data();
  if (!initialRequest) return;
  const requestId = snapshot.id;
  const title = String(initialRequest.title || '').trim();
  const body = String(initialRequest.body || initialRequest.message || '').trim();

  if (!title || !body) {
    await snapshot.ref.update({ status: 'rejected', error: 'title_and_body_required' });
    return;
  }

  const claim = await claimDispatchRequest(snapshot);
  if (!claim) return;
  const request = claim.request;

  const type = String(request.type || 'admin');
  const data = { ...stringifyData(request.data), requestId: String(requestId), type };
  let message;
  let targetDescription = `topic:${DEFAULT_TOPIC}`;
  let fcmAccepted = false;
  let fcmAttempted = false;
  let sent = 0;
  let failed = 0;
  let invalidDeviceDocIds = [];

  try {
    if (request.audienceType === 'user' && request.targetUid) {
      const devices = await db.collection('users').doc(request.targetUid).collection('devices').get();
      const tokenDocIds = new Map();
      devices.docs.forEach((deviceDoc) => {
        const token = deviceDoc.data().token;
        if (typeof token !== 'string' || !token) return;
        const docIds = tokenDocIds.get(token) || [];
        docIds.push(deviceDoc.id);
        tokenDocIds.set(token, docIds);
      });
      const tokens = [...tokenDocIds.keys()];
      if (!tokens.length) {
        await updateClaimedRequest(snapshot.ref, claim, { status: 'no_devices', completedAt: FieldValue.serverTimestamp() });
        return;
      }
      message = {
        notification: { title, body },
        data,
        android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
      };
      targetDescription = `user:${request.targetUid}`;
      const result = await sendTokensInBatches({
        tokens,
        tokenDocIds,
        message,
        sendEachForMulticast: (payload) => getMessaging().sendEachForMulticast(payload),
        onAttempt: () => { fcmAttempted = true; },
        onAccepted: () => { fcmAccepted = true; },
      });
      sent = result.sent;
      failed = result.failed;
      invalidDeviceDocIds = result.invalidDeviceDocIds;
    } else {
      message = {
        topic: DEFAULT_TOPIC,
        notification: { title, body },
        data,
        android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
      };
      fcmAttempted = true;
      await getMessaging().send(message);
      fcmAccepted = true;
      sent = 1;
    }

    const delivery = buildDeliveryRecord({
      requestId,
      title,
      body,
      target: targetDescription,
      audienceType: request.audienceType === 'user' && request.targetUid ? 'user' : 'global',
      targetUid: request.audienceType === 'user' && request.targetUid ? request.targetUid : null,
      sent,
      failed,
    });
    const inbox = request.audienceType === 'user' && request.targetUid && sent > 0
      ? {
          uid: request.targetUid,
          data: {
            title,
            message: body,
            timestamp: FieldValue.serverTimestamp(),
            is_read: false,
            is_global: false,
            audienceType: 'user',
          },
        }
      : undefined;
    const committed = await updateClaimedRequest(snapshot.ref, claim, {
      status: failed ? 'partial' : 'sent',
      target: targetDescription,
      sent,
      failed,
      completedAt: FieldValue.serverTimestamp(),
    }, { delivery, inbox });
    if (!committed) throw new Error('dispatch_claim_lost_after_fcm');

    if (invalidDeviceDocIds.length) {
      try {
        await deleteInvalidDeviceDocs(request.targetUid, invalidDeviceDocIds);
      } catch (error) {
        // Delivery is already recorded; device cleanup failure must not re-send FCM.
        console.error('Unable to delete invalid device documents', requestId, error);
      }
    }
  } catch (error) {
    if (fcmAccepted || fcmAttempted) {
      try {
        await markDeliveryUncertain(snapshot.ref, claim, error);
      } catch (uncertaintyError) {
        console.error('Unable to persist delivery uncertainty', requestId, uncertaintyError);
      }
    } else {
      try {
        await schedulePreFcmRetry(snapshot.ref, claim, error);
      } catch (failureStateError) {
        console.error('Unable to schedule dispatch retry', requestId, failureStateError);
      }
    }
    throw error;
  }
}

// الإرسال الفوري عند إنشاء طلب إشعار (يتجاهل الطلبات المجدولة لمستقبل).
exports.dispatchNotificationRequest = onDocumentCreated(
  'notification_requests/{requestId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    await dispatchRequest(snapshot);
  },
);

// ملاحظة (قرار المالك ز1): أُزيلت الدالة المجدولة المكررة `dispatchScheduledNotifications`.
// المرجع الوحيد للإشعارات المجدولة هو Vercel Cron عبر /api/dispatch-notifications
// المؤمَّن بـ CRON_SECRET (انظر vercel.json)، لتفادي تنفيذين متوازيين.

// مجاميع لوحة الإدارة: تمنع تنزيل سجل المبيعات التاريخي عند كل فتح للوحة.
function numeric(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function dateFrom(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function monthKey(value) {
  const date = dateFrom(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : null;
}
function saleFaceValue(sale) {
  const major = sale?.faceValue ?? sale?.amount ?? sale?.amountRiyal;
  if (major !== null && major !== undefined) {
    const value = numeric(major);
    return value > 0 ? value : 0;
  }
  const minor = numeric(sale?.amountMinor);
  const value = Number(sale?.moneyPolicyVersion) === 2 ? minor / 100 : minor;
  return value > 0 ? value : 0;
}
function saleContribution(sale) {
  // Older Android records can be completed without an explicit status field.
  if (!sale || (sale.status && sale.status !== 'COMPLETED')) return { face: 0, count: 0, commission: 0, month: null };
  const face = saleFaceValue(sale);
  // العمولة الخادمية (لقطة وقت البيع) تُجمَّع أيضاً (قرار ي3).
  const commission = numeric(sale.commissionRiyal ?? sale.commissionMinor ?? sale.commission ?? sale.commissionAmount);
  return { face, count: 1, commission, month: monthKey(sale.createdAt) };
}
function hasSameSaleAggregateContribution(before, after) {
  const oldPart = saleContribution(before);
  const newPart = saleContribution(after);
  return oldPart.face === newPart.face
    && oldPart.count === newPart.count
    && oldPart.commission === newPart.commission
    && oldPart.month === newPart.month;
}
function applySaleDelta(summary, before, after) {
  const next = { ...summary, monthly: { ...(summary.monthly || {}) } };
  const oldPart = saleContribution(before);
  const newPart = saleContribution(after);
  next.totalFaceValue = numeric(summary.totalFaceValue) - oldPart.face + newPart.face;
  next.totalTransactions = numeric(summary.totalTransactions) - oldPart.count + newPart.count;
  next.totalCommissionDue = numeric(summary.totalCommissionDue) - oldPart.commission + newPart.commission;
  [oldPart, newPart].forEach((part, index) => {
    if (!part.month) return;
    const sign = index === 0 ? -1 : 1;
    const bucket = next.monthly[part.month] || { face: 0, count: 0 };
    bucket.face = numeric(bucket.face) + sign * part.face;
    bucket.count = numeric(bucket.count) + sign * part.count;
    if (bucket.count <= 0 && bucket.face <= 0) delete next.monthly[part.month];
    else next.monthly[part.month] = bucket;
  });
  return next;
}
const PROCESSED_AGGREGATE_EVENT_COLLECTIONS = {
  sale: 'processed_sale_aggregate_events',
  payment: 'processed_payment_aggregate_events',
};
const EMPTY_AGGREGATE = { totalFaceValue: 0, totalTransactions: 0, totalCommissionDue: 0, totalPaid: 0, monthly: {} };

function hashEventId(eventId) {
  return crypto.createHash('sha256').update(String(eventId)).digest('hex');
}

/**
 * Idempotency marker and aggregate are committed in one Firestore transaction.
 * Sale and payment markers intentionally live in different collections: an event
 * id collision across trigger types must not suppress the other trigger.
 */
async function updateAggregateForEvent({ firestore = db, fieldValue = FieldValue, uid, eventType, eventId, updater, now = Date.now() }) {
  if (!eventId) throw new Error(`Missing event id for ${eventType} aggregate update`);
  const processedCollection = PROCESSED_AGGREGATE_EVENT_COLLECTIONS[eventType];
  if (!processedCollection) throw new Error(`Unknown aggregate event type: ${eventType}`);
  const aggregateRef = firestore.collection('admin_aggregates').doc(uid);
  const processedRef = firestore.collection(processedCollection).doc(hashEventId(eventId));
  const updatedAtMs = now;

  return firestore.runTransaction(async (transaction) => {
    const processedSnap = await transaction.get(processedRef);
    if (processedSnap.exists) return false;
    const aggregateSnap = await transaction.get(aggregateRef);
    const current = aggregateSnap.exists ? aggregateSnap.data() : EMPTY_AGGREGATE;
    const nextSummary = await updater(current, transaction, firestore);
    transaction.set(aggregateRef, {
      ...nextSummary,
      updatedAt: fieldValue.serverTimestamp(),
      updatedAtMs,
    }, { merge: true });
    transaction.set(processedRef, {
      eventId: String(eventId),
      eventType,
      uid,
      processedAt: fieldValue.serverTimestamp(),
    }, { merge: false });
    return true;
  });
}
/**
 * Firestore trigger path IDs are network IDs, not necessarily user UIDs.
 * Admin screens read admin_aggregates/{userUid}; resolving owner_uid here keeps
 * sales and payment events in that same canonical document.
 */
async function resolveAggregateOwnerUid(networkId, firestore = db) {
  const networkSnapshot = await firestore.collection('networks').doc(networkId).get();
  const ownerUid = networkSnapshot.exists ? networkSnapshot.data()?.owner_uid : null;
  if (typeof ownerUid === 'string' && ownerUid.trim()) return ownerUid.trim();

  // Legacy networks use the user's UID as their network document ID.
  const directUser = await firestore.collection('users').doc(networkId).get();
  if (directUser.exists) return networkId;

  // A few transitional records may have a networkId on the user but no
  // owner_uid yet. Resolve only an unambiguous single owner; never guess.
  const matches = await firestore.collection('users')
    .where('networkId', '==', networkId)
    .limit(2)
    .get();
  if (matches.docs.length === 1) return matches.docs[0].id;
  if (matches.docs.length > 1) throw new Error('ambiguous_network_owner');
  throw new Error('network_owner_unresolved');
}

exports.updateSaleAggregate = onDocumentWritten('networks/{networkId}/sales/{saleId}', async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  // Android currently upserts every completed local sale on session start.
  // Ignore writes whose financial contribution is unchanged before reading any
  // rate/aggregate documents or creating an event marker.
  if ((!before && !after) || hasSameSaleAggregateContribution(before, after)) return;
  const ownerUid = await resolveAggregateOwnerUid(event.params.networkId);
  await updateAggregateForEvent({
    uid: ownerUid,
    eventType: 'sale',
    eventId: event.id,
    updater: (summary) => applySaleDelta(summary, before, after),
  });
});
exports.updatePaymentAggregate = onDocumentWritten('networks/{networkId}/payments/{paymentId}', async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  const delta = numeric(after?.amount) - numeric(before?.amount);
  if (delta === 0) return;
  const ownerUid = await resolveAggregateOwnerUid(event.params.networkId);
  await updateAggregateForEvent({
    uid: ownerUid,
    eventType: 'payment',
    eventId: event.id,
    updater: (summary) => ({ ...summary, totalPaid: numeric(summary.totalPaid) + delta }),
  });
});

// No aggregate backfill callable is exposed until a source-version-aware,
// restartable migration and the owner-approved financial policy are specified.

// Test seam: production handlers above continue to use the initialized db.
exports.__test = {
  applySaleDelta,
  buildDeliveryRecord,
  saleContribution,
  claimDispatchRequest,
  chunksOf,
  hasSameSaleAggregateContribution,
  resolveAggregateOwnerUid,
  sendTokensInBatches,
  updateAggregateForEvent,
  millis,
  PROCESSED_AGGREGATE_EVENT_COLLECTIONS,
  schedulePreFcmRetry,
};
