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
//   action=repair-access   { cursor?, limit? }              → إصلاح سجلات الوصول القديمة على دفعات
//   action=batch-expiry   { subscriptionEndsAt }           → إجراء إداري قديم لتوحيد تاريخ الانتهاء؛ لا يُستدعى من Cron
//   Vercel Cron يفحص الاستحقاقات عبر api/_lib/subscriptionExpiry.js ولا يغيّر تواريخ الانتهاء.
//
// يتطلب FIREBASE_SERVICE_ACCOUNT.
// ============================================================

import { createHash } from 'node:crypto';
import { getFirestore, FieldValue, Timestamp, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from '../_lib/firebaseAdmin.js';
import { nextNetworkSequence, formatNetworkId, parseNetworkId } from '../_lib/networkId.js';
import { encryptNetworkSecret, generateNetworkSecret } from '../_lib/networkSecret.js';
import { ensureNetworkSecret } from '../_lib/networkSecretStore.js';
import { ACCESS_STATUSES, accessStamp, legacyAccessFields } from '../_lib/accessStatus.js';
import deviceHeartbeatHandler from '../_lib/deviceHeartbeat.js';
import deviceHeartbeatsHandler from '../_lib/deviceHeartbeats.js';
import { chooseLatestAccessState } from '../_lib/accessReconciliation.js';

export { ACCESS_STATUSES, legacyAccessFields };
export const TRIAL_DAYS = 30;
export const RENEWAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_WARNING = 500;
const BATCH_LIMIT = 200;
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
  if (!['provision', 'update-access', 'renew', 'repair-access', 'batch-expiry', 'delete'].includes(action)) {
    return { ok: false, error: 'unknown_action' };
  }

  if (action === 'delete') {
    const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
    if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
    return { ok: true, value: { action, uid } };
  }

  if (action === 'repair-access') {
    const cursor = typeof input.cursor === 'string' && input.cursor.trim() ? input.cursor.trim() : null;
    const limit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return { ok: false, error: 'repair_limit_invalid' };
    }
    return { ok: true, value: { action, cursor, limit } };
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
    if (input.phone_verified !== undefined) {
      if (typeof input.phone_verified !== 'boolean') return { ok: false, error: 'phone_verified_invalid' };
      value.phone_verified = input.phone_verified; provided += 1;
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
    updatedAtMs: now,
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

  const ownerNetworkIds = new Set();
  for (const field of ['owner_uid', 'ownerUid', 'uid']) {
    const snapshot = await db.collection('networks').where(field, '==', ownerUid).limit(3).get();
    for (const document of snapshot.docs || []) {
      const network = document.data() || {};
      const owner = network.owner_uid || network.ownerUid || network.uid;
      if (owner === ownerUid) ownerNetworkIds.add(document.id);
    }
  }
  if (ownerNetworkIds.size > 1) {
    const error = new Error('network_mapping_ambiguous');
    error.status = 409;
    throw error;
  }
  if (ownerNetworkIds.size === 1) {
    const networkId = [...ownerNetworkIds][0];
    const networkRef = db.collection('networks').doc(networkId);
    const { networkSecret } = await ensureNetworkSecret(db, networkRef);
    return { status: 'duplicate', networkId, networkSecret };
  }

  const networkId = await allocateNetworkId(db);
  const trialStartedAt = now;
  const subscriptionEndsAt = now + TRIAL_DAYS * DAY_MS;
  const subscriptionEndsAtTimestamp = Timestamp.fromMillis(subscriptionEndsAt);
  const accessFields = { ...legacyAccessFields('TRIAL', subscriptionEndsAtTimestamp), ...accessStamp(now) };
  const networkSecret = generateNetworkSecret();
  const networkSecretEncrypted = encryptNetworkSecret(networkSecret);
  const networkRef = db.collection('networks').doc(networkId);
  await db.runTransaction(async (transaction) => {
    transaction.set(networkRef, {
      networkId,
      owner_uid: ownerUid,
      accessStatus: 'TRIAL',
      ...accessFields,
      trialStartedAt: Timestamp.fromMillis(trialStartedAt),
      subscriptionEndsAt: subscriptionEndsAtTimestamp,
      networkSecretEncrypted,
      networkSecretVersion: 1,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
      updatedAtMs: now,
      createdBy: actorUid,
    }, { merge: false });
    transaction.set(userRef, {
      networkId,
      owner_uid: ownerUid,
      accessStatus: 'TRIAL',
      ...accessFields,
      trialStartedAt: Timestamp.fromMillis(trialStartedAt),
      subscriptionEndsAt: subscriptionEndsAtTimestamp,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    }, { merge: true });
  });
  await audit(db, { action: 'NETWORK_PROVISION', actorUid, uid: ownerUid, details: { networkId }, now });
  return { status: 'created', networkId, trialStartedAt, subscriptionEndsAt, networkSecret };
}

export async function updateAccess(db, { value, actorUid, now }) {
  const patch = {};
  if (value.accessStatus !== undefined) {
    patch.accessStatus = value.accessStatus;
    Object.assign(patch, legacyAccessFields(value.accessStatus));
  }
  if (value.subscriptionEndsAtMs !== undefined) {
    const endAt = Timestamp.fromMillis(value.subscriptionEndsAtMs);
    patch.subscriptionEndsAt = endAt;
    patch.subscription_end_date = endAt;
  }
  if (value.accessStatus !== undefined || value.subscriptionEndsAtMs !== undefined) {
    Object.assign(patch, accessStamp(now));
  }
  if (value.commissionRate !== undefined) patch.commission_rate = value.commissionRate;
  if (value.warningMessage !== undefined) patch.warning_message = value.warningMessage;
  if (value.hasCustomWarning !== undefined) patch.has_custom_warning = value.hasCustomWarning;
  if (value.phone_verified !== undefined) {
    patch.phone_verified = value.phone_verified;
    patch.phoneVerified = value.phone_verified;
    if (value.phone_verified) {
      patch.phone_verified_at = FieldValue.serverTimestamp();
      patch.verified_by_admin = true;
      patch.verified_by_admin_uid = actorUid;
      patch.phone_verified_manual = true;
    } else {
      patch.phone_verified = false;
      patch.phoneVerified = false;
      patch.phone_verified_manual = false;
      patch.verified_by_admin = false;
      patch.phone_unverified_at = FieldValue.serverTimestamp();
      patch.phone_unverified_by = actorUid;
    }
  }
  patch.updatedAt = FieldValue.serverTimestamp();
  patch.updatedAtMs = now;

  const userRef = db.collection('users').doc(value.uid);
  const result = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return { status: 'account_not_found' };

    const user = userSnap.data() || {};
    const networkId = typeof user.networkId === 'string' && UID_PATTERN.test(user.networkId)
      ? user.networkId
      : value.uid;
    const networkRef = db.collection('networks').doc(networkId);
    const networkSnap = await transaction.get(networkRef);
    const networkData = networkSnap.exists ? (networkSnap.data() || {}) : null;
    const networkBelongsToUser = Boolean(networkData)
      && (networkData.owner_uid === value.uid || (!networkData.owner_uid && networkId === value.uid));

    // اكتب حساب المستخدم والشبكة المملوكة له في معاملة واحدة.
    transaction.set(userRef, patch, { merge: true });
    if (networkBelongsToUser) transaction.set(networkRef, patch, { merge: true });
    return { status: 'updated' };
  });
  if (result.status !== 'updated') return result;

  const { updatedAt: _updatedAt, ...auditPatch } = patch;
  await audit(db, { action: 'NETWORK_ACCESS_UPDATE', actorUid, uid: value.uid, details: auditPatch, now });
  return result;
}

function sameTimestamp(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return toMillis(left) === toMillis(right);
}

function accessFieldsMatch(record, accessStatus, endAt) {
  const expected = legacyAccessFields(accessStatus);
  if (record.accessStatus !== accessStatus
    || record.is_active !== expected.is_active
    || record.is_trial !== expected.is_trial) return false;
  if (endAt != null) {
    if (!sameTimestamp(record.subscriptionEndsAt, endAt)
      || !sameTimestamp(record.subscription_end_date, endAt)) return false;
  }
  return true;
}

/**
 * Idempotent, paginated repair for records created before accessStatus and
 * legacy booleans were synchronized. Each user/network pair is repaired in a
 * transaction and the explicit server status is always the source of truth.
 */
export async function repairLegacyAccess(db, { value, actorUid, now }) {
  let query = db.collection('users')
    .orderBy(FieldPath.documentId())
    .limit(value.limit);
  if (value.cursor) query = query.startAfter(value.cursor);
  const page = await query.get();

  let usersUpdated = 0;
  let networksUpdated = 0;
  let skipped = 0;

  // Limit concurrent transactions to avoid flooding Firestore on large accounts.
  for (let offset = 0; offset < page.docs.length; offset += 10) {
    const group = page.docs.slice(offset, offset + 10);
    const results = await Promise.all(group.map(async (entry) => db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(entry.id);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) return { skipped: true };

      const user = userSnap.data() || {};
      const accessStatus = typeof user.accessStatus === 'string'
        ? user.accessStatus.trim().toUpperCase()
        : '';
      // Do not infer a new entitlement for records lacking a known server status.
      if (!ACCESS_STATUSES.includes(accessStatus)) return { skipped: true };

      const endAt = user.subscriptionEndsAt ?? user.subscription_end_date ?? null;
      const userNeedsUpdate = !accessFieldsMatch(user, accessStatus, endAt);
      const networkIdCandidate = typeof user.networkId === 'string' && UID_PATTERN.test(user.networkId)
        ? user.networkId
        : entry.id;
      const networkRef = db.collection('networks').doc(networkIdCandidate);
      const networkSnap = await transaction.get(networkRef);
      const network = networkSnap.exists ? (networkSnap.data() || {}) : null;
      const networkBelongsToUser = Boolean(network)
        && (network.owner_uid === entry.id || (!network.owner_uid && networkIdCandidate === entry.id));
      const networkNeedsUpdate = networkBelongsToUser
        && !accessFieldsMatch(network, accessStatus, endAt);

      const makePatch = () => {
        const patch = {
          accessStatus,
          ...legacyAccessFields(accessStatus),
          ...accessStamp(now),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: now,
        };
        if (endAt != null) {
          patch.subscriptionEndsAt = endAt;
          patch.subscription_end_date = endAt;
        }
        return patch;
      };

      if (userNeedsUpdate) transaction.set(userRef, makePatch(), { merge: true });
      if (networkNeedsUpdate) transaction.set(networkRef, makePatch(), { merge: true });
      return { userUpdated: userNeedsUpdate, networkUpdated: Boolean(networkNeedsUpdate) };
    })));

    for (const result of results) {
      if (result.skipped) skipped += 1;
      else {
        if (result.userUpdated) usersUpdated += 1;
        if (result.networkUpdated) networksUpdated += 1;
      }
    }
  }

  const nextCursor = page.size === value.limit ? page.docs[page.docs.length - 1].id : null;
  await audit(db, {
    action: 'ACCESS_COMPATIBILITY_REPAIR',
    actorUid,
    uid: null,
    details: { scanned: page.size, usersUpdated, networksUpdated, skipped, nextCursor },
    now,
  });
  return {
    status: 'access_repaired',
    scanned: page.size,
    usersUpdated,
    networksUpdated,
    skipped,
    nextCursor,
    done: !nextCursor,
  };
}

export async function renewSubscription(db, { value, actorUid, now }) {
  const userRef = db.collection('users').doc(value.uid);
  const result = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return { status: 'account_not_found' };

    const user = userSnap.data() || {};
    const networkId = typeof user.networkId === 'string' && UID_PATTERN.test(user.networkId)
      ? user.networkId
      : value.uid;
    const networkRef = db.collection('networks').doc(networkId);
    const networkSnap = await transaction.get(networkRef);
    const networkData = networkSnap.exists ? (networkSnap.data() || {}) : null;
    const networkBelongsToUser = Boolean(networkData)
      && (networkData.owner_uid === value.uid || (!networkData.owner_uid && networkId === value.uid));

    // Extend from the newest recorded end date (user or owned network) so a
    // renewal never shortens a subscription that one record already extended.
    const latest = chooseLatestAccessState(user, networkBelongsToUser ? networkData : null) || user;
    const previousEnd = Math.max(
      toMillis(latest.subscriptionEndsAt ?? latest.subscription_end_date),
      toMillis(user.subscriptionEndsAt ?? user.subscription_end_date),
    );
    const nextEnd = computeRenewalEnd(previousEnd, now, value.extensionDays);
    const endAt = Timestamp.fromMillis(nextEnd);
    const patch = {
      accessStatus: 'ACTIVE_PAID',
      ...legacyAccessFields('ACTIVE_PAID', endAt),
      ...accessStamp(now),
      subscriptionEndsAt: endAt,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    };

    transaction.set(userRef, patch, { merge: true });
    if (networkBelongsToUser) transaction.set(networkRef, patch, { merge: true });
    return { status: 'renewed', previousEnd, nextEnd };
  });
  if (result.status !== 'renewed') return result;
  await audit(db, { action: 'NETWORK_RENEW', actorUid, uid: value.uid, details: { previousEnd: result.previousEnd, nextEnd: result.nextEnd, extensionDays: value.extensionDays }, now });
  return { status: 'renewed', subscriptionEndsAt: result.nextEnd };
}

async function batchExpiry(db, { value, actorUid, now }) {
  const snap = await db.collection('users').where('accessStatus', '==', 'ACTIVE_PAID').get();
  const end = Timestamp.fromMillis(value.subscriptionEndsAtMs);
  let updated = 0;
  let networksUpdated = 0;
  for (let index = 0; index < snap.docs.length; index += BATCH_LIMIT) {
    const docs = snap.docs.slice(index, index + BATCH_LIMIT);
    const networkRefsByPath = new Map();
    for (const docSnap of docs) {
      const networkId = docSnap.data()?.networkId;
      if (parseNetworkId(networkId)) {
        const networkRef = db.collection('networks').doc(networkId);
        networkRefsByPath.set(networkRef.path, networkRef);
      }
    }
    const networkRefs = [...networkRefsByPath.values()];
    const networkSnaps = networkRefs.length ? await db.getAll(...networkRefs) : [];
    const existingNetworks = new Map(networkSnaps.filter((item) => item.exists).map((item) => [item.ref.path, item]));
    const batch = db.batch();

    for (const docSnap of docs) {
      const patch = {
        subscriptionEndsAt: end,
        subscription_end_date: end,
        ...accessStamp(now),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: now,
      };
      batch.set(docSnap.ref, patch, { merge: true });
      updated += 1;

      const networkId = docSnap.data()?.networkId;
      const networkRef = parseNetworkId(networkId) ? db.collection('networks').doc(networkId) : null;
      if (networkRef && existingNetworks.has(networkRef.path)) {
        batch.set(networkRef, patch, { merge: true });
        networksUpdated += 1;
      }
    }
    await batch.commit();
  }
  await audit(db, { action: 'SUBSCRIPTION_BATCH', actorUid, uid: null, details: { subscriptionEndsAt: value.subscriptionEndsAtMs, updated, networksUpdated }, now });
  return { status: 'batched', updated, networksUpdated };
}

function addSyncTombstone(db, batch, { collection, networkId = null, id, now }) {
  batch.set(db.collection('sync_tombstones').doc(), {
    collection,
    networkId,
    id,
    updatedAtMs: now,
  });
}

async function deleteSubcollection(db, colRef, { networkId = null, now }) {
  while (true) {
    const snap = await colRef.limit(100).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((document) => {
      if (networkId && (colRef.id === 'sales' || colRef.id === 'payments')) {
        addSyncTombstone(db, batch, {
          collection: colRef.id,
          networkId,
          id: document.id,
          now,
        });
      }
      batch.delete(document.ref);
    });
    await batch.commit();
    if (snap.size < 100) break;
  }
}

/** Deletes every document returned by a root-level query in bounded batches. */
async function deleteRootQuery(db, query) {
  while (true) {
    const page = await query.limit(100).get();
    if (!page.docs?.length) break;
    const batch = db.batch();
    page.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    if (page.docs.length < 100) break;
  }
}

async function deleteAccountOwnedRootRecords(db, uid, phone) {
  // Idempotency registry entries are root documents, not a user subcollection.
  await deleteRootQuery(db, db.collection('sale_ingest_registry').where('uid', '==', uid));

  // Remove queued and historical notifications addressed to this account.
  await deleteRootQuery(db, db.collection('notification_requests').where('targetUid', '==', uid));
  await deleteRootQuery(db, db.collection('notification_deliveries').where('targetUid', '==', uid));

  // Remove every phone index variant for the account, including legacy duplicates.
  if (phone) {
    const hashedPhone = createHash('sha256').update(String(phone).trim(), 'utf8').digest('hex');
    await db.collection('network_registration_phone_index').doc(hashedPhone).delete();
  }
  await deleteRootQuery(db, db.collection('network_registration_phone_index').where('uid', '==', uid));
}

async function purgeDocAndAllSubcollections(db, docRef, { collection, id, now }) {
  try {
    const subcollections = await docRef.listCollections();
    for (const subCol of subcollections) {
      await deleteSubcollection(db, subCol, {
        networkId: collection === 'networks' && (subCol.id === 'sales' || subCol.id === 'payments') ? id : null,
        now,
      });
    }
  } catch {
    for (const sub of [
      'sales', 'payments', 'settlements', '_metadata', 'devices', 'notifications',
      'template_acks', 'account_feature_audit', 'device_heartbeats', 'inventory_snapshot',
    ]) {
      await deleteSubcollection(db, docRef.collection(sub), {
        networkId: collection === 'networks' && (sub === 'sales' || sub === 'payments') ? id : null,
        now,
      });
    }
  }
  if (collection === 'users' || collection === 'networks') {
    const batch = db.batch();
    addSyncTombstone(db, batch, { collection, id, now });
    batch.delete(docRef);
    await batch.commit();
  } else {
    await docRef.delete().catch(() => {});
  }
}

export async function deleteAccount(db, { uid, actorUid, now, authService = getAuth() }) {
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : null;
  if (!userData) return { status: 'account_not_found', uid };
  const networkId = userData?.networkId || null;
  const phone = userData?.phone || userData?.phoneNumber || null;
  // Discover all network documents before deleting anything. This avoids
  // starting a partial delete when a legacy account has multiple networks.
  const networksToDelete = new Map();
  if (networkId) {
    networksToDelete.set(networkId, db.collection('networks').doc(networkId));
  }
  networksToDelete.set(uid, db.collection('networks').doc(uid));

  // Find any network where owner_uid == uid or ownerUid == uid
  const ownedSnap1 = await db.collection('networks').where('owner_uid', '==', uid).get();
  (ownedSnap1?.docs || ownedSnap1 || []).forEach((d) => networksToDelete.set(d.id, d.ref));
  const ownedSnap2 = await db.collection('networks').where('ownerUid', '==', uid).get();
  (ownedSnap2?.docs || ownedSnap2 || []).forEach((d) => networksToDelete.set(d.id, d.ref));

  // Purge all network documents and their subcollections first. Keeping the user
  // document until the end makes a failed deletion retryable from the dashboard.
  for (const [, netRef] of networksToDelete.entries()) {
    await purgeDocAndAllSubcollections(db, netRef, { collection: 'networks', id: netRef.id, now });
  }

  // Purge root-level records owned by or addressed to this account.
  await deleteAccountOwnedRootRecords(db, uid, phone);

  // Purge admin billing aggregates.
  const aggregateRef = db.collection('admin_aggregates').doc(uid);
  const aggregateBatch = db.batch();
  addSyncTombstone(db, aggregateBatch, { collection: 'admin_aggregates', id: uid, now });
  aggregateBatch.delete(aggregateRef);
  await aggregateBatch.commit();

  // Delete Firebase Auth user before the profile document. If Auth fails, the
  // profile remains available so the administrator can retry safely.
  try {
    await authService.deleteUser(uid);
  } catch (authError) {
    if (authError?.code !== 'auth/user-not-found') {
      throw authError;
    }
  }

  // Remove the user document and every user subcollection last.
  await purgeDocAndAllSubcollections(db, userRef, { collection: 'users', id: uid, now });

  // Keep one minimal audit event intentionally as the deletion audit trail.
  await audit(db, {
    action: 'NETWORK_DELETE',
    actorUid,
    uid,
    details: {
      networkId,
      networkName: userData?.network_name || userData?.networkName || null,
      networksPurged: Array.from(networksToDelete.keys()),
    },
    now,
  });

  return {
    status: 'deleted',
    uid,
    networkId,
    networksPurged: Array.from(networksToDelete.keys()),
  };
}

export default async function handler(req, res) {
  const apiRoute = req.query?.__apiRoute;
  if (apiRoute === 'device-heartbeat') return deviceHeartbeatHandler(req, res);
  if (apiRoute === 'device-heartbeats') return deviceHeartbeatsHandler(req, res);

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
    else if (parsed.value.action === 'renew') result = await renewSubscription(db, { value: parsed.value, actorUid: caller.callerUid, now });
    else if (parsed.value.action === 'repair-access') result = await repairLegacyAccess(db, { value: parsed.value, actorUid: caller.callerUid, now });
    else if (parsed.value.action === 'delete') result = await deleteAccount(db, { uid: parsed.value.uid, actorUid: caller.callerUid, now });
    else result = await batchExpiry(db, { value: parsed.value, actorUid: caller.callerUid, now });

    if (result.status === 'account_not_found') return res.status(404).json({ success: false, error: 'account_not_found' });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error?.message === 'network_mapping_ambiguous') {
      return res.status(409).json({ success: false, error: 'network_mapping_ambiguous' });
    }
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
