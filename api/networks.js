// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/networks — إدارة هوية الشبكة والوصول خادمياً (قرار المالك أ، ب)
// ------------------------------------------------------------
// كل الإجراءات تتطلب مديراً موثّقاً، وتكتب حقول الصلاحية الخادمية فقط
// (users/{uid} + networks/{networkId}) مع سجل تدقيق. العميل لا يكتبها أبداً.
//
//   action=provision      { ownerUid }                     → يخصّص NET-xxxxx ويمنح تجربة 30 يوماً
//   action=update-access  { uid, accessStatus?, subscriptionEndsAt?, commission_rate?, warning_message?, has_custom_warning? }
//   action=renew          { uid, extensionDays }           → تمديد يدوي (30 فقط)
//   action=batch-expiry   { subscriptionEndsAt }           → إجراء إداري قديم لتوحيد تاريخ الانتهاء؛ لا يُستدعى من Cron
//   Vercel Cron يفحص الاستحقاقات عبر api/_lib/subscriptionExpiry.js ولا يغيّر تواريخ الانتهاء.
//
// يتطلب FIREBASE_SERVICE_ACCOUNT.
// ============================================================

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from './_lib/firebaseAdmin.js';
import { nextNetworkSequence, formatNetworkId, parseNetworkId } from './_lib/networkId.js';
import { encryptNetworkSecret, generateNetworkSecret } from './_lib/networkSecret.js';
import { ensureNetworkSecret } from './_lib/networkSecretStore.js';

export const ACCESS_STATUSES = ['TRIAL', 'ACTIVE_PAID', 'SUSPENDED_GRACE', 'LOCKED_EXPIRED'];
export const TRIAL_DAYS = 30;
export const RENEWAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_WARNING = 500;
const BATCH_LIMIT = 450;

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

/** تاريخ الانتهاء بعد تمديد يدوي: يُضاف للتاريخ الحالي إن كان مستقبلاً، وإلا يبدأ من الآن. */
export function computeRenewalEnd(previousEndMs, now, extensionDays = RENEWAL_DAYS) {
  const base = Math.max(Number(previousEndMs) || 0, Number(now) || 0);
  return base + extensionDays * DAY_MS;
}

export function validateNetworkInput(body) {
  const input = normalizeBody(body);
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  if (!['provision', 'update-access', 'renew', 'batch-expiry'].includes(action)) {
    return { ok: false, error: 'unknown_action' };
  }

  if (action === 'provision') {
    const ownerUid = typeof input.ownerUid === 'string' ? input.ownerUid.trim() : '';
    if (!UID_PATTERN.test(ownerUid)) return { ok: false, error: 'owner_uid_invalid' };
    return { ok: true, value: { action, ownerUid } };
  }

  if (action === 'update-access') {
    const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
    if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
    const value = { action, uid };
    let provided = 0;
    if (input.accessStatus !== undefined) {
      if (!ACCESS_STATUSES.includes(input.accessStatus)) return { ok: false, error: 'access_status_invalid' };
      value.accessStatus = input.accessStatus; provided += 1;
    }
    if (input.subscriptionEndsAt !== undefined) {
      const ms = Number(input.subscriptionEndsAt);
      if (!Number.isFinite(ms) || ms <= 0) return { ok: false, error: 'subscription_end_invalid' };
      value.subscriptionEndsAtMs = ms; provided += 1;
    }
    if (input.commission_rate !== undefined) {
      const rate = Number(input.commission_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: 'commission_rate_invalid' };
      value.commissionRate = rate; provided += 1;
    }
    if (input.warning_message !== undefined) {
      if (typeof input.warning_message !== 'string' || input.warning_message.length > MAX_WARNING) {
        return { ok: false, error: 'warning_message_invalid' };
      }
      value.warningMessage = input.warning_message; provided += 1;
    }
    if (input.has_custom_warning !== undefined) {
      if (typeof input.has_custom_warning !== 'boolean') return { ok: false, error: 'has_custom_warning_invalid' };
      value.hasCustomWarning = input.has_custom_warning; provided += 1;
    }
    if (provided === 0) return { ok: false, error: 'no_fields' };
    return { ok: true, value };
  }

  if (action === 'renew') {
    const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
    if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
    const extensionDays = input.extensionDays === undefined ? RENEWAL_DAYS : Number(input.extensionDays);
    if (extensionDays !== RENEWAL_DAYS) return { ok: false, error: 'extension_days_invalid' };
    return { ok: true, value: { action, uid, extensionDays } };
  }

  const ms = Number(input.subscriptionEndsAt);
  if (!Number.isFinite(ms) || ms <= 0) return { ok: false, error: 'subscription_end_invalid' };
  return { ok: true, value: { action, subscriptionEndsAtMs: ms } };
}

function toMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function allocateNetworkId(db) {
  const counterRef = db.collection('counters').doc('networks');
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(counterRef);
    const last = snap.exists ? snap.data().lastNetworkId : null;
    const networkId = formatNetworkId(nextNetworkSequence(last));
    transaction.set(counterRef, { lastNetworkId: networkId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return networkId;
  });
}

async function audit(db, { action, actorUid, uid, details, now }) {
  await db.collection('admin_audit_logs').add({
    action,
    actorUid,
    targetType: 'network',
    targetId: uid || null,
    details: details || null,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
  });
}

async function provision(db, { ownerUid, actorUid, now }) {
  const userRef = db.collection('users').doc(ownerUid);
  const userSnap = await userRef.get();
  const existing = userSnap.exists ? userSnap.data() : null;
  const existingId = existing?.networkId;
  if (parseNetworkId(existingId)) {
    const existingNetworkRef = db.collection('networks').doc(existingId);
    const netSnap = await existingNetworkRef.get();
    if (netSnap.exists) {
      const { networkSecret } = await ensureNetworkSecret(db, existingNetworkRef);
      return { status: 'duplicate', networkId: existingId, networkSecret };
    }
  }

  const networkId = await allocateNetworkId(db);
  const trialStartedAt = now;
  const subscriptionEndsAt = now + TRIAL_DAYS * DAY_MS;
  const networkSecret = generateNetworkSecret();
  const networkSecretEncrypted = encryptNetworkSecret(networkSecret);
  const networkRef = db.collection('networks').doc(networkId);
  await db.runTransaction(async (transaction) => {
    transaction.set(networkRef, {
      networkId,
      owner_uid: ownerUid,
      accessStatus: 'TRIAL',
      trialStartedAt: Timestamp.fromMillis(trialStartedAt),
      subscriptionEndsAt: Timestamp.fromMillis(subscriptionEndsAt),
      networkSecretEncrypted,
      networkSecretVersion: 1,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
    }, { merge: false });
    transaction.set(userRef, {
      networkId,
      owner_uid: ownerUid,
      accessStatus: 'TRIAL',
      trialStartedAt: Timestamp.fromMillis(trialStartedAt),
      subscriptionEndsAt: Timestamp.fromMillis(subscriptionEndsAt),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await audit(db, { action: 'NETWORK_PROVISION', actorUid, uid: ownerUid, details: { networkId }, now });
  return { status: 'created', networkId, trialStartedAt, subscriptionEndsAt, networkSecret };
}

async function updateAccess(db, { value, actorUid, now }) {
  const patch = {};
  if (value.accessStatus !== undefined) patch.accessStatus = value.accessStatus;
  if (value.subscriptionEndsAtMs !== undefined) patch.subscriptionEndsAt = Timestamp.fromMillis(value.subscriptionEndsAtMs);
  if (value.commissionRate !== undefined) patch.commission_rate = value.commissionRate;
  if (value.warningMessage !== undefined) patch.warning_message = value.warningMessage;
  if (value.hasCustomWarning !== undefined) patch.has_custom_warning = value.hasCustomWarning;
  patch.updatedAt = FieldValue.serverTimestamp();

  const userRef = db.collection('users').doc(value.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { status: 'account_not_found' };
  await userRef.set(patch, { merge: true });

  const networkId = userSnap.data()?.networkId;
  if (parseNetworkId(networkId)) {
    await db.collection('networks').doc(networkId).set(patch, { merge: true });
  }
  await audit(db, { action: 'NETWORK_ACCESS_UPDATE', actorUid, uid: value.uid, details: patch, now });
  return { status: 'updated' };
}

async function renew(db, { value, actorUid, now }) {
  const userRef = db.collection('users').doc(value.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { status: 'account_not_found' };
  const user = userSnap.data() || {};
  const previousEnd = toMillis(user.subscriptionEndsAt ?? user.subscription_end_date);
  const nextEnd = computeRenewalEnd(previousEnd, now, value.extensionDays);
  const patch = {
    accessStatus: 'ACTIVE_PAID',
    subscriptionEndsAt: Timestamp.fromMillis(nextEnd),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await userRef.set(patch, { merge: true });
  if (parseNetworkId(user.networkId)) {
    await db.collection('networks').doc(user.networkId).set(patch, { merge: true });
  }
  await audit(db, { action: 'NETWORK_RENEW', actorUid, uid: value.uid, details: { previousEnd, nextEnd, extensionDays: value.extensionDays }, now });
  return { status: 'renewed', subscriptionEndsAt: nextEnd };
}

async function batchExpiry(db, { value, actorUid, now }) {
  const snap = await db.collection('users').where('accessStatus', '==', 'ACTIVE_PAID').get();
  const end = Timestamp.fromMillis(value.subscriptionEndsAtMs);
  let updated = 0;
  for (let index = 0; index < snap.docs.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    snap.docs.slice(index, index + BATCH_LIMIT).forEach((docSnap) => {
      batch.set(docSnap.ref, { subscriptionEndsAt: end, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
    updated += Math.min(BATCH_LIMIT, snap.docs.length - index);
  }
  await audit(db, { action: 'SUBSCRIPTION_BATCH', actorUid, uid: null, details: { subscriptionEndsAt: value.subscriptionEndsAtMs, updated }, now });
  return { status: 'batched', updated };
}


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const caller = await authenticateAdmin(req, { getAuth, getFirestore });
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });

  const parsed = validateNetworkInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  const db = getFirestore();
  const now = Date.now();
  try {
    let result;
    if (parsed.value.action === 'provision') result = await provision(db, { ownerUid: parsed.value.ownerUid, actorUid: caller.callerUid, now });
    else if (parsed.value.action === 'update-access') result = await updateAccess(db, { value: parsed.value, actorUid: caller.callerUid, now });
    else if (parsed.value.action === 'renew') result = await renew(db, { value: parsed.value, actorUid: caller.callerUid, now });
    else result = await batchExpiry(db, { value: parsed.value, actorUid: caller.callerUid, now });

    if (result.status === 'account_not_found') return res.status(404).json({ success: false, error: 'account_not_found' });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'hmac_not_configured' });
    }
    if (error?.message === 'network_secret_decryption_failed') {
      console.error('networks: stored network key could not be decrypted');
      return res.status(503).json({ success: false, error: 'network_secret_unavailable' });
    }
    console.error('networks action failed', error);
    return res.status(500).json({ success: false, error: 'network_action_failed' });
  }
}
