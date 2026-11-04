const GATEWAY_TIMEOUT_MS = 8_000;

function readConfig() {
  const baseUrl = String(process.env.WHATSAPP_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  const serviceToken = String(process.env.WHATSAPP_GATEWAY_SERVICE_TOKEN || '').trim();
  const enabled = process.env.WHATSAPP_GATEWAY_ENABLED === 'true';
  let validUrl = false;
  try {
    const url = new URL(baseUrl);
    validUrl = url.protocol === 'https:' || (['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:');
  } catch {}
  return { enabled, baseUrl, serviceToken, configured: enabled && validUrl && serviceToken.length >= 32 };
}

export function gatewayReadiness() {
  const config = readConfig();
  return {
    enabled: config.enabled,
    configured: config.configured,
    error: !config.enabled ? 'gateway_disabled' : (!config.configured ? 'gateway_not_configured' : null),
  };
}

/** Calls only the private service API. The service token is never returned or logged. */
export async function callGateway(path, { networkId, method = 'GET', body, deliveryId } = {}, dependencies = {}) {
  const config = (dependencies.getConfig || readConfig)();
  if (!config.configured) {
    return { ok: false, status: 503, error: !config.enabled ? 'gateway_disabled' : 'gateway_not_configured' };
  }
  const fetchFn = dependencies.fetch || globalThis.fetch;
  const url = `${config.baseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${config.serviceToken}`,
    'Content-Type': 'application/json',
    'X-Network-Id': networkId,
  };
  if (deliveryId) headers['Idempotency-Key'] = deliveryId;

  let response;
  try {
    response = await fetchFn(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify({ ...body, networkId }) } : {}),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(GATEWAY_TIMEOUT_MS) : undefined,
    });
  } catch (error) {
    console.error('whatsapp gateway request failed', { networkId, path, message: error?.name || 'network_error' });
    return { ok: false, status: 502, error: 'gateway_unavailable', uncertain: method === 'POST' };
  }

  let text = '';
  try { text = await response.text(); } catch {}
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    // Upstream bodies are deliberately not propagated; they can contain QR or session material.
    return {
      ok: false,
      status: response.status === 404 ? 404 : 502,
      error: 'gateway_request_failed',
      uncertain: method === 'POST',
    };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 502, error: 'gateway_response_invalid', uncertain: method === 'POST' };
  }
  return { ok: true, data };
}

export function normalizeGatewayQr(data, now = Date.now()) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'gateway_qr_invalid' };
  const raw = typeof data.qrImageBase64 === 'string' ? data.qrImageBase64
    : (typeof data.qrBase64 === 'string' ? data.qrBase64 : '');
  const qrImageBase64 = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  const expiresAtMs = Number(data.qrExpiresAtMs ?? data.expiresAtMs);
  if (!qrImageBase64 || qrImageBase64.length > 512 * 1024
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(qrImageBase64)
      || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now) {
    return { ok: false, error: 'gateway_qr_invalid' };
  }
  return { ok: true, qrImageBase64, qrExpiresAtMs: expiresAtMs };
}
