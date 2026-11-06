/**
 * WhatsApp settings on networks/{networkId} only (non-secret fields).
 * Secrets never live here — Secret Manager / gateway vault only.
 *
 * Contract: docs/contracts/whatsapp-gateway-api.md
 * Session status (gateway): docs/contracts/whatsapp-gateway-session-status.md
 */

import { gatewayReadiness } from './gatewayClient.js';

export const WHATSAPP_PROVIDERS = Object.freeze(['cloud_api', 'local_gateway_qr']);

/** @deprecated alias — prefer local_gateway_qr */
export const LEGACY_LOCAL_GATEWAY = 'local_gateway';

export const WHATSAPP_LINK_STATUSES = Object.freeze(['unlinked', 'linked', 'error']);

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{5,32}$/;
const WABA_ID_PATTERN = /^[0-9]{5,32}$/;

function normalizeProvider(raw) {
  if (raw === LEGACY_LOCAL_GATEWAY) return 'local_gateway_qr';
  if (WHATSAPP_PROVIDERS.includes(raw)) return raw;
  return null;
}

/** Normalize stored network WhatsApp config for API responses (no secrets). */
export function readNetworkWhatsappConfig(networkData = {}) {
  const provider = normalizeProvider(networkData.whatsappPrimaryProvider);
  const linkStatus = WHATSAPP_LINK_STATUSES.includes(networkData.whatsappCloudLinkStatus)
    ? networkData.whatsappCloudLinkStatus
    : 'unlinked';
  return {
    whatsappPrimaryProvider: provider,
    whatsappCloudLinkStatus: linkStatus,
    whatsappPhoneNumberId: typeof networkData.whatsappPhoneNumberId === 'string'
      ? networkData.whatsappPhoneNumberId
      : null,
    whatsappWabaId: typeof networkData.whatsappWabaId === 'string'
      ? networkData.whatsappWabaId
      : null,
    whatsappDisplayHint: typeof networkData.whatsappDisplayHint === 'string'
      ? networkData.whatsappDisplayHint
      : null,
    whatsappUpdatedAtMs: Number.isSafeInteger(networkData.whatsappUpdatedAtMs)
      ? networkData.whatsappUpdatedAtMs
      : null,
    whatsappUpdatedBy: typeof networkData.whatsappUpdatedBy === 'string'
      ? networkData.whatsappUpdatedBy
      : null,
  };
}

/**
 * Validate admin input for network WhatsApp settings.
 * Rejects unknown keys and any secret-looking fields.
 */
export function validateNetworkWhatsappInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'payload_invalid' };
  }
  const forbidden = ['accessToken', 'appSecret', 'verifyToken', 'token', 'secret', 'password', 'qr', 'session'];
  for (const key of Object.keys(raw)) {
    if (forbidden.includes(key) || /secret|token|password|qr|session/i.test(key)) {
      return { ok: false, error: `secret_field_forbidden:${key}` };
    }
  }

  const value = {};
  if ('whatsappPrimaryProvider' in raw) {
    if (raw.whatsappPrimaryProvider === null) {
      value.whatsappPrimaryProvider = null;
    } else {
      const normalized = normalizeProvider(raw.whatsappPrimaryProvider);
      if (!normalized) {
        return { ok: false, error: 'provider_invalid' };
      }
      if (normalized === 'local_gateway_qr' && !gatewayReadiness().configured) {
        // Explicitly fail closed until the persistent QR service has passed its PoC gate.
        return { ok: false, error: 'local_gateway_qr_not_enabled' };
      }
      value.whatsappPrimaryProvider = normalized;
    }
  }
  if ('whatsappCloudLinkStatus' in raw) {
    if (!WHATSAPP_LINK_STATUSES.includes(raw.whatsappCloudLinkStatus)) {
      return { ok: false, error: 'link_status_invalid' };
    }
    value.whatsappCloudLinkStatus = raw.whatsappCloudLinkStatus;
  }
  if ('whatsappPhoneNumberId' in raw) {
    if (raw.whatsappPhoneNumberId === null || raw.whatsappPhoneNumberId === '') {
      value.whatsappPhoneNumberId = null;
    } else if (!PHONE_NUMBER_ID_PATTERN.test(String(raw.whatsappPhoneNumberId))) {
      return { ok: false, error: 'phone_number_id_invalid' };
    } else {
      value.whatsappPhoneNumberId = String(raw.whatsappPhoneNumberId);
    }
  }
  if ('whatsappWabaId' in raw) {
    if (raw.whatsappWabaId === null || raw.whatsappWabaId === '') {
      value.whatsappWabaId = null;
    } else if (!WABA_ID_PATTERN.test(String(raw.whatsappWabaId))) {
      return { ok: false, error: 'waba_id_invalid' };
    } else {
      value.whatsappWabaId = String(raw.whatsappWabaId);
    }
  }
  if ('whatsappDisplayHint' in raw) {
    if (raw.whatsappDisplayHint === null || raw.whatsappDisplayHint === '') {
      value.whatsappDisplayHint = null;
    } else if (typeof raw.whatsappDisplayHint !== 'string' || raw.whatsappDisplayHint.length > 32) {
      return { ok: false, error: 'display_hint_invalid' };
    } else {
      value.whatsappDisplayHint = raw.whatsappDisplayHint;
    }
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'no_fields' };
  }
  return { ok: true, value };
}
