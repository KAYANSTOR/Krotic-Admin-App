import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { legacyAccessFields } from './accessStatus.js';

const BATCH_SIZE = 200;
const ELIGIBLE_STATUSES = new Set(['TRIAL', 'ACTIVE_PAID']);
const SAFE_DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function expiryMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Supports current and legacy expiry fields; manual suspensions are not reclassified. */
export function shouldLockExpiredAccount(user, now = Date.now()) {
  if (!user || typeof user !== 'object') return false;
  const status = typeof user.accessStatus === 'string' ? user.accessStatus.trim().toUpperCase() : '';
  if (status === 'LOCKED_EXPIRED' || status === 'SUSPENDED_GRACE') return false;
  if (status && !ELIGIBLE_STATUSES.has(status)) return false;
  // When the server-owned status exists, do not let a stale legacy boolean
  // suppress expiry processing. Legacy-only records retain the old fallback.
  if (!status && user.is_active === false) return false;
  const end = expiryMillis(user.subscriptionEndsAt ?? user.subscription_end_date);
  return end > 0 && end <= now;
}

function networkIdFor(user, uid) {
  const candidate = typeof user?.networkId === 'string' && user.networkId.trim()
    ? user.networkId.trim()
    : uid;
  return SAFE_DOC_ID.test(candidate) ? candidate : null;
}

/**
 * Daily, idempotent expiry sweep. It scans both server-managed status records
 * and legacy active records, then rechecks each candidate transactionally so a
 * concurrent renewal cannot be overwritten by a stale query result.
 */
export async function expireOverdueSubscriptions(db, now = Date.now()) {
  const users = db.collection('users');
  const [managed, legacyActive] = await Promise.all([
    users.where('accessStatus', 'in', ['TRIAL', 'ACTIVE_PAID']).get(),
    users.where('is_active', '==', true).get(),
  ]);
  const candidatesByUid = new Map();
  [...managed.docs, ...legacyActive.docs].forEach((snapshot) => candidatesByUid.set(snapshot.id, snapshot));
  const expired = [...candidatesByUid.values()].filter((snapshot) => shouldLockExpiredAccount(snapshot.data(), now));

  let locked = 0;
  let networksUpdated = 0;
  for (let offset = 0; offset < expired.length; offset += BATCH_SIZE) {
    const group = expired.slice(offset, offset + BATCH_SIZE).map((snapshot) => {
      const user = snapshot.data() || {};
      const networkId = networkIdFor(user, snapshot.id);
      return {
        uid: snapshot.id,
        userRef: snapshot.ref,
        networkId,
        networkRef: networkId ? db.collection('networks').doc(networkId) : null,
      };
    });

    const counts = await db.runTransaction(async (transaction) => {
      const refs = [...new Map(group.flatMap((entry) => [
        entry.userRef,
        ...(entry.networkRef ? [entry.networkRef] : []),
      ]).map((ref) => [ref.path, ref])).values()];
      const snapshots = await transaction.getAll(...refs);
      const byPath = new Map(snapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
      let currentLocked = 0;
      let currentNetworksUpdated = 0;

      for (const entry of group) {
        const userSnapshot = byPath.get(entry.userRef.path);
        if (!userSnapshot?.exists || !shouldLockExpiredAccount(userSnapshot.data(), now)) continue;
        const patch = {
          accessStatus: 'LOCKED_EXPIRED',
          ...legacyAccessFields('LOCKED_EXPIRED'),
          lockedAt: Timestamp.fromMillis(now),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: now,
        };
        transaction.set(entry.userRef, patch, { merge: true });
        currentLocked += 1;

        if (!entry.networkRef) continue;
        const networkSnapshot = byPath.get(entry.networkRef.path);
        if (!networkSnapshot?.exists) continue;
        const network = networkSnapshot.data() || {};
        const ownershipMatches = network.owner_uid === entry.uid
          || (!network.owner_uid && entry.networkId === entry.uid);
        if (!ownershipMatches) continue;
        transaction.set(entry.networkRef, patch, { merge: true });
        currentNetworksUpdated += 1;
      }
      return { locked: currentLocked, networksUpdated: currentNetworksUpdated };
    });

    locked += counts.locked;
    networksUpdated += counts.networksUpdated;
  }

  if (locked > 0) {
    await db.collection('admin_audit_logs').add({
      action: 'SUBSCRIPTION_EXPIRY_CRON',
      actorUid: 'system:vercel-cron',
      targetType: 'network',
      targetId: null,
      details: { locked, networksUpdated, scanned: candidatesByUid.size },
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
      updatedAtMs: now,
    });
  }

  return { scanned: candidatesByUid.size, locked, networksUpdated };
}
