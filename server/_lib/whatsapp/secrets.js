/**
 * Secret access boundary for WhatsApp (no GCP Secret Manager required).
 *
 * Shared Meta secrets: Vercel env vars (per Production / Preview / Development).
 * Per-network Access Tokens: AES-256-GCM ciphertext on networks/{networkId}
 *   field: whatsappAccessTokenEnc (envelope) — never plaintext in Firestore.
 *
 * Env (server only):
 *   META_APP_SECRET | WHATSAPP_META_APP_SECRET
 *   META_VERIFY_TOKEN | WHATSAPP_META_VERIFY_TOKEN
 *   WHATSAPP_DISPATCH_SERVICE_SECRET
 *   WHATSAPP_SECRETS_KEK (+ optional WHATSAPP_SECRETS_KEK_PREV)
 */
import { encryptSecret, decryptSecret, cryptoReadiness } from './cryptoSecrets.js';

function envFirst(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export async function getMetaAppSecret() {
  const value = envFirst('META_APP_SECRET', 'WHATSAPP_META_APP_SECRET');
  if (!value) return { ok: false, error: 'meta_app_secret_not_configured' };
  return { ok: true, value };
}

export async function getMetaVerifyToken() {
  const value = envFirst('META_VERIFY_TOKEN', 'WHATSAPP_META_VERIFY_TOKEN');
  if (!value) return { ok: false, error: 'meta_verify_token_not_configured' };
  return { ok: true, value };
}

export async function getDispatchServiceSecret() {
  const value = envFirst('WHATSAPP_DISPATCH_SERVICE_SECRET');
  if (!value) return { ok: false, error: 'dispatch_secret_not_configured' };
  return { ok: true, value };
}

/**
 * Persist network access token as ciphertext only.
 * @returns {{ ok: true, envelope: object } | { ok: false, error: string }}
 */
export function sealNetworkAccessToken(networkId, accessToken) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  return encryptSecret(accessToken, { aad: `network:${networkId}` });
}

/**
 * Read and decrypt network access token from network document data.
 * Never logs plaintext.
 */
export function openNetworkAccessToken(networkId, networkData) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  const envelope = networkData?.whatsappAccessTokenEnc;
  if (!envelope) return { ok: false, error: 'network_token_missing' };
  return decryptSecret(envelope, { aad: `network:${networkId}` });
}

/**
 * Async helper used by call sites that pass db — decrypt from Firestore doc.
 */
export async function getNetworkMetaAccessToken(networkId, dependencies = {}) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  if (dependencies.networkData) {
    return openNetworkAccessToken(networkId, dependencies.networkData);
  }
  if (!dependencies.db) return { ok: false, error: 'db_required' };
  const snap = await dependencies.db.collection('networks').doc(networkId).get();
  if (!snap.exists) return { ok: false, error: 'network_not_found' };
  return openNetworkAccessToken(networkId, snap.data() || {});
}

export function secretsReadinessReport() {
  const crypto = cryptoReadiness();
  return {
    backend: 'vercel_env_plus_aes_gcm',
    metaAppSecret: envFirst('META_APP_SECRET', 'WHATSAPP_META_APP_SECRET') ? 'env_present' : 'not_configured',
    metaVerifyToken: envFirst('META_VERIFY_TOKEN', 'WHATSAPP_META_VERIFY_TOKEN') ? 'env_present' : 'not_configured',
    networkAccessTokens: crypto.kekConfigured ? 'kek_ready_ciphertext_per_network' : 'kek_not_configured',
    dispatchServiceSecret: envFirst('WHATSAPP_DISPATCH_SERVICE_SECRET') ? 'env_present' : 'not_configured',
    crypto,
    cloudTasks: 'replaced_by_firestore_queue',
    cloudScheduler: 'optional_external_or_vercel_cron_recovery_only',
    note: 'Do not put all network tokens in one env var; ciphertext lives under networks/{networkId}',
  };
}
