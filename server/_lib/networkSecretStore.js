import { FieldValue } from 'firebase-admin/firestore';
import { decryptNetworkSecret, encryptNetworkSecret, generateNetworkSecret } from './networkSecret.js';

/** Ensures a network has one stable secret; safe to retry and concurrent calls. */
export async function ensureNetworkSecret(db, networkRef, { recoverUndecryptable = false } = {}) {
  const candidateSecret = generateNetworkSecret();
  const candidateEnvelope = encryptNetworkSecret(candidateSecret);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(networkRef);
    if (!snapshot.exists) throw new Error('network_not_found');
    const data = snapshot.data() || {};
    if (data.networkSecretEncrypted) {
      try {
        return { networkSecret: decryptNetworkSecret(data.networkSecretEncrypted), created: false, rotated: false };
      } catch (error) {
        const recoverable = recoverUndecryptable
          && ['network_secret_decryption_failed', 'network_secret_envelope_invalid'].includes(error?.message);
        if (!recoverable) throw error;
        const version = Math.max(1, Number(data.networkSecretVersion) || 1) + 1;
        transaction.set(networkRef, {
          networkSecretEncrypted: candidateEnvelope,
          networkSecretVersion: version,
          networkSecretUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { networkSecret: candidateSecret, created: false, rotated: true };
      }
    }

    transaction.set(networkRef, {
      networkSecretEncrypted: candidateEnvelope,
      networkSecretVersion: 1,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { networkSecret: candidateSecret, created: true, rotated: false };
  });
}
