import { isValidSaleId } from '../saleIdentity.js';

/**
 * Canonical inbound event document identity.
 * Format: {providerId}_{networkId}_{inboundMessageId}
 */

const PROVIDER_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const NETWORK_PATTERN = /^(NET-\d{5,}|[A-Za-z0-9_-]{6,128})$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const WHATSAPP_PROVIDER_META = 'meta';

export function buildInboundEventDocId({ providerId, networkId, inboundMessageId }) {
  if (!PROVIDER_PATTERN.test(providerId || '')) {
    return { ok: false, error: 'provider_id_invalid' };
  }
  if (!NETWORK_PATTERN.test(networkId || '')) {
    return { ok: false, error: 'network_id_invalid' };
  }
  if (!MESSAGE_ID_PATTERN.test(inboundMessageId || '')) {
    return { ok: false, error: 'inbound_message_id_invalid' };
  }
  return {
    ok: true,
    docId: `${providerId}_${networkId}_${inboundMessageId}`,
  };
}

/**
 * Deterministic delivery operation id from network + original sale.
 * Uses a stable join (not random) so create() enforces once-only at DB level.
 */
export function buildDeliveryOperationId({ networkId, saleUuid }) {
  if (!NETWORK_PATTERN.test(networkId || '')) {
    return { ok: false, error: 'network_id_invalid' };
  }
  if (!isValidSaleId(saleUuid)) {
    return { ok: false, error: 'sale_uuid_invalid' };
  }
  return {
    ok: true,
    deliveryOperationId: `${networkId}__${saleUuid}`,
  };
}

export function parseInboundEventDocId(docId) {
  const raw = String(docId || '');
  // provider_NETWORK_message — network may contain NET-10001 (has hyphen)
  const match = /^(meta|local_gateway)_(.+?)_([A-Za-z0-9._-]{1,128})$/.exec(raw);
  if (!match) return null;
  return {
    providerId: match[1],
    networkId: match[2],
    inboundMessageId: match[3],
  };
}
