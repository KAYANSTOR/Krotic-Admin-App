import { createHmac } from 'node:crypto';

export function canonicalJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('status_payload_invalid');
  const sorted = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return JSON.stringify(sorted);
}

export function signGatewayStatus(secret, timestampMs, payload) {
  const message = `${timestampMs}.${canonicalJson(payload)}`;
  return `sha256=${createHmac('sha256', secret).update(message, 'utf8').digest('hex')}`;
}

export async function postGatewayStatus({ url, secret, payload, fetch = globalThis.fetch, now = Date.now() }) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'callback_url_missing' };
  const timestamp = String(now);
  let signature;
  try { signature = signGatewayStatus(secret, timestamp, payload); } catch {
    return { ok: false, error: 'callback_payload_invalid' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Timestamp': timestamp,
        'X-Gateway-Signature': signature,
        'X-Network-Id': String(payload.networkId),
      },
      body: JSON.stringify(payload),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5_000) : undefined,
    });
    if (!response.ok) return { ok: false, error: 'callback_rejected' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'callback_unavailable' };
  }
}
