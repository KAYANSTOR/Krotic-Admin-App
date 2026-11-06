/**
 * Non-secret WhatsApp gateway session status (owner option 1).
 *
 * Contract: docs/contracts/whatsapp-gateway-session-status.md
 * Collection: whatsapp_gateway_sessions/{networkId}
 * Written by Vercel only after verifying a signed gateway callback; admin panel reads.
 */

export const GATEWAY_SESSIONS_COLLECTION = 'whatsapp_gateway_sessions';

/** Eight session statuses — do not invent others. */
export const GATEWAY_SESSION_STATUSES = Object.freeze([
  'unlinked',
  'qr_pending',
  'linking',
  'linked',
  'disconnected',
  'relink_required',
  'error',
  'unknown',
]);

const ALLOWED_KEYS = Object.freeze([
  'networkId',
  'status',
  'lastSeenAtMs',
  'reasonCode',
  'deviceName',
  'linkedAtMs',
  'updatedAtMs',
  'engineVersion',
]);

function isSafeInteger(n) {
  return Number.isSafeInteger(n);
}

/**
 * Validate and sanitize a status payload from the gateway service.
 * Rejects unknown keys and secret-looking fields.
 */
export function validateGatewaySessionWrite(networkId, raw) {
  if (!networkId || typeof networkId !== 'string') {
    return { ok: false, error: 'network_id_required' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'payload_invalid' };
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      return { ok: false, error: `field_forbidden:${key}` };
    }
    if (/secret|token|password|qr|sessionKey|private/i.test(key)) {
      return { ok: false, error: `secret_field_forbidden:${key}` };
    }
  }

  if (!GATEWAY_SESSION_STATUSES.includes(raw.status)) {
    return { ok: false, error: 'status_invalid' };
  }

  const data = {
    networkId,
    status: raw.status,
    lastSeenAtMs: null,
    reasonCode: null,
    deviceName: null,
    linkedAtMs: null,
    updatedAtMs: isSafeInteger(raw.updatedAtMs) ? raw.updatedAtMs : Date.now(),
    engineVersion: null,
  };

  if (raw.lastSeenAtMs != null) {
    if (!isSafeInteger(raw.lastSeenAtMs)) return { ok: false, error: 'lastSeenAtMs_invalid' };
    data.lastSeenAtMs = raw.lastSeenAtMs;
  }
  if (raw.reasonCode != null) {
    if (typeof raw.reasonCode !== 'string' || raw.reasonCode.length > 64) {
      return { ok: false, error: 'reasonCode_invalid' };
    }
    data.reasonCode = raw.reasonCode;
  }
  if (raw.deviceName != null) {
    if (typeof raw.deviceName !== 'string' || raw.deviceName.length > 64) {
      return { ok: false, error: 'deviceName_invalid' };
    }
    data.deviceName = raw.deviceName;
  }
  if (raw.linkedAtMs != null) {
    if (!isSafeInteger(raw.linkedAtMs)) return { ok: false, error: 'linkedAtMs_invalid' };
    data.linkedAtMs = raw.linkedAtMs;
  }
  if (raw.engineVersion != null) {
    if (typeof raw.engineVersion !== 'string' || raw.engineVersion.length > 32) {
      return { ok: false, error: 'engineVersion_invalid' };
    }
    data.engineVersion = raw.engineVersion;
  }

  if (data.status === 'unlinked') {
    data.reasonCode = data.reasonCode || null;
    data.deviceName = null;
    data.linkedAtMs = null;
  }

  return { ok: true, data };
}

/** Read non-secret status for admin UI. */
export async function readGatewaySessionStatus(db, networkId) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  const ref = db.collection(GATEWAY_SESSIONS_COLLECTION).doc(networkId);
  const snap = await ref.get();
  if (!snap.exists) {
    return {
      ok: true,
      networkId,
      status: 'unlinked',
      lastSeenAtMs: null,
      reasonCode: null,
      deviceName: null,
      linkedAtMs: null,
      updatedAtMs: null,
      engineVersion: null,
      present: false,
    };
  }
  const d = snap.data() || {};
  const status = GATEWAY_SESSION_STATUSES.includes(d.status) ? d.status : 'unknown';
  return {
    ok: true,
    networkId,
    status,
    lastSeenAtMs: isSafeInteger(d.lastSeenAtMs) ? d.lastSeenAtMs : null,
    reasonCode: typeof d.reasonCode === 'string' ? d.reasonCode : null,
    deviceName: typeof d.deviceName === 'string' ? d.deviceName : null,
    linkedAtMs: isSafeInteger(d.linkedAtMs) ? d.linkedAtMs : null,
    updatedAtMs: isSafeInteger(d.updatedAtMs) ? d.updatedAtMs : null,
    engineVersion: typeof d.engineVersion === 'string' ? d.engineVersion : null,
    present: true,
  };
}

/**
 * Write status from gateway service (Admin SDK).
 * Never accepts QR or secrets.
 */
export async function writeGatewaySessionStatus(db, networkId, raw) {
  const validated = validateGatewaySessionWrite(networkId, raw);
  if (!validated.ok) return validated;
  const ref = db.collection(GATEWAY_SESSIONS_COLLECTION).doc(networkId);
  await ref.set(validated.data, { merge: false });
  return { ok: true, data: validated.data };
}
