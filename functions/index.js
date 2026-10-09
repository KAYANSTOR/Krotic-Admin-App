const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
