// ============================================================
// Krotak Pro — Vercel Serverless Function
// GET/POST /api/dispatch-notifications — إرسال الإشعارات المجدولة
// ------------------------------------------------------------
// بديل مجاني (باقة Spark / Vercel Hobby) لوظيفة Cloud Functions
// `dispatchScheduledNotifications` التي تتطلب باقة Blaze.
//
// Vercel Cron اليومي يشغّل أولاً فحص الاشتراكات المنتهية (LOCKED_EXPIRED)،
// ثم يلتقط الطلبات في `notification_requests` بحالة `scheduled` التي حان
// وقتها ويرسلها عبر FCM، ثم يحدّث الحالة إلى sent/partial/no_devices.
// كما يستعيد الطلبات العالقة بحالة `processing` إذا انتهت مدة الاستئجار.
//
// يتطلب متغير البيئة: FIREBASE_SERVICE_ACCOUNT (نفس إعداد send-fcm).
// الحماية: متغير CRON_SECRET؛ إن كان مضبوطاً فيجب إرساله في هيدر
//   Authorization: Bearer <CRON_SECRET>
//   (Vercel Cron يرسله تلقائياً عند ضبطه).
// يقبل أيضاً استدعاء مدير موثّق (Bearer ID token) لإرسال الإشعارات فقط؛
// فحص انتهاء الاشتراكات لا يعمل إلا عند مطابقة CRON_SECRET.
// ============================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { timingSafeEqual } from 'node:crypto';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { sendTokensInBatches } from './send-fcm.js';
import { expireOverdueSubscriptions } from '../server/_lib/subscriptionExpiry.js';
import { getAppFirestore, isAdminUid } from '../server/_lib/firebaseAdmin.js';

const DEFAULT_TOPIC = process.env.FCM_DEFAULT_TOPIC || 'krotak_all_users';
const ANDROID_CHANNEL_ID = process.env.FCM_ANDROID_CHANNEL_ID || 'krotak_admin_v2';
const DISPATCH_LEASE_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 25;
const TERMINAL_STATUSES = new Set(['sent', 'partial', 'no_devices', 'rejected', 'failed', 'delivery_uncertain']);

export function isCronSecret(token, secret = process.env.CRON_SECRET) {
  if (typeof token !== 'string' || !token || typeof secret !== 'string' || !secret) return false;
  const tokenBytes = Buffer.from(token, 'utf8');
  const secretBytes = Buffer.from(secret, 'utf8');
  return tokenBytes.length === secretBytes.length && timingSafeEqual(tokenBytes, secretBytes);
}

function ensureInitialized() {
  if (getApps().length > 0) return { ok: true };
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return { ok: false, error: 'server_not_configured' };
  let text = raw.trim();
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { return { ok: false, error: 'invalid_service_account' }; }
  }
  let serviceAccount;
  try { serviceAccount = JSON.parse(text); } catch { return { ok: false, error: 'invalid_service_account' }; }
  try { initializeApp({ credential: cert(serviceAccount) }); } catch { return { ok: false, error: 'invalid_service_account' }; }
  return { ok: true };
}

function millis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function stringifyData(data) {
  if (!data || typeof data !== 'object') return {};
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

/** Claims a due request before any FCM call; only a stale processing lease is recoverable. */
async function claim(db, snapshot, now) {
  return db.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(snapshot.ref);
    if (!currentSnap.exists) return null;
    const request = currentSnap.data() || {};
    const status = String(request.status || '');
    if (TERMINAL_STATUSES.has(status)) return null;
    if ((Number(request.scheduledAt) || 0) > now) return null;
    if (status === 'processing' && millis(request.dispatchLeaseUntil) > now) return null;
    const claimId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    transaction.update(snapshot.ref, {
      status: 'processing',
      dispatchClaimId: claimId,
      dispatchAttempt: (Number(request.dispatchAttempt) || 0) + 1,
      dispatchLeaseUntil: now + DISPATCH_LEASE_MS,
    });
    return { claimId, request };
  });
}

async function finalize(db, ref, claimId, patch, delivery, inbox = null) {
  return db.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(ref);
    const current = currentSnap.exists ? currentSnap.data() || {} : {};
    if (!currentSnap.exists || current.dispatchClaimId !== claimId || current.status !== 'processing') return false;
    transaction.update(ref, { ...patch, dispatchLeaseUntil: null, updatedAt: FieldValue.serverTimestamp() });
    if (delivery) transaction.set(db.collection('notification_deliveries').doc(ref.id), delivery, { merge: true });
    if (inbox) {
      transaction.set(
        db.collection('users').doc(inbox.uid).collection('notifications').doc(ref.id),
        inbox.data,
        { merge: true },
      );
    }
    return true;
  });
}

/** Sends one request and records the result. Shared by the endpoint and the daily cron. */
async function dispatchOne(db, messaging, snapshot, now) {
  const initial = snapshot.data();
  if (!initial) return;
  const title = String(initial.title || '').trim();
  const body = String(initial.body || initial.message || '').trim();
  if (!title || !body) {
    await snapshot.ref.update({ status: 'rejected', error: 'title_and_body_required' });
    return;
  }

  const claimed = await claim(db, snapshot, now);
  if (!claimed) return;
  const { claimId, request } = claimed;
  const requestId = snapshot.id;
  const data = { ...stringifyData(request.data), requestId, type: String(request.type || 'admin') };

  try {
    if (request.audienceType === 'user' && request.targetUid) {
      const devices = await db.collection('users').doc(request.targetUid).collection('devices').get();
      const tokenDocIds = new Map();
      devices.docs.forEach((deviceDoc) => {
        const token = String(deviceDoc.data()?.token || '').trim();
        if (!token) return;
        const ids = tokenDocIds.get(token) || [];
        ids.push(deviceDoc.id);
        tokenDocIds.set(token, ids);
      });
      const tokens = [...tokenDocIds.keys()];
      if (!tokens.length) {
        await finalize(db, snapshot.ref, claimId, { status: 'no_devices', completedAt: FieldValue.serverTimestamp() });
        return;
      }
      const result = await sendTokensInBatches({
        tokens,
        tokenDocIds,
        sendEachForMulticast: (message) => messaging.sendEachForMulticast(message),
        message: {
          notification: { title, body },
          data,
          android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
        },
      });
      await finalize(db, snapshot.ref, claimId, {
        status: result.failed ? 'partial' : 'sent',
        target: `user:${request.targetUid}`,
        sent: result.sent,
        failed: result.failed,
        completedAt: FieldValue.serverTimestamp(),
      }, {
        requestId, title, body, target: `user:${request.targetUid}`,
        audienceType: 'user', targetUid: request.targetUid,
        sent: result.sent, failed: result.failed, createdAt: FieldValue.serverTimestamp(),
      }, result.sent > 0 ? {
        uid: request.targetUid,
        data: {
          title,
          message: body,
          timestamp: FieldValue.serverTimestamp(),
          is_read: false,
          is_global: false,
          audienceType: 'user',
        },
      } : null);

      return;
    }

    await messaging.send({
      topic: DEFAULT_TOPIC,
      notification: { title, body },
      data,
      android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
    });
    await finalize(db, snapshot.ref, claimId, {
      status: 'sent',
      target: `topic:${DEFAULT_TOPIC}`,
      sent: 1,
      failed: 0,
      completedAt: FieldValue.serverTimestamp(),
    }, {
      requestId, title, body, target: `topic:${DEFAULT_TOPIC}`,
      audienceType: 'global',
      sent: 1, failed: 0, createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // No FCM exactly-once: a failed outcome crossed the send boundary is terminal.
    await finalize(db, snapshot.ref, claimId, {
      status: 'delivery_uncertain',
      error: 'fcm_outcome_uncertain',
      errorDetail: String(error?.message || error),
    });
    throw error;
  }
}

export async function processDueNotifications(db, messaging, now = Date.now()) {
  const due = await db.collection('notification_requests')
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', now)
    .limit(BATCH_LIMIT)
    .get();
  const processing = await db.collection('notification_requests')
    .where('status', '==', 'processing')
    .get();
  const staleProcessing = processing.docs
    .filter((doc) => millis(doc.data()?.dispatchLeaseUntil) <= now)
    .slice(0, BATCH_LIMIT);

  const candidates = [...due.docs, ...staleProcessing];
  let processed = 0;
  let failed = 0;
  for (const doc of candidates) {
    try {
      await dispatchOne(db, messaging, doc, now);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error('dispatch-notifications: request failed', doc.id, error);
    }
  }
  return { processed, failed, candidates: candidates.length };
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureInitialized();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const isCronRequest = isCronSecret(token);

  if (!isCronRequest) {
    // Admins can still dispatch manually even when CRON_SECRET is configured.
    if (!token) return res.status(401).json({ success: false, error: 'missing_token' });
    try {
      const decoded = await getAuth().verifyIdToken(token);
      const isAdmin = await isAdminUid(decoded.uid, () => getAppFirestore());
      if (!isAdmin) {
        return res.status(403).json({ success: false, error: 'not_admin' });
      }
    } catch (error) {
      if (error?.code === 'auth/argument-error' || error?.code === 'auth/id-token-expired' || error?.code === 'auth/id-token-revoked') {
        return res.status(401).json({ success: false, error: 'invalid_token' });
      }
      console.error('dispatch-notifications: auth check failed', error);
      return res.status(500).json({ success: false, error: 'admin_check_failed' });
    }
  }

  const db = getAppFirestore();
  let subscriptionExpiry = null;
  let dispatchResult = null;
  let expiryFailed = false;
  let dispatchFailed = false;

  // Only Vercel's CRON_SECRET can trigger the expiry sweep; opening the
  // notifications page as an admin remains a dispatch-only operation.
  if (isCronRequest) {
    try {
      subscriptionExpiry = await expireOverdueSubscriptions(db);
    } catch (error) {
      expiryFailed = true;
      console.error('dispatch-notifications: subscription expiry failed', error);
    }
  }

  try {
    dispatchResult = await processDueNotifications(db, getMessaging());
  } catch (error) {
    dispatchFailed = true;
    console.error('dispatch-notifications: dispatch loop failed', error);
  }

  const success = !expiryFailed && !dispatchFailed;
  return res.status(success ? 200 : 500).json({
    success,
    ...(dispatchResult || {}),
    ...(isCronRequest ? { subscriptionExpiry: subscriptionExpiry || { status: 'failed' } } : {}),
    ...(!success ? { error: expiryFailed ? 'subscription_expiry_failed' : 'dispatch_failed' } : {}),
  });
}
