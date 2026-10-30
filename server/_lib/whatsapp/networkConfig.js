/**
 * WhatsApp settings on networks/{networkId} only (non-secret fields).
 * Secrets never live here — Secret Manager only.
 */

export const WHATSAPP_PROVIDERS = Object.freeze(['cloud_api', 'local_gateway']);
export const WHATSAPP_LINK_STATUSES = Object.freeze(['unlinked', 'linked', 'error']);

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{5,32}$/;
const WABA_ID_PATTERN = /^[0-9]{5,32}$/;

/** Normalize stored network WhatsApp config for API responses (no secrets). */
export function readNetworkWhatsappConfig(networkData = {}) {
  const provider = WHATSAPP_PROVIDERS.includes(networkData.whatsappPrimaryProvider)
    ? networkData.whatsappPrimaryProvider
    : null;
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
  const forbidden = ['accessToken', 'appSecret', 'verifyToken', 'token', 'secret', 'password'];
  for (const key of Object.keys(raw)) {
    if (forbidden.includes(key) || /secret|token|password/i.test(key)) {
      return { ok: false, error: `secret_field_forbidden:${key}` };
    }
  }

  const value = {};
  if ('whatsappPrimaryProvider' in raw) {
    if (raw.whatsappPrimaryProvider === null) {
      value.whatsappPrimaryProvider = null;
    } else if (!WHATSAPP_PROVIDERS.includes(raw.whatsappPrimaryProvider)) {
      return { ok: false, error: 'provider_invalid' };
    } else if (raw.whatsappPrimaryProvider === 'local_gateway') {
      // D4: Local Gateway not implemented — reject activation until specs approved.
      return { ok: false, error: 'local_gateway_not_enabled' };
    } else {
      value.whatsappPrimaryProvider = raw.whatsappPrimaryProvider;
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
