import { FieldValue } from 'firebase-admin/firestore';
import { decryptNetworkSecret, encryptNetworkSecret, generateNetworkSecret } from './networkSecret.js';

export const DEFAULT_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

function secretVersion(data) {
  const raw = Number(data?.networkSecretVersion);
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

function previousValidUntilMs(data) {
  const raw = Number(data?.previousNetworkSecretValidUntilMs);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Returns the HMAC keys a request may legitimately use right now. The current
 * key is always first; the previous key stays valid only during the explicit
 * rotation grace window, so old devices can finish their pending uploads.
 */
export function networkSecretCandidates(network, { now = Date.now() } = {}) {
  const data = network && typeof network === 'object' ? network : {};
  const candidates = [];
  if (typeof data.networkSecretEncrypted === 'string' && data.networkSecretEncrypted) {
    candidates.push({
      secret: decryptNetworkSecret(data.networkSecretEncrypted),
      version: secretVersion(data),
      current: true,
    });
  } else {
    return candidates;
  }
  const previousUntil = previousValidUntilMs(data);
  if (typeof data.previousNetworkSecretEncrypted === 'string'
      && data.previousNetworkSecretEncrypted
      && previousUntil !== null
      && previousUntil > now) {
    try {
      candidates.push({
        secret: decryptNetworkSecret(data.previousNetworkSecretEncrypted),
        version: secretVersion({ networkSecretVersion: data.previousNetworkSecretVersion }),
        current: false,
        validUntilMs: previousUntil,
      });
    } catch {
      // A stale/corrupt previous envelope must never weaken the current key.
    }
  }
  return candidates;
}

/** Ensures a network has one stable secret; safe to retry and concurrent calls. */
export async function ensureNetworkSecret(db, networkRef, {
  recoverUndecryptable = false,
  now = Date.now(),
} = {}) {
  const candidateSecret = generateNetworkSecret();
  const candidateEnvelope = encryptNetworkSecret(candidateSecret);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(networkRef);
    if (!snapshot.exists) throw new Error('network_not_found');
    const data = snapshot.data() || {};
    if (data.networkSecretEncrypted) {
      try {
        return {
          networkSecret: decryptNetworkSecret(data.networkSecretEncrypted),
          created: false,
          rotated: false,
          version: secretVersion(data),
          previousValidUntilMs: (() => {
            const until = previousValidUntilMs(data);
            return until !== null && until > now ? until : null;
          })(),
        };
      } catch (error) {
        const recoverable = recoverUndecryptable
          && ['network_secret_decryption_failed', 'network_secret_envelope_invalid'].includes(error?.message);
        if (!recoverable) throw error;
        const version = secretVersion(data) + 1;
        transaction.set(networkRef, {
          networkSecretEncrypted: candidateEnvelope,
          networkSecretVersion: version,
          networkSecretUpdatedAt: FieldValue.serverTimestamp(),
          networkSecretUpdatedAtMs: now,
          previousNetworkSecretEncrypted: FieldValue.delete(),
          previousNetworkSecretVersion: FieldValue.delete(),
          previousNetworkSecretValidUntilMs: FieldValue.delete(),
        }, { merge: true });
        return {
          networkSecret: candidateSecret,
          created: false,
          rotated: true,
          version,
          previousValidUntilMs: null,
        };
      }
    }

    transaction.set(networkRef, {
      networkSecretEncrypted: candidateEnvelope,
      networkSecretVersion: 1,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
      networkSecretUpdatedAtMs: now,
    }, { merge: true });
    return {
      networkSecret: candidateSecret,
      created: true,
      rotated: false,
      version: 1,
      previousValidUntilMs: null,
    };
  });
}

/**
 * Rotates the key and keeps the previous one usable only for `graceMs`.
 * The caller must be an authorized administrator and must audit the action.
 */
export async function rotateNetworkSecret(db, networkRef, {
  now = Date.now(),
  graceMs = DEFAULT_ROTATION_GRACE_MS,
  actorUid = null,
  reason = '',
  auditRef = null,
  auditData = null,
} = {}) {
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('rotation_grace_invalid');
  const candidateSecret = generateNetworkSecret();
  const candidateEnvelope = encryptNetworkSecret(candidateSecret);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(networkRef);
    if (!snapshot.exists) throw new Error('network_not_found');
    const data = snapshot.data() || {};
    const previousVersion = secretVersion(data);
    const hasCurrent = typeof data.networkSecretEncrypted === 'string' && data.networkSecretEncrypted;
    if (!hasCurrent) {
      transaction.set(networkRef, {
        networkSecretEncrypted: candidateEnvelope,
        networkSecretVersion: 1,
        networkSecretUpdatedAt: FieldValue.serverTimestamp(),
        networkSecretUpdatedAtMs: now,
      }, { merge: true });
      if (auditRef && auditData) {
        transaction.set(auditRef, typeof auditData === 'function'
          ? auditData({ version: 1, previousVersion: null, previousValidUntilMs: null, rotated: false })
          : auditData, { merge: false });
      }
      return {
        networkSecret: candidateSecret,
        created: true,
        rotated: false,
        version: 1,
        previousVersion: null,
        previousValidUntilMs: null,
      };
    }

    const version = previousVersion + 1;
    const validUntilMs = now + graceMs;
    transaction.set(networkRef, {
      networkSecretEncrypted: candidateEnvelope,
      networkSecretVersion: version,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
      networkSecretUpdatedAtMs: now,
      networkSecretRotatedBy: actorUid,
      networkSecretRotationReason: reason,
      previousNetworkSecretEncrypted: data.networkSecretEncrypted,
      previousNetworkSecretVersion: previousVersion,
      previousNetworkSecretValidUntilMs: validUntilMs,
      previousNetworkSecretValidUntil: new Date(validUntilMs).toISOString(),
    }, { merge: true });
    if (auditRef && auditData) {
      transaction.set(auditRef, typeof auditData === 'function'
        ? auditData({ version, previousVersion, previousValidUntilMs: validUntilMs, rotated: true })
        : auditData, { merge: false });
    }
    return {
      networkSecret: candidateSecret,
      created: false,
      rotated: true,
      version,
      previousVersion,
      previousValidUntilMs: validUntilMs,
    };
  });
}
