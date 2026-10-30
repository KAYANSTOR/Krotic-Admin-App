/**
 * Meta webhook signature verification (X-Hub-Signature-256).
 * Pure crypto — no Firestore, no secrets storage.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * @param {string|Buffer} rawBody - exact raw request body bytes/string used by Meta
 * @param {string} signatureHeader - value of X-Hub-Signature-256 (e.g. "sha256=...")
 * @param {string} appSecret - Meta App Secret (from Secret Manager at call site)
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (typeof appSecret !== 'string' || appSecret.length < 8) {
    return { ok: false, error: 'app_secret_missing' };
  }
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, error: 'signature_missing' };
  }
  const providedHex = signatureHeader.slice('sha256='.length).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(providedHex)) {
    return { ok: false, error: 'signature_malformed' };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const expected = createHmac('sha256', appSecret).update(body).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(providedHex.toLowerCase(), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'signature_mismatch' };
  }
  return { ok: true };
}

/**
 * Meta subscription verification (GET hub.verify_token).
 * @returns {{ ok: true, challenge: string } | { ok: false, error: string }}
 */
export function verifyMetaSubscription({ mode, token, challenge, expectedToken }) {
  if (mode !== 'subscribe') return { ok: false, error: 'hub_mode_invalid' };
  if (typeof expectedToken !== 'string' || expectedToken.length < 8) {
    return { ok: false, error: 'verify_token_not_configured' };
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, error: 'hub_verify_token_missing' };
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, error: 'hub_verify_token_mismatch' };
  }
  if (challenge == null || String(challenge).length === 0) {
    return { ok: false, error: 'hub_challenge_missing' };
  }
  return { ok: true, challenge: String(challenge) };
}
