const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

const DEFAULT_TOPIC = 'krotak_all_users';
const ANDROID_CHANNEL_ID = 'krotak_admin';

function stringifyData(data) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]));
}

function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/**
 * ينفّذ طلب إشعار واحد ويسجّل النتيجة. مشترك بين الإرسال الفوري والمُجدوَل.
 */
async function dispatchRequest(snapshot) {
  const request = snapshot.data();
  if (!request) return;
  const requestId = snapshot.id;
  const title = String(request.title || '').trim();
  const body = String(request.body || request.message || '').trim();

  if (!title || !body) {
    await snapshot.ref.update({ status: 'rejected', error: 'title_and_body_required' });
    return;
  }

  // طلب مجدول لم يحن وقته بعد: يُترك بحالة scheduled ليلتقطه المُجدوِل.
  const scheduledAt = Number(request.scheduledAt) || 0;
  if (scheduledAt > Date.now()) {
    await snapshot.ref.update({ status: 'scheduled' });
    return;
  }

  const base = { title, body, requestId, type: String(request.type || 'admin') };
  let message;
  let targetDescription = `topic:${DEFAULT_TOPIC}`;

  if (request.audienceType === 'user' && request.targetUid) {
    const devices = await db.collection('users').doc(request.targetUid).collection('devices').get();
    const tokens = devices.docs.map((doc) => doc.data().token).filter(Boolean);
    if (!tokens.length) {
      await snapshot.ref.update({ status: 'no_devices', completedAt: FieldValue.serverTimestamp() });
      return;
    }
    message = {
      tokens: tokens.slice(0, 500),
      notification: { title, body },
      data: stringifyData(request.data),
      android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
    };
    targetDescription = `user:${request.targetUid}`;
  } else {
    message = {
      topic: DEFAULT_TOPIC,
      notification: { title, body },
      data: stringifyData(request.data),
      android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
    };
  }

  try {
    const result = message.tokens
      ? await getMessaging().sendEachForMulticast(message)
      : await getMessaging().send(message);
    const sent = message.tokens ? result.successCount : 1;
    const failed = message.tokens ? result.failureCount : 0;

    await snapshot.ref.update({
      status: failed ? 'partial' : 'sent',
      target: targetDescription,
      sent,
      failed,
      completedAt: FieldValue.serverTimestamp(),
    });

    await db.collection('notification_deliveries').doc(requestId).set({
      requestId,
      title,
      body,
      target: targetDescription,
      sent,
      failed,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (message.tokens && result.responses) {
      const batch = db.batch();
      result.responses.forEach((response, index) => {
        if (!response.success && response.error?.code === 'messaging/registration-token-not-registered') {
          batch.delete(
            db.collection('users').doc(request.targetUid).collection('devices').doc(hashToken(message.tokens[index]))
          );
        }
      });
      await batch.commit();
    }
  } catch (error) {
    await snapshot.ref.update({
      status: 'failed',
      error: String(error.message || error),
      completedAt: FieldValue.serverTimestamp(),
    });
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

// المُجدوِل: يلتقط الطلبات المجدولة التي حان وقتها كل 5 دقائق.
exports.dispatchScheduledNotifications = onSchedule('every 5 minutes', async () => {
  const now = Date.now();
  const due = await db
    .collection('notification_requests')
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', now)
    .limit(25)
    .get();

  if (due.empty) return;

  for (const doc of due.docs) {
    try {
      await dispatchRequest(doc);
    } catch (error) {
      console.error('dispatchScheduledNotifications failed', doc.id, error);
    }
  }
});

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
function saleContribution(sale, commissionRate) {
  if (!sale || sale.status !== 'COMPLETED') return { face: 0, earnings: 0, count: 0, month: null };
  const face = numeric(sale.faceValue);
  return { face, earnings: face * (numeric(commissionRate) / 100), count: 1, month: monthKey(sale.createdAt) };
}
function applySaleDelta(summary, before, after, commissionRate) {
  const next = { ...summary, monthly: { ...(summary.monthly || {}) } };
  const oldPart = saleContribution(before, commissionRate);
  const newPart = saleContribution(after, commissionRate);
  next.totalFaceValue = numeric(summary.totalFaceValue) - oldPart.face + newPart.face;
  next.totalAdminEarnings = numeric(summary.totalAdminEarnings) - oldPart.earnings + newPart.earnings;
  next.totalTransactions = numeric(summary.totalTransactions) - oldPart.count + newPart.count;
  [oldPart, newPart].forEach((part, index) => {
    if (!part.month) return;
    const sign = index === 0 ? -1 : 1;
    const bucket = next.monthly[part.month] || { face: 0, earnings: 0, count: 0 };
    bucket.face = numeric(bucket.face) + sign * part.face;
    bucket.earnings = numeric(bucket.earnings) + sign * part.earnings;
    bucket.count = numeric(bucket.count) + sign * part.count;
    if (bucket.count <= 0 && bucket.face <= 0) delete next.monthly[part.month];
    else next.monthly[part.month] = bucket;
  });
  return next;
}
async function commissionRateFor(uid) {
  const [user, settings] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('app_settings').doc('global_config').get(),
  ]);
  const userRate = user.exists ? numeric(user.data().commission_rate) : 0;
  const globalRate = settings.exists ? numeric(settings.data().default_commission_rate) : 5;
  return userRate > 0 ? userRate : (globalRate || 5);
}
async function updateAggregate(uid, updater) {
  const ref = db.collection('admin_aggregates').doc(uid);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? snap.data() : { totalFaceValue: 0, totalAdminEarnings: 0, totalTransactions: 0, totalPaid: 0, monthly: {} };
    transaction.set(ref, { ...updater(current), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
exports.updateSaleAggregate = onDocumentWritten('networks/{uid}/sales/{saleId}', async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!before && !after) return;
  const rate = await commissionRateFor(event.params.uid);
  await updateAggregate(event.params.uid, (summary) => applySaleDelta(summary, before, after, rate));
});
exports.updatePaymentAggregate = onDocumentWritten('networks/{uid}/payments/{paymentId}', async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  const delta = numeric(after?.amount) - numeric(before?.amount);
  if (delta) await updateAggregate(event.params.uid, (summary) => ({ ...summary, totalPaid: numeric(summary.totalPaid) + delta }));
});

async function rebuildAggregate(uid) {
  const [userSnap, settingsSnap, salesSnap, paymentsSnap] = await Promise.all([
    db.collection('users').doc(uid).get(), db.collection('app_settings').doc('global_config').get(),
    db.collection('networks').doc(uid).collection('sales').get(), db.collection('networks').doc(uid).collection('payments').get(),
  ]);
  const userRate = userSnap.exists ? numeric(userSnap.data().commission_rate) : 0;
  const globalRate = settingsSnap.exists ? numeric(settingsSnap.data().default_commission_rate) : 5;
  const rate = userRate > 0 ? userRate : (globalRate || 5);
  const summary = { totalFaceValue: 0, totalAdminEarnings: 0, totalTransactions: 0, totalPaid: 0, monthly: {} };
  salesSnap.forEach((sale) => {
    const part = saleContribution(sale.data(), rate); summary.totalFaceValue += part.face; summary.totalAdminEarnings += part.earnings; summary.totalTransactions += part.count;
    if (part.month) { const bucket = summary.monthly[part.month] || { face: 0, earnings: 0, count: 0 }; bucket.face += part.face; bucket.earnings += part.earnings; bucket.count += part.count; summary.monthly[part.month] = bucket; }
  });
  paymentsSnap.forEach((payment) => { summary.totalPaid += numeric(payment.data().amount); });
  await db.collection('admin_aggregates').doc(uid).set({ ...summary, rebuiltAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
exports.refreshAggregateOnUserChange = onDocumentWritten('users/{uid}', async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : {};
  const after = event.data?.after.exists ? event.data.after.data() : {};
  if (numeric(before.commission_rate) !== numeric(after.commission_rate)) await rebuildAggregate(event.params.uid);
});
exports.rebuildAdminAggregates = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication is required.');
  const admin = await db.collection('Admins').doc(request.auth.uid).get();
  if (!admin.exists || admin.data().uid !== request.auth.uid) throw new HttpsError('permission-denied', 'Admin access is required.');
  const users = await db.collection('users').get();
  for (const user of users.docs) await rebuildAggregate(user.id);
  return { rebuilt: users.size };
});
