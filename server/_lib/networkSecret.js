import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from('krotak-network-secret-v1', 'utf8');
const HKDF_INFO = Buffer.from('network-secret-encryption-aes-256-gcm', 'utf8');
const MIN_MASTER_SECRET_BYTES = 32;

export function hasNetworkSecretMaster(masterSecret = process.env.KROTAK_HMAC_SECRET) {
  return typeof masterSecret === 'string' && Buffer.byteLength(masterSecret, 'utf8') >= MIN_MASTER_SECRET_BYTES;
}

function deriveEncryptionKey(masterSecret = process.env.KROTAK_HMAC_SECRET) {
  if (!hasNetworkSecretMaster(masterSecret)) throw new Error('network_secret_master_not_configured');
  return Buffer.from(hkdfSync('sha256', Buffer.from(masterSecret, 'utf8'), HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

export function generateNetworkSecret() {
  return randomBytes(32).toString('base64url');
}

/** Encrypts a network-specific HMAC key before storing it in Firestore. */
export function encryptNetworkSecret(networkSecret, masterSecret = process.env.KROTAK_HMAC_SECRET) {
  if (typeof networkSecret !== 'string' || !networkSecret) throw new Error('network_secret_invalid');
  const key = deriveEncryptionKey(masterSecret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(networkSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Decrypts a stored key using the Vercel-only master secret. */
export function decryptNetworkSecret(envelope, masterSecret = process.env.KROTAK_HMAC_SECRET) {
  const key = deriveEncryptionKey(masterSecret);
  if (typeof envelope !== 'string') throw new Error('network_secret_envelope_invalid');
  const [version, ivText, tagText, ciphertextText, extra] = envelope.split('.');
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('network_secret_envelope_invalid');
  }
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  const ciphertext = Buffer.from(ciphertextText, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error('network_secret_envelope_invalid');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('network_secret_decryption_failed');
  }
}
