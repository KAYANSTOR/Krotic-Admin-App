/**
 * Per-network Meta access token storage — ciphertext only, Admin SDK only.
 * Collection: whatsapp_network_secrets/{networkId}
 * Never readable by clients (see firestore.rules).
 */
import { sealNetworkAccessToken, openNetworkAccessToken } from './secrets.js';

export const NETWORK_SECRETS_COLLECTION = 'whatsapp_network_secrets';

/**
 * Save sealed access token for a network. Overwrites previous envelope.
 * Does not write plaintext anywhere.
 */
export async function saveNetworkAccessToken(db, networkId, accessToken, { now = Date.now(), actorUid = null } = {}) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  const sealed = sealNetworkAccessToken(networkId, accessToken);
  if (!sealed.ok) return sealed;

  const ref = db.collection(NETWORK_SECRETS_COLLECTION).doc(networkId);
  await ref.set({
    networkId,
    whatsappAccessTokenEnc: sealed.envelope,
    updatedAtMs: now,
    updatedBy: actorUid,
  }, { merge: false });

  return { ok: true, networkId };
}

export async function loadNetworkAccessToken(db, networkId) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  const snap = await db.collection(NETWORK_SECRETS_COLLECTION).doc(networkId).get();
  if (!snap.exists) return { ok: false, error: 'network_token_missing' };
  return openNetworkAccessToken(networkId, snap.data() || {});
}

export async function deleteNetworkAccessToken(db, networkId) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  await db.collection(NETWORK_SECRETS_COLLECTION).doc(networkId).delete();
  return { ok: true };
}
