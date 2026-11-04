/**
 * WhatsApp Cloud API send boundary.
 *
 * Uses per-network sealed Access Token (whatsapp_network_secrets) + phone_number_id
 * from networks/{networkId}. Never logs token or message body with secrets.
 *
 * LIVE HTTP is only performed when dependencies.fetch is provided OR
 * WHATSAPP_LIVE_SEND=1 is set. Default is dry-run safe for tests/admin.
 *
 * Meta Graph: POST /v26.0/{phone-number-id}/messages (version configurable in server env)
 * Auth: Authorization: Bearer {access-token}
 */
import { loadNetworkAccessToken, NETWORK_SECRETS_COLLECTION } from './networkTokenStore.js';
import { getMetaGraphVersion } from './secrets.js';

export const META_GRAPH_VERSION = getMetaGraphVersion();
export const META_GRAPH_BASE = 'https://graph.facebook.com';

/** Classify Meta HTTP / error payload into retry policy. */
export function classifyMetaSendError({ status, code, subcode, isTransientFlag } = {}) {
  // OAuth / permanent auth
  if (status === 401 || status === 403) {
    return { class: 'final', retryable: false, reason: 'auth_or_permission' };
  }
  if (code === 190 || code === 102) {
    return { class: 'final', retryable: false, reason: 'invalid_token' };
  }
  // Rate limit / throttle
  if (status === 429 || code === 4 || code === 80007 || code === 130429) {
    return { class: 'transient', retryable: true, reason: 'rate_limit' };
  }
  // Server errors
  if (status >= 500 || code === 1 || code === 2) {
    return { class: 'transient', retryable: true, reason: 'server_error' };
  }
  // User blocked / invalid recipient — final
  if (code === 131026 || code === 131047 || code === 131051) {
    return { class: 'final', retryable: false, reason: 'recipient_unavailable' };
  }
  if (isTransientFlag === true) {
    return { class: 'transient', retryable: true, reason: 'meta_transient_flag' };
  }
  if (status >= 400 && status < 500) {
    return { class: 'final', retryable: false, reason: 'client_error' };
  }
  return { class: 'transient', retryable: true, reason: 'unknown' };
}

export function buildCloudTextMessagePayload({ toE164, text, clientReferenceId = null }) {
  const to = String(toE164 || '').replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(to)) return { ok: false, error: 'recipient_invalid' };
  if (typeof text !== 'string' || text.length < 1 || text.length > 4096) {
    return { ok: false, error: 'text_invalid' };
  }
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text },
  };
  // Optional biz_opaque_callback_data for correlation (max 512)
  if (clientReferenceId) {
    body.biz_opaque_callback_data = String(clientReferenceId).slice(0, 512);
  }
  return { ok: true, body };
}

/**
 * Resolve credentials for a network (token + phone number id).
 * Token from sealed store; phone_number_id from network public config.
 */
export async function resolveNetworkCloudCredentials(db, networkId) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  const netSnap = await db.collection('networks').doc(networkId).get();
  if (!netSnap.exists) return { ok: false, error: 'network_not_found' };
  const net = netSnap.data() || {};
  const phoneNumberId = net.whatsappPhoneNumberId;
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    return { ok: false, error: 'phone_number_id_missing' };
  }
  if (net.whatsappCloudLinkStatus === 'unlinked') {
    return { ok: false, error: 'cloud_unlinked' };
  }
  const tokenResult = await loadNetworkAccessToken(db, networkId);
  if (!tokenResult.ok) return tokenResult;
  const secretSnap = await db.collection(NETWORK_SECRETS_COLLECTION).doc(networkId).get();
  const tokenExpiresAtMs = secretSnap.exists ? secretSnap.data()?.tokenExpiresAtMs : null;
  if (Number.isSafeInteger(tokenExpiresAtMs) && tokenExpiresAtMs <= Date.now()) {
    return { ok: false, error: 'network_token_expired' };
  }
  return {
    ok: true,
    phoneNumberId: String(phoneNumberId),
    accessToken: tokenResult.plaintext,
  };
}

function liveSendAllowed(dependencies) {
  if (typeof dependencies.fetch === 'function') return true;
  if (process.env.WHATSAPP_LIVE_SEND === '1' || process.env.WHATSAPP_LIVE_SEND === 'true') return true;
  return false;
}

/**
 * Send a text message via Cloud API (or inject fetch for tests).
 * Does NOT mutate delivery ops — caller links providerMessageId.
 */
export async function sendCloudTextMessage(db, {
  networkId,
  toE164,
  text,
  clientReferenceId = null,
}, dependencies = {}) {
  const creds = await (dependencies.resolveNetworkCloudCredentials
    || resolveNetworkCloudCredentials)(db, networkId);
  if (!creds.ok) return creds;

  const payload = buildCloudTextMessagePayload({ toE164, text, clientReferenceId });
  if (!payload.ok) return payload;

  if (!liveSendAllowed(dependencies)) {
    return {
      ok: false,
      error: 'live_send_disabled',
      note: 'Set WHATSAPP_LIVE_SEND=1 or inject fetch to enable HTTP',
      dryRun: true,
      phoneNumberId: creds.phoneNumberId,
      // never return accessToken
    };
  }

  const url = `${META_GRAPH_BASE}/${getMetaGraphVersion()}/${encodeURIComponent(creds.phoneNumberId)}/messages`;
  const fetchFn = dependencies.fetch || globalThis.fetch;
  let response;
  let responseText;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload.body),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(12_000) : undefined,
    });
    responseText = await response.text();
  } catch (error) {
    // Network failure — transient, do not log token
    console.error('meta cloud send network error', { networkId, message: error?.message });
    return {
      ok: false,
      error: 'network_error',
      classification: { class: 'transient', retryable: true, reason: 'network_error' },
    };
  }

  let json = null;
  try { json = responseText ? JSON.parse(responseText) : null; } catch { /* non-json */ }

  if (!response.ok) {
    const err = json?.error || {};
    const classification = classifyMetaSendError({
      status: response.status,
      code: err.code,
      subcode: err.error_subcode,
      isTransientFlag: err.is_transient,
    });
    console.error('meta cloud send rejected', {
      networkId,
      status: response.status,
      code: err.code,
      classification: classification.reason,
      // never log err.message if it might echo token
    });
    return {
      ok: false,
      error: 'meta_send_failed',
      httpStatus: response.status,
      metaCode: err.code ?? null,
      classification,
    };
  }

  const providerMessageId = json?.messages?.[0]?.id || null;
  if (!providerMessageId) {
    return {
      ok: false,
      error: 'meta_response_missing_message_id',
      classification: { class: 'transient', retryable: true, reason: 'malformed_success' },
    };
  }

  return {
    ok: true,
    providerMessageId,
    phoneNumberId: creds.phoneNumberId,
    contacts: json?.contacts || null,
  };
}
