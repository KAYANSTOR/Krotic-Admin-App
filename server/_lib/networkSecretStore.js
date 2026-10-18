import { FieldValue } from 'firebase-admin/firestore';
import { decryptNetworkSecret, encryptNetworkSecret, generateNetworkSecret } from './networkSecret.js';

/** Ensures a network has one stable secret; safe to retry and concurrent calls. */
export async function ensureNetworkSecret(db, networkRef) {
  const candidateSecret = generateNetworkSecret();
  const candidateEnvelope = encryptNetworkSecret(candidateSecret);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(networkRef);
    if (!snapshot.exists) throw new Error('network_not_found');
    const data = snapshot.data() || {};
    if (data.networkSecretEncrypted) {
      return { networkSecret: decryptNetworkSecret(data.networkSecretEncrypted), created: false };
    }

    transaction.set(networkRef, {
      networkSecretEncrypted: candidateEnvelope,
      networkSecretVersion: 1,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { networkSecret: candidateSecret, created: true };
  });
}
