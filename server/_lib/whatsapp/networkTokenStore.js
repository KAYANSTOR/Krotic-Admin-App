/**
 * Per-network Meta access token storage — ciphertext only, Admin SDK only.
 * Collection: whatsapp_network_secrets/{networkId}
 * Never readable by clients (see firestore.rules).
 */
import { sealNetworkAccessToken, openNetworkAccessToken } from './secrets.js';

export const NETWORK_SECRETS_COLLECTION = 'whatsapp_network_secrets';

/** Save an encrypted business token plus non-secret lifecycle metadata. */
export async function saveNetworkAccessToken(db, networkId, accessToken, {
  now = Date.now(),
  actorUid = null,
  tokenExpiresAtMs = null,
  tokenType = 'embedded_signup_access_token',
  wabaId = null,
  phoneNumberId = null,
  batch = null,
} = {}) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  const sealed = sealNetworkAccessToken(networkId, accessToken);
  if (!sealed.ok) return sealed;

  const ref = db.collection(NETWORK_SECRETS_COLLECTION).doc(networkId);
  const secretDocument = {
    networkId,
    whatsappAccessTokenEnc: sealed.envelope,
    tokenExpiresAtMs: Number.isSafeInteger(tokenExpiresAtMs) ? tokenExpiresAtMs : null,
    tokenType: String(tokenType).slice(0, 64),
    wabaId: typeof wabaId === 'string' ? wabaId : null,
    phoneNumberId: typeof phoneNumberId === 'string' ? phoneNumberId : null,
    updatedAtMs: now,
    updatedBy: actorUid,
  };
  if (batch) batch.set(ref, secretDocument, { merge: false });
  else await ref.set(secretDocument, { merge: false });

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
