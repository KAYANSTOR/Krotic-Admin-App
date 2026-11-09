// ============================================================
// HTTP client to the Railway WhatsApp gateway (server-to-server only).
// Secrets stay on Vercel; the Flutter app never sees them.
// ============================================================

const DEFAULT_TIMEOUT_MS = 25_000;

function gatewayConfig(env = process.env) {
  const baseUrl = String(env.WHATSAPP_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.WHATSAPP_GATEWAY_SERVICE_TOKEN || '').trim();
  return { baseUrl, token };
}

export function gatewayConfigured(env = process.env) {
  const { baseUrl, token } = gatewayConfig(env);
  return Boolean(baseUrl && /^https:\/\//.test(baseUrl) && token.length >= 32);
}

/**
 * @param {{ method?: string, path: string, body?: object, query?: Record<string,string>, timeoutMs?: number }} opts
 */
export async function callGateway(opts, env = process.env) {
  const { baseUrl, token } = gatewayConfig(env);
  if (!baseUrl || !token) {
    return { ok: false, status: 503, error: 'whatsapp_gateway_not_configured' };
  }
  if (token.length < 32) {
    return { ok: false, status: 503, error: 'whatsapp_gateway_token_weak' };
  }

  const url = new URL(baseUrl + opts.path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const method = opts.method || 'GET';
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
  let body;
  if (opts.body != null) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut ? 'whatsapp_gateway_timeout' : 'whatsapp_gateway_unreachable',
    };
  }

  let payload = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 200) }; }
  }

  if (!res.ok) {
    const code = (payload && typeof payload.error === 'string' && payload.error)
      || (payload && typeof payload.code === 'string' && payload.code)
      || `gateway_http_${res.status}`;
    return { ok: false, status: res.status >= 400 && res.status < 600 ? res.status : 502, error: code, payload };
  }

  return { ok: true, status: res.status, payload: payload || {} };
}
