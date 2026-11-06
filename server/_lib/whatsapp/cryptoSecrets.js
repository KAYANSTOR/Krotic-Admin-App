/**
 * Per-network secret encryption — AES-256-GCM with env-hosted KEK.
 * Plaintext never stored in Firestore. Scale: one ciphertext blob per networkId.
 *
 * Env:
 *   WHATSAPP_SECRETS_KEK       — current 32-byte key, base64 (required for encrypt/decrypt)
 *   WHATSAPP_SECRETS_KEK_PREV  — optional previous key base64 (decrypt during rotation)
 *   WHATSAPP_SECRETS_KEY_VERSION — integer version stamped on new ciphertexts (default 1)
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function decodeKey(b64, label) {
  if (typeof b64 !== 'string' || !b64.trim()) return null;
  let buf;
  try {
    buf = Buffer.from(b64.trim(), 'base64');
  } catch {
    return null;
  }
  if (buf.length !== KEY_LEN) {
    throw new Error(`${label}_invalid_length`);
  }
  return buf;
}

export function getCurrentKek() {
  try {
    return decodeKey(process.env.WHATSAPP_SECRETS_KEK, 'kek');
  } catch {
    return null;
  }
}

export function getPreviousKek() {
  try {
    return decodeKey(process.env.WHATSAPP_SECRETS_KEK_PREV, 'kek_prev');
  } catch {
    return null;
  }
}

export function getKeyVersion() {
  const n = Number(process.env.WHATSAPP_SECRETS_KEY_VERSION || 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Encrypt plaintext secret for a network.
 * @returns {{ ok: true, envelope: object } | { ok: false, error: string }}
 */
export function encryptSecret(plaintext, { aad = '' } = {}) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return { ok: false, error: 'plaintext_empty' };
  }
  const key = getCurrentKek();
  if (!key) return { ok: false, error: 'kek_not_configured' };

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ok: true,
    envelope: {
      v: getKeyVersion(),
      alg: ALGO,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ciphertext.toString('base64'),
    },
  };
}

/**
 * Decrypt envelope. Tries current KEK then previous (rotation window).
 * @returns {{ ok: true, plaintext: string } | { ok: false, error: string }}
 */
export function decryptSecret(envelope, { aad = '' } = {}) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, error: 'envelope_invalid' };
  if (envelope.alg && envelope.alg !== ALGO) return { ok: false, error: 'alg_unsupported' };
  if (typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ct !== 'string') {
    return { ok: false, error: 'envelope_fields_missing' };
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ct = Buffer.from(envelope.ct, 'base64');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN || ct.length === 0) {
    return { ok: false, error: 'envelope_malformed' };
  }

  const keys = [getCurrentKek(), getPreviousKek()].filter(Boolean);
  if (keys.length === 0) return { ok: false, error: 'kek_not_configured' };

  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGO, key, iv);
      if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      return { ok: true, plaintext };
    } catch {
      // try next key
    }
  }
  return { ok: false, error: 'decrypt_failed' };
}

/**
 * Re-encrypt with current KEK (after rotation). Caller persists new envelope.
 */
export function reencryptSecret(envelope, { aad = '' } = {}) {
  const dec = decryptSecret(envelope, { aad });
  if (!dec.ok) return dec;
  return encryptSecret(dec.plaintext, { aad });
}

/** Safe equality for comparing secrets without leaking timing (tests). */
export function secretsEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function cryptoReadiness() {
  const hasKek = Boolean(getCurrentKek());
  const hasPrev = Boolean(getPreviousKek());
  return {
    backend: 'env_kek_aes_gcm',
    kekConfigured: hasKek,
    previousKekConfigured: hasPrev,
    keyVersion: getKeyVersion(),
    storage: 'firestore_ciphertext_per_network',
  };
}
