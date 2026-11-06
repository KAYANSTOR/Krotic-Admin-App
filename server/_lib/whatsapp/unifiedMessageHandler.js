import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { authorizeNetworkRequest, normalizeNetworkId } from './requestAuth.js';
import { assertWhatsappEntitlementForNetwork } from './entitlementsGate.js';
import { readGatewaySessionStatus } from './gatewaySessionStatus.js';
import { callGateway, gatewayReadiness } from './gatewayClient.js';
import { sendCloudTextMessage } from './metaCloudSend.js';
import { createOutboundMessageRequest, finishOutboundMessageRequest } from './messageOperations.js';

const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;

function bodyObject(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function fail(res, status, reasonCode, extra = {}) {
  return res.status(status).json({ ok: false, success: false, reasonCode, error: reasonCode, ...extra });
}

export default async function unifiedMessageHandler(req, res, dependencies = {}) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed');
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) return fail(res, 503, configured?.error || 'server_not_configured');
  const input = bodyObject(req.body);
  if (!input) return fail(res, 400, 'invalid_json');
  const allowed = new Set(['networkId', 'deliveryId', 'destination', 'body', 'templateKey', 'toE164', 'text']);
  if (Object.keys(input).some((key) => !allowed.has(key))) return fail(res, 400, 'client_field_forbidden');

  const networkId = normalizeNetworkId(input.networkId);
  const deliveryId = typeof input.deliveryId === 'string' ? input.deliveryId.trim() : '';
  const destination = String(input.destination ?? input.toE164 ?? '').trim();
  const messageBody = String(input.body ?? input.text ?? '').trim();
  const templateKey = input.templateKey == null ? null : String(input.templateKey).trim();
  if (!networkId) return fail(res, 400, 'network_id_invalid');
  if (!DELIVERY_ID_PATTERN.test(deliveryId)) return fail(res, 400, 'delivery_id_invalid');
  if (!PHONE_PATTERN.test(destination)) return fail(res, 400, 'destination_invalid');
  if (!messageBody || messageBody.length > 4096) return fail(res, 400, 'message_body_invalid');
  if (templateKey != null && (!templateKey || templateKey.length > 96)) return fail(res, 400, 'template_key_invalid');

  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const db = dependencies.db || getFirestoreFn();
  const authz = await (dependencies.authorizeNetworkRequest || authorizeNetworkRequest)(req, networkId, {
    ...dependencies,
    getFirestore: getFirestoreFn,
    db,
  });
  if (!authz.ok) return fail(res, authz.status, authz.error);

  const entitlement = await (dependencies.assertWhatsappEntitlementForNetwork || assertWhatsappEntitlementForNetwork)(db, networkId);
  if (!entitlement.ok) return fail(res, entitlement.status, entitlement.error);

  const provider = authz.network.whatsappPrimaryProvider;
  let sendProvider;
  if (provider === 'cloud_api') {
    if (authz.network.whatsappCloudLinkStatus !== 'linked') return fail(res, 409, 'cloud_api_not_linked');
    sendProvider = 'cloud_api';
  } else if (provider === 'local_gateway_qr') {
    const readiness = (dependencies.gatewayReadiness || gatewayReadiness)();
    if (!readiness.configured) return fail(res, 503, readiness.error);
    const session = await (dependencies.readGatewaySessionStatus || readGatewaySessionStatus)(db, networkId);
    if (!session.ok || session.status !== 'linked') return fail(res, 409, 'qr_session_not_linked');
    sendProvider = 'local_gateway_qr';
  } else {
    return fail(res, 409, 'whatsapp_provider_not_configured');
  }

  const now = dependencies.now ?? Date.now();
  const createRequest = dependencies.createOutboundMessageRequest || createOutboundMessageRequest;
  let claim;
  try {
    claim = await createRequest(db, {
      networkId,
      ownerUid: entitlement.ownerUid,
      deliveryId,
      destination,
      body: messageBody,
      templateKey,
      provider: sendProvider,
      now,
    });
  } catch (error) {
    console.error('whatsapp message idempotency claim failed', { networkId, code: error?.code || 'unknown' });
    return fail(res, 503, 'message_claim_failed');
  }
  if (!claim.ok) {
    return fail(res, claim.error === 'delivery_id_conflict' ? 409 : 409, claim.error, {
      ...(claim.uncertain ? { uncertain: true } : {}),
    });
  }
  if (claim.alreadySent) {
    return res.status(200).json({ ok: true, providerMessageId: claim.data.providerMessageId, duplicate: true });
  }

  let sendResult;
  let uncertain = false;
  if (sendProvider === 'cloud_api') {
    sendResult = await (dependencies.sendCloudTextMessage || sendCloudTextMessage)(db, {
      networkId,
      toE164: destination,
      text: messageBody,
      clientReferenceId: deliveryId,
    }, { fetch: dependencies.fetch });
    uncertain = Boolean(sendResult?.classification?.retryable || sendResult?.uncertain);
  } else {
    const send = dependencies.callGateway || callGateway;
    const upstream = await send('/v1/messages', {
      networkId,
      method: 'POST',
      deliveryId,
      body: { deliveryId, destination, body: messageBody, ...(templateKey ? { templateKey } : {}) },
    }, { fetch: dependencies.fetch, getConfig: dependencies.getGatewayConfig });
    if (!upstream.ok) {
      sendResult = { ok: false, error: upstream.error };
      uncertain = Boolean(upstream.uncertain);
    } else {
      const providerMessageId = upstream.data.providerMessageId || upstream.data.messageId || null;
      sendResult = upstream.data.ok === true && typeof providerMessageId === 'string' && providerMessageId.trim()
        ? { ok: true, providerMessageId: providerMessageId.trim() }
        : { ok: false, error: 'gateway_ack_invalid' };
      uncertain = Boolean(upstream.data.uncertain) || !sendResult.ok;
    }
  }

  const finish = dependencies.finishOutboundMessageRequest || finishOutboundMessageRequest;
  if (!sendResult?.ok || typeof sendResult.providerMessageId !== 'string' || !sendResult.providerMessageId.trim()) {
    const status = uncertain ? 'unknown' : 'failed';
    try {
      await finish(db, claim.requestId, { status, reasonCode: sendResult?.error || 'provider_send_failed', now: dependencies.now ?? Date.now() });
    } catch (error) {
      console.error('whatsapp message failure persistence failed', { networkId, code: error?.code || 'unknown' });
    }
    return fail(res, uncertain ? 502 : 409, uncertain ? 'delivery_outcome_unknown' : (sendResult?.error || 'provider_send_failed'), {
      ...(uncertain ? { uncertain: true } : {}),
    });
  }

  const providerMessageId = sendResult.providerMessageId.trim();
  try {
    const persisted = await finish(db, claim.requestId, { status: 'sent', providerMessageId, now: dependencies.now ?? Date.now() });
    if (!persisted.ok) return fail(res, 503, 'message_result_persist_failed', { uncertain: true });
  } catch (error) {
    console.error('whatsapp message success persistence failed', { networkId, code: error?.code || 'unknown' });
    return fail(res, 503, 'message_result_persist_failed', { uncertain: true });
  }
  return res.status(200).json({ ok: true, providerMessageId });
}
