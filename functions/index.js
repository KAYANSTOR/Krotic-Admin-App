const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

exports.dispatchNotificationRequest = onDocumentCreated(
  'notification_requests/{requestId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const request = snapshot.data();
    const requestId = event.params.requestId;
    const title = String(request.title || '').trim();
    const body = String(request.body || request.message || '').trim();
    if (!title || !body) {
      await snapshot.ref.update({ status: 'rejected', error: 'title_and_body_required' });
      return;
    }

    const base = { title, body, requestId, type: String(request.type || 'admin') };
    let message;
    let targetDescription = 'topic:krotak_all_users';
    if (request.audienceType === 'user' && request.targetUid) {
      const devices = await db.collection('users').doc(request.targetUid).collection('devices').get();
      const tokens = devices.docs.map((doc) => doc.data().token).filter(Boolean);
      if (!tokens.length) {
        await snapshot.ref.update({ status: 'no_devices', completedAt: FieldValue.serverTimestamp() });
        return;
      }
      message = { tokens: tokens.slice(0, 500), notification: { title, body }, data: stringifyData(request.data), android: { priority: 'high', notification: { channelId: 'krotak_admin' } } };
      targetDescription = `user:${request.targetUid}`;
    } else {
      message = { topic: 'krotak_all_users', notification: { title, body }, data: stringifyData(request.data), android: { priority: 'high', notification: { channelId: 'krotak_admin' } } };
    }

    try {
      const result = message.tokens ? await getMessaging().sendEachForMulticast(message) : await getMessaging().send(message);
      const sent = message.tokens ? result.successCount : 1;
      const failed = message.tokens ? result.failureCount : 0;
      await snapshot.ref.update({ status: failed ? 'partial' : 'sent', target: targetDescription, sent, failed, completedAt: FieldValue.serverTimestamp() });
      await db.collection('notification_deliveries').doc(requestId).set({ requestId, target: targetDescription, sent, failed, createdAt: FieldValue.serverTimestamp() });
      if (message.tokens && result.responses) {
        const batch = db.batch();
        result.responses.forEach((response, index) => {
          if (!response.success && response.error?.code === 'messaging/registration-token-not-registered') {
            batch.delete(db.collection('users').doc(request.targetUid).collection('devices').doc(hashToken(message.tokens[index])));
          }
        });
        await batch.commit();
      }
    } catch (error) {
      await snapshot.ref.update({ status: 'failed', error: String(error.message || error), completedAt: FieldValue.serverTimestamp() });
      throw error;
    }
  },
);

function stringifyData(data) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]));
}
function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}
