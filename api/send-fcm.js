// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/send-fcm — إرسال إشعارات FCM من لوحة التحكم
// ------------------------------------------------------------
// يتطلب متغير البيئة: FIREBASE_SERVICE_ACCOUNT
//   القيمة: محتوى ملف Service Account JSON كاملاً،
//   أو صيغة base64 للنص نفسه (كلتاهما مدعومتان).
// لا يوضع المفتاح في الكود أو في GitHub إطلاقاً.
//
// إصلاح ERR_REQUIRE_ESM: في package.json يوجد
//   "overrides": { "jose": "4.15.9" }
// لأن jwks-rsa (داخل firebase-admin) يستدعي require(jose)
// و jose@5 ESM فقط.
// ============================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const DEFAULT_TOPIC = process.env.FCM_DEFAULT_TOPIC || 'krotak_all_users';
const ANDROID_CHANNEL_ID = process.env.FCM_ANDROID_CHANNEL_ID || 'krotak_admin_v2';

function ensureInitialized() {
  if (getApps().length > 0) return { ok: true };

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return { ok: false, error: 'server_not_configured' };

  let text = raw.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return { ok: false, error: 'invalid_service_account' };
    }
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_service_account' };
  }

  try {
    initializeApp({ credential: cert(serviceAccount) });
  } catch {
    return { ok: false, error: 'invalid_service_account' };
  }
  return { ok: true };
}

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
  onAttempt = () => {},
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  maxAttempts = 3,
}) {
  let sent = 0;
  let failed = 0;
  const invalidDeviceDocIds = new Set();
  for (const batch of chunksOf(tokens, FCM_BATCH_SIZE)) {
    let pendingTokens = batch;
    for (let attempt = 1; pendingTokens.length && attempt <= maxAttempts; attempt += 1) {
      onAttempt();
      const result = await sendEachForMulticast({ ...message, tokens: pendingTokens });
      const responses = result?.responses;
      const responseSuccesses = Array.isArray(responses) ? responses.filter((response) => response?.success === true).length : -1;
      const responseFailures = Array.isArray(responses) ? responses.filter((response) => response?.success === false).length : -1;
      const malformed = !Array.isArray(responses)
        || responses.length !== pendingTokens.length
        || !Number.isInteger(result.successCount)
        || !Number.isInteger(result.failureCount)
        || result.successCount + result.failureCount !== pendingTokens.length
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
        if (response?.success) {
          sent += 1;
          return;
        }
        const code = response?.error?.code;
        if (INVALID_FCM_TOKEN_CODES.has(code)) {
          failed += 1;
          (tokenDocIds.get(pendingTokens[index]) || []).forEach((docId) => invalidDeviceDocIds.add(docId));
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

async function deleteInvalidDeviceDocs(uid, docIds) {
  const devices = getFirestore().collection('users').doc(uid).collection('devices');
  for (const idBatch of chunksOf(docIds, FCM_DELETE_BATCH_SIZE)) {
    const batch = getFirestore().batch();
    idBatch.forEach((id) => batch.delete(devices.doc(id)));
    await batch.commit();
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureInitialized();
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

  try {
    const adminSnap = await getFirestore().collection('Admins').doc(callerUid).get();
    const adminData = adminSnap.exists ? adminSnap.data() : null;
    if (!adminData || adminData.uid !== callerUid) {
      return res.status(403).json({ success: false, error: 'not_admin' });
    }
  } catch (error) {
    console.error('send-fcm: admin check failed', error);
    return res.status(500).json({ success: false, error: 'admin_check_failed' });
  }

  const body = normalizeBody(req.body);
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
      const devicesSnap = await getFirestore()
        .collection('users')
        .doc(targetUid)
        .collection('devices')
        .get();
      const tokenDocIds = new Map();
      devicesSnap.docs.forEach((deviceDoc) => {
        const token = String(deviceDoc.data()?.token || '').trim();
        if (!token) return;
        const docIds = tokenDocIds.get(token) || [];
        docIds.push(deviceDoc.id);
        tokenDocIds.set(token, docIds);
      });
      const tokens = [...tokenDocIds.keys()];

      if (tokens.length === 0) {
        return res.status(200).json({
          success: false,
          error: 'no_devices',
          target: `user:${targetUid}`,
        });
      }

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
        try {
          await deleteInvalidDeviceDocs(targetUid, result.invalidDeviceDocIds);
        } catch (cleanupError) {
          console.error('send-fcm: invalid token cleanup failed', cleanupError);
        }
      }
      target = `user:${targetUid}`;
    } else {
      sendAttempted = true;
      await getMessaging().send({
        topic,
        notification: { title, body: text },
        data,
        android: androidConfig,
      });
      sent = 1;
      target = `topic:${topic}`;
    }

    try {
      await getFirestore().collection('notification_deliveries').add({
        title,
        body: text,
        target,
        sent,
        failed,
        createdBy: callerUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (logError) {
      console.error('send-fcm: delivery log failed', logError);
    }

    const success = failed === 0 && sent > 0;
    return res.status(200).json({
      success,
      partial: sent > 0 && failed > 0,
      error: success ? undefined : (sent > 0 ? 'partial_delivery' : 'delivery_failed'),
      target,
      sent,
      failed,
    });
  } catch (error) {
    console.error('send-fcm: send failed', error);
    if (sendAttempted) {
      const uncertainTarget = targetUid ? `user:${targetUid}` : `topic:${topic}`;
      try {
        await getFirestore().collection('notification_deliveries').add({
          title,
          body: text,
          target: uncertainTarget,
          status: 'delivery_uncertain',
          error: 'fcm_outcome_uncertain',
          createdBy: callerUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (logError) {
        console.error('send-fcm: uncertain delivery log failed', logError);
      }
      return res.status(202).json({
        success: false,
        status: 'delivery_uncertain',
        error: 'delivery_uncertain',
        target: uncertainTarget,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'send_failed',
      detail: String(error?.message || error),
    });
  }
}
