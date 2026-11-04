import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { authorizeNetworkRequest, normalizeNetworkId } from './requestAuth.js';
import { assertWhatsappEntitlementForNetwork } from './entitlementsGate.js';
import { getMetaAppId, getMetaAppSecret, getMetaGraphVersion } from './secrets.js';
import { saveNetworkAccessToken } from './networkTokenStore.js';

const GRAPH_BASE = 'https://graph.facebook.com';
const ID_PATTERN = /^[0-9]{5,32}$/;
const MAX_AUTH_CODE_LENGTH = 4096;
const REQUEST_TIMEOUT_MS = 8_000;

function bodyObject(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

async function graphRequest(url, { method = 'GET', accessToken, body, fetch: fetchFn = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
  } catch {
    return { ok: false, error: 'meta_unavailable' };
  }
  let text = '';
  try { text = await response.text(); } catch {}
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'meta_request_failed', status: response.status };
  }
  return { ok: true, data };
}

async function exchangeCode({ code, appId, appSecret, version, fetch }) {
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
  const url = `${GRAPH_BASE}/${version}/oauth/access_token?${params.toString()}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
  } catch {
    return { ok: false, error: 'meta_unavailable' };
  }
  let text = '';
  try { text = await response.text(); } catch {}
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || typeof data?.access_token !== 'string' || data.access_token.length < 20) {
    return { ok: false, error: response.status === 400 ? 'authorization_code_invalid_or_expired' : 'meta_exchange_failed' };
  }
  return { ok: true, data };
}

export default async function metaExchangeHandler(req, res, dependencies = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) return res.status(503).json({ success: false, error: configured?.error || 'server_not_configured' });
  const input = bodyObject(req.body);
  if (!input) return res.status(400).json({ success: false, error: 'invalid_json' });
  const allowedKeys = new Set(['networkId', 'code', 'wabaId', 'phoneNumberId']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return res.status(400).json({ success: false, error: 'client_field_forbidden' });
  }

  const networkId = normalizeNetworkId(input.networkId);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const wabaId = typeof input.wabaId === 'string' ? input.wabaId.trim() : '';
  const phoneNumberId = typeof input.phoneNumberId === 'string' ? input.phoneNumberId.trim() : '';
  if (!networkId) return res.status(400).json({ success: false, error: 'network_id_invalid' });
  if (!code || code.length > MAX_AUTH_CODE_LENGTH) return res.status(400).json({ success: false, error: 'authorization_code_invalid' });
  if (!ID_PATTERN.test(wabaId) || !ID_PATTERN.test(phoneNumberId)) {
    return res.status(400).json({ success: false, error: 'business_asset_id_invalid' });
  }

  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const db = dependencies.db || getFirestoreFn();
  const authz = await (dependencies.authorizeNetworkRequest || authorizeNetworkRequest)(req, networkId, {
    ...dependencies,
    getFirestore: getFirestoreFn,
    db,
  });
  if (!authz.ok) return res.status(authz.status).json({ success: false, error: authz.error });

  const entitlement = await (dependencies.assertWhatsappEntitlementForNetwork || assertWhatsappEntitlementForNetwork)(db, networkId);
  if (!entitlement.ok) return res.status(entitlement.status).json({ success: false, error: entitlement.error });

  const appIdResult = await (dependencies.getMetaAppId || getMetaAppId)();
  const appSecretResult = await (dependencies.getMetaAppSecret || getMetaAppSecret)();
  if (!appIdResult.ok || !appSecretResult.ok) {
    return res.status(503).json({ success: false, error: !appIdResult.ok ? appIdResult.error : appSecretResult.error });
  }

  const version = (dependencies.getMetaGraphVersion || getMetaGraphVersion)();
  const fetchFn = dependencies.fetch || globalThis.fetch;
  const exchanged = await exchangeCode({
    code,
    appId: appIdResult.value,
    appSecret: appSecretResult.value,
    version,
    fetch: fetchFn,
  });
  if (!exchanged.ok) return res.status(exchanged.error === 'authorization_code_invalid_or_expired' ? 400 : 502).json({ success: false, error: exchanged.error });
  const accessToken = exchanged.data.access_token;

  // Do not trust the asset IDs supplied by the client; prove the phone number is on the authorized WABA.
  const phoneUrl = `${GRAPH_BASE}/${version}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`;
  const phoneResult = await graphRequest(phoneUrl, { accessToken, fetch: fetchFn });
  if (!phoneResult.ok) return res.status(502).json({ success: false, error: 'meta_business_asset_verification_failed' });
  const phoneRows = Array.isArray(phoneResult.data.data) ? phoneResult.data.data : [];
  if (!phoneRows.some((row) => String(row?.id || '') === phoneNumberId)) {
    return res.status(403).json({ success: false, error: 'phone_number_not_in_authorized_waba' });
  }

  // Subscribe the customer Messaging/WABA account so this app receives its webhook events.
  const subscribeUrl = `${GRAPH_BASE}/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`;
  const subscribed = await graphRequest(subscribeUrl, { method: 'POST', accessToken, fetch: fetchFn });
  if (!subscribed.ok || subscribed.data.success !== true) {
    return res.status(502).json({ success: false, error: 'meta_webhook_subscription_failed' });
  }

  const rawExpiry = Number(exchanged.data.expires_in);
  const tokenExpiresAtMs = Number.isSafeInteger(rawExpiry) && rawExpiry > 0
    ? (dependencies.now ?? Date.now()) + rawExpiry * 1000
    : null;
  try {
    const updatedAtMs = dependencies.now ?? Date.now();
    const batch = db.batch();
    const stored = await (dependencies.saveNetworkAccessToken || saveNetworkAccessToken)(db, networkId, accessToken, {
      now: dependencies.now ?? Date.now(),
      actorUid: authz.callerUid,
      tokenExpiresAtMs,
      tokenType: 'embedded_signup_access_token',
      wabaId,
      phoneNumberId,
      batch,
    });
    if (!stored.ok) return res.status(503).json({ success: false, error: stored.error || 'token_storage_failed' });

    const networkRef = db.collection('networks').doc(networkId);
    batch.set(networkRef, {
      whatsappPrimaryProvider: 'cloud_api',
      whatsappCloudLinkStatus: 'linked',
      whatsappWabaId: wabaId,
      whatsappPhoneNumberId: phoneNumberId,
      whatsappTokenExpiresAtMs: tokenExpiresAtMs,
      whatsappUpdatedAtMs: updatedAtMs,
      whatsappUpdatedBy: authz.callerUid,
      updatedAtMs,
      updatedAt: dependencies.serverTimestamp ? dependencies.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
  } catch (error) {
    console.error('whatsapp meta exchange persistence failed', { networkId, code: error?.code || 'unknown' });
    return res.status(500).json({ success: false, error: 'token_storage_failed' });
  }

  return res.status(200).json({
    success: true,
    networkId,
    provider: 'cloud_api',
    linked: true,
    tokenStored: true,
    tokenExpiresAtMs,
    webhookSubscribed: true,
  });
}

export const __test = { exchangeCode, graphRequest };
