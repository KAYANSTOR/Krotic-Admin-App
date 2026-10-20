// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/send-fcm — إرسال إشعارات FCM وحفظها في قاعدة البيانات والتطبيق
// ------------------------------------------------------------
// يتطلب متغير البيئة: FIREBASE_SERVICE_ACCOUNT
// لا يوضع المفتاح في الكود أو في GitHub إطلاقاً.
// ============================================================

import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  ensureFirebaseAdmin,
  getAppFirestore,
  isAdminUid,
} from '../server/_lib/firebaseAdmin.js';

const DEFAULT_TOPIC = process.env.FCM_DEFAULT_TOPIC || 'krotak_all_users';
const ANDROID_CHANNEL_ID = process.env.FCM_ANDROID_CHANNEL_ID || 'krotak_admin_v2';

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function stringifyData(data) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

const FCM_BATCH_SIZE = 500;
const FCM_DELETE_BATCH_SIZE = 450;
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

function chunksOf(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export async function sendTokensInBatches({
  tokens,
  tokenDocIds,
  message,
  sendEachForMulticast,
  onAttempt,
  maxAttempts = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let sent = 0;
  let failed = 0;
  const invalidDeviceDocIds = new Set();
  const tokenChunks = chunksOf(tokens, FCM_BATCH_SIZE);

  for (const chunk of tokenChunks) {
    let pendingTokens = chunk;
    for (let attempt = 1; attempt <= maxAttempts && pendingTokens.length > 0; attempt += 1) {
      if (onAttempt) onAttempt();
      const response = await sendEachForMulticast({ ...message, tokens: pendingTokens });
      const responses = response?.responses;
      const responseSuccesses = Array.isArray(responses) ? responses.filter((resp) => resp?.success === true).length : -1;
      const responseFailures = Array.isArray(responses) ? responses.filter((resp) => resp?.success === false).length : -1;
      const malformed = !Array.isArray(responses)
        || responses.length !== pendingTokens.length
        || !Number.isInteger(response.successCount)
        || !Number.isInteger(response.failureCount)
        || response.successCount + response.failureCount !== pendingTokens.length
        || response.successCount !== responseSuccesses
        || response.failureCount !== responseFailures
        || responses.some((resp) => !resp
          || typeof resp.success !== 'boolean'
          || (resp.success === false && typeof resp.error?.code !== 'string'));
      if (malformed) {
        throw new Error('fcm_malformed_multicast_response');
      }

      sent += response.successCount;
      const retryTokens = [];

      response.responses.forEach((resp, index) => {
        if (resp.success) return;
        const code = resp.error?.code;
        if (INVALID_FCM_TOKEN_CODES.has(code)) {
          failed += 1;
          const token = pendingTokens[index];
          const docIds = tokenDocIds.get(token) || [];
          docIds.forEach((id) => invalidDeviceDocIds.add(id));
        } else if (RETRYABLE_FCM_CODES.has(code) && attempt < maxAttempts) {
          retryTokens.push(pendingTokens[index]);
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

async function deleteInvalidDeviceDocs(db, uid, docIds) {
  const devices = db.collection('users').doc(uid).collection('devices');
  for (const idBatch of chunksOf(docIds, FCM_DELETE_BATCH_SIZE)) {
    const batch = db.batch();
    idBatch.forEach((id) => batch.delete(devices.doc(id)));
    await batch.commit();
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) {
    return res.status(503).json({ success: false, error: init.error });
  }

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return res.status(401).json({ success: false, error: 'missing_token' });
  }

  let callerUid;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }

  const db = getAppFirestore();

  try {
    const isAdmin = await isAdminUid(callerUid, () => db);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'not_admin' });
    }
  } catch (error) {
    console.error('send-fcm: admin check failed', error);
    return res.status(500).json({ success: false, error: 'admin_check_failed' });
  }

  const body = normalizeBody(req.body);

  // ACTION: DELETE NOTIFICATION FROM HISTORY
  if (body.action === 'delete') {
    const notifId = String(body.id || '').trim();
    if (!notifId) return res.status(400).json({ success: false, error: 'id_required' });
    try {
      const deliveryRef = db.collection('notification_deliveries').doc(notifId);
      const delivery = await deliveryRef.get();
      const batch = db.batch();
      batch.delete(deliveryRef);
      const targetUid = String(delivery.data()?.targetUid || '').trim();
      if (targetUid) {
        batch.delete(db.collection('users').doc(targetUid).collection('notifications').doc(notifId));
      }
      await batch.commit();
      return res.status(200).json({ success: true, deleted: notifId });
    } catch (err) {
      console.error('send-fcm: delete failed', err);
      return res.status(500).json({ success: false, error: 'delete_failed' });
    }
  }

  const title = String(body.title || '').trim();
  const text = String(body.body || body.message || '').trim();
  const targetUid = String(body.targetUid || '').trim();
  const topic = String(body.topic || '').trim() || DEFAULT_TOPIC;

  if (!title || !text) {
    return res.status(400).json({ success: false, error: 'title_and_body_required' });
  }

  const data = stringifyData(
    body.data || {
      route: '/account-notifications',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
  );

  let sendAttempted = false;
  try {
    let sent = 0;
    let failed = 0;
    let target;
    const nowMs = Date.now();

    const androidConfig = {
      priority: 'high',
      notification: {
        channelId: ANDROID_CHANNEL_ID,
        sound: 'krotak_notify',
        defaultSound: true,
        notificationCount: 1,
      },
    };

    if (targetUid) {
      // 1. SPECIFIC USER NOTIFICATION
      target = `user:${targetUid}`;

      // Check user device tokens for push notification
      const devicesSnap = await db
        .collection('users')
        .doc(targetUid)
        .collection('devices')
        .get()
        .catch(() => ({ docs: [] }));

      const tokenDocIds = new Map();
      devicesSnap.docs.forEach((deviceDoc) => {
        const token = String(deviceDoc.data()?.token || '').trim();
        if (!token) return;
        const docIds = tokenDocIds.get(token) || [];
        docIds.push(deviceDoc.id);
        tokenDocIds.set(token, docIds);
      });
      const tokens = [...tokenDocIds.keys()];

      if (tokens.length > 0) {
        const result = await sendTokensInBatches({
          tokens,
          tokenDocIds,
          sendEachForMulticast: (message) => getMessaging().sendEachForMulticast(message),
          onAttempt: () => { sendAttempted = true; },
          message: {
            notification: { title, body: text },
            data,
            android: androidConfig,
          },
        });
        sent = result.sent;
        failed = result.failed;
        if (result.invalidDeviceDocIds.length) {
          deleteInvalidDeviceDocs(db, targetUid, result.invalidDeviceDocIds).catch(() => null);
        }
      } else {
        sent = 0;
      }

      const historyRef = db.collection('notification_deliveries').doc();
      const historyDoc = {
        requestId: historyRef.id,
        title,
        body: text,
        message: text,
        target,
        targetUid,
        audienceType: 'user',
        sent,
        failed,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
        timestamp: nowMs,
        status: failed && !sent ? 'failed' : 'sent',
      };

      const batch = db.batch();
      batch.set(historyRef, historyDoc);
      if (sent > 0) {
        batch.set(
          db.collection('users').doc(targetUid).collection('notifications').doc(historyRef.id),
          {
            title,
            message: text,
            timestamp: nowMs,
            is_read: false,
            is_global: false,
            audienceType: 'user',
          },
        );
      }
      await batch.commit();

    } else {
      // 2. GLOBAL BROADCAST NOTIFICATION
      target = `topic:${topic}`;
      sendAttempted = true;

      await getMessaging().send({
        topic,
        notification: { title, body: text },
        data,
        android: androidConfig,
      });

      sent = 1;
      failed = 0;

      const historyDoc = {
        title,
        body: text,
        message: text,
        target,
        audienceType: 'global',
        sent: 1,
        failed: 0,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
        timestamp: nowMs,
        status: 'sent',
      };

      await db.collection('notification_deliveries').add(historyDoc);
    }

    return res.status(200).json({
      success: true,
      target,
      sent,
      failed,
    });
  } catch (error) {
    console.error('send-fcm: send failed', error);
    return res.status(500).json({
      success: false,
      error: 'send_failed',
      detail: String(error?.message || error),
    });
  }
}

