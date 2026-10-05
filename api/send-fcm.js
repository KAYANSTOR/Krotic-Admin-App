// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/send-fcm — إرسال إشعارات FCM من لوحة التحكم
// ------------------------------------------------------------
// يتطلب متغير البيئة: FIREBASE_SERVICE_ACCOUNT
//   القيمة: محتوى ملف Service Account JSON كاملاً،
//   أو صيغة base64 للنص نفسه (كلتاهما مدعومتان).
// لا يوضع المفتاح في الكود أو في GitHub إطلاقاً.
// ============================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const DEFAULT_TOPIC = process.env.FCM_DEFAULT_TOPIC || 'krotak_all_users';
const ANDROID_CHANNEL_ID = process.env.FCM_ANDROID_CHANNEL_ID || 'krotak_admin';

// ---------- تهيئة Firebase Admin (مرة واحدة لكل نسخة دالة) ----------
function ensureInitialized() {
  if (getApps().length > 0) return { ok: true };

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return { ok: false, error: 'server_not_configured' };

  let text = raw.trim();
  if (!text.startsWith('{')) {
    // دعم صيغة base64 أيضاً
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureInitialized();
  if (!init.ok) {
    return res.status(503).json({ success: false, error: init.error });
  }

  // ---------- 1) التحقق من هوية المدير ----------
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

  // ---------- 2) قراءة الطلب ----------
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

  // ---------- 3) الإرسال عبر FCM ----------
  try {
    let sent = 0;
    let failed = 0;
    let target;

    if (targetUid) {
      // مستخدم محدد: إرسال إلى كل أجهزته المسجلة في users/{uid}/devices
      const devicesSnap = await getFirestore()
        .collection('users')
        .doc(targetUid)
        .collection('devices')
        .get();
      const tokens = devicesSnap.docs
        .map((deviceDoc) => deviceDoc.data()?.token)
        .filter(Boolean);

      if (tokens.length === 0) {
        return res.status(200).json({
          success: false,
          error: 'no_devices',
          target: `user:${targetUid}`,
        });
      }

      const multicast = await getMessaging().sendEachForMulticast({
        tokens: tokens.slice(0, 500),
        notification: { title, body: text },
        data,
        android: {
          priority: 'high',
          notification: { channelId: ANDROID_CHANNEL_ID },
        },
      });
      sent = multicast.successCount;
      failed = multicast.failureCount;
      target = `user:${targetUid}`;
    } else {
      // إشعار عام: يُرسل إلى قناة (Topic) يشترك بها جميع الأجهزة
      await getMessaging().send({
        topic,
        notification: { title, body: text },
        data,
        android: {
          priority: 'high',
          notification: { channelId: ANDROID_CHANNEL_ID },
        },
      });
      sent = 1;
      target = `topic:${topic}`;
    }

    // ---------- 4) تسجيل العملية في سجل التدقيق ----------
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

    return res.status(200).json({ success: true, target, sent, failed });
  } catch (error) {
    console.error('send-fcm: send failed', error);
    return res.status(500).json({
      success: false,
      error: 'send_failed',
      detail: String(error?.message || error),
    });
  }
}
