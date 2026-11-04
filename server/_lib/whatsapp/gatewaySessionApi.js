import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { authorizeNetworkRequest, normalizeNetworkId } from './requestAuth.js';
import { assertWhatsappEntitlementForNetwork } from './entitlementsGate.js';
import { readGatewaySessionStatus } from './gatewaySessionStatus.js';
import { callGateway, gatewayReadiness, normalizeGatewayQr } from './gatewayClient.js';

function bodyObject(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function setNoStore(res) {
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader?.('Pragma', 'no-cache');
}

function statusPayload(status) {
  return {
    status: status.status,
    ...(status.deviceName ? { deviceName: status.deviceName } : {}),
    ...(status.linkedAtMs ? { linkedAtMs: status.linkedAtMs } : {}),
    ...(status.lastSeenAtMs ? { lastSeenAtMs: status.lastSeenAtMs } : {}),
    ...(status.reasonCode ? { reasonCode: status.reasonCode } : {}),
    ...(status.engineVersion ? { engineVersion: status.engineVersion } : {}),
  };
}

async function authorize(req, res, rawNetworkId, dependencies, { requireEntitlement = true } = {}) {
  const networkId = normalizeNetworkId(rawNetworkId);
  if (!networkId) {
    res.status(400).json({ success: false, ok: false, error: 'network_id_invalid', reasonCode: 'network_id_invalid' });
    return null;
  }
  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) {
    res.status(503).json({ success: false, ok: false, error: configured?.error || 'server_not_configured', reasonCode: 'server_not_configured' });
    return null;
  }
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const db = dependencies.db || getFirestoreFn();
  const authz = await (dependencies.authorizeNetworkRequest || authorizeNetworkRequest)(req, networkId, {
    ...dependencies,
    getFirestore: getFirestoreFn,
    db,
  });
  if (!authz.ok) {
    res.status(authz.status).json({ success: false, ok: false, error: authz.error, reasonCode: authz.error });
    return null;
  }
  if (requireEntitlement) {
    const entitlement = await (dependencies.assertWhatsappEntitlementForNetwork || assertWhatsappEntitlementForNetwork)(db, networkId);
    if (!entitlement.ok) {
      res.status(entitlement.status).json({ success: false, ok: false, error: entitlement.error, reasonCode: entitlement.error });
      return null;
    }
  }
  return { ...authz, networkId };
}

function rejectCloudProvider(res, network) {
  if (network.whatsappPrimaryProvider === 'cloud_api') {
    res.status(409).json({ success: false, ok: false, error: 'cloud_api_is_active', reasonCode: 'cloud_api_is_active' });
    return true;
  }
  return false;
}

async function readStatus(req, res, dependencies = {}) {
  setNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const authz = await authorize(req, res, req.query?.networkId, dependencies);
  if (!authz) return;
  const status = await (dependencies.readGatewaySessionStatus || readGatewaySessionStatus)(authz.db, authz.networkId);
  if (!status.ok) return res.status(503).json({ success: false, error: status.error });
  return res.status(200).json({ session: statusPayload(status) });
}

async function startSession(req, res, dependencies = {}) {
  setNoStore(res);
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const input = bodyObject(req.body);
  if (!input) return res.status(400).json({ success: false, ok: false, error: 'invalid_json', reasonCode: 'invalid_json' });
  if (Object.keys(input).some((key) => key !== 'networkId')) {
    return res.status(400).json({ success: false, ok: false, error: 'client_field_forbidden', reasonCode: 'client_field_forbidden' });
  }
  const authz = await authorize(req, res, input.networkId, dependencies);
  if (!authz) return;
  if (rejectCloudProvider(res, authz.network)) return;
  const readiness = (dependencies.gatewayReadiness || gatewayReadiness)();
  if (!readiness.configured) {
    return res.status(503).json({ success: false, ok: false, error: readiness.error, reasonCode: readiness.error });
  }

  const call = dependencies.callGateway || callGateway;
  const linked = await call('/v1/session/link', {
    networkId: authz.networkId,
    method: 'POST',
    body: {},
  }, { fetch: dependencies.fetch, getConfig: dependencies.getGatewayConfig });
  if (!linked.ok) {
    return res.status(linked.status || 502).json({ success: false, ok: false, error: linked.error, reasonCode: linked.error });
  }
  let qrData = linked.data;
  let normalized = normalizeGatewayQr(qrData, dependencies.now ?? Date.now());
  if (!normalized.ok) {
    const qrResponse = await call('/v1/session/qr', {
      networkId: authz.networkId,
      method: 'POST',
      body: {},
    }, { fetch: dependencies.fetch, getConfig: dependencies.getGatewayConfig });
    if (!qrResponse.ok) {
      return res.status(qrResponse.status || 502).json({ success: false, ok: false, error: qrResponse.error, reasonCode: qrResponse.error });
    }
    qrData = qrResponse.data;
    normalized = normalizeGatewayQr(qrData, dependencies.now ?? Date.now());
  }
  if (!normalized.ok) {
    const state = typeof qrData?.status === 'string' ? qrData.status : 'qr_pending';
    if (state === 'linked') {
      const current = await (dependencies.readGatewaySessionStatus || readGatewaySessionStatus)(authz.db, authz.networkId);
      return res.status(200).json({ session: statusPayload(current) });
    }
    return res.status(502).json({ success: false, ok: false, error: normalized.error, reasonCode: normalized.error });
  }
  return res.status(200).json({
    session: {
      status: 'qr_pending',
      qrImageBase64: normalized.qrImageBase64,
      qrExpiresAtMs: normalized.qrExpiresAtMs,
    },
  });
}

async function unlinkSession(req, res, dependencies = {}) {
  setNoStore(res);
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return res.status(405).json({ success: false, ok: false, error: 'method_not_allowed', reasonCode: 'method_not_allowed' });
  }
  const input = bodyObject(req.body);
  if (!input) return res.status(400).json({ success: false, ok: false, error: 'invalid_json', reasonCode: 'invalid_json' });
  if (Object.keys(input).some((key) => key !== 'networkId')) {
    return res.status(400).json({ success: false, ok: false, error: 'client_field_forbidden', reasonCode: 'client_field_forbidden' });
  }
  const authz = await authorize(req, res, input.networkId, dependencies);
  if (!authz) return;
  if (rejectCloudProvider(res, authz.network)) return;
  const readiness = (dependencies.gatewayReadiness || gatewayReadiness)();
  if (!readiness.configured) {
    return res.status(503).json({ success: false, ok: false, error: readiness.error, reasonCode: readiness.error });
  }
  const call = dependencies.callGateway || callGateway;
  const result = await call('/v1/session/unlink', {
    networkId: authz.networkId,
    method: 'POST',
    body: {},
  }, { fetch: dependencies.fetch, getConfig: dependencies.getGatewayConfig });
  if (!result.ok && result.status !== 404) {
    return res.status(result.status || 502).json({ success: false, ok: false, error: result.error, reasonCode: result.error });
  }
  if (authz.network.whatsappPrimaryProvider === 'local_gateway_qr') {
    await authz.db.collection('networks').doc(authz.networkId).set({
      whatsappPrimaryProvider: null,
      whatsappUpdatedBy: authz.callerUid,
      whatsappUpdatedAtMs: dependencies.now ?? Date.now(),
    }, { merge: true });
  }
  return res.status(200).json({ ok: true });
}

async function generateQr(req, res, dependencies = {}) {
  setNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return res.status(405).json({ success: false, ok: false, error: 'method_not_allowed', reasonCode: 'method_not_allowed' });
  }
  // Compat path requested by the API brief. Internally it uses the same guarded POST-based gateway flow.
  req.method = 'POST';
  req.body = { networkId: req.query?.networkId };
  return startSession(req, res, dependencies);
}

export {
  generateQr as whatsappQrGenerateHandler,
  readStatus as whatsappQrStatusHandler,
  readStatus as whatsappSessionStatusHandler,
  startSession as whatsappSessionStartHandler,
  unlinkSession as whatsappSessionUnlinkHandler,
};
