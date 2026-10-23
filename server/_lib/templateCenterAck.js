// ============================================================
// Android template ACK — strict validation and latest-only view.
// Storage path: users/{uid}/template_acks/{deviceId} (server writes only).
// ============================================================

import { createHash } from 'node:crypto';

export const ACK_SCHEMA_VERSION = 1;
export const ACK_SUBCOLLECTION = 'template_acks';
export const ACK_OUTCOMES = Object.freeze(['applied', 'partially_applied', 'failed']);

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SAFE_SCOPE_PATTERN = /^(global|network:[A-Za-z0-9_-]{1,128})$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/** Validate the exact camelCase request sent by Android; uid/network are never accepted as authority. */
export function validateAckInput(input, { now = Date.now() } = {}) {
  if (!isPlainObject(input)) return { ok: false, error: 'ack_body_invalid' };
  const allowed = new Set([
    'action', 'ackVersion', 'installationId', 'releaseId', 'payloadHash', 'scopeKey',
    'outcome', 'appliedAt', 'insertedCount', 'conflictCount', 'parserRefreshed',
    'appVersion', 'appBuild',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return { ok: false, error: 'ack_body_invalid' };
  if (input.action !== undefined && input.action !== 'ack') return { ok: false, error: 'ack_body_invalid' };
  if (input.ackVersion !== ACK_SCHEMA_VERSION) return { ok: false, error: 'ack_version_unsupported' };
  if (typeof input.installationId !== 'string' || !DEVICE_ID_PATTERN.test(input.installationId)) {
    return { ok: false, error: 'installation_id_invalid' };
  }
  if (typeof input.releaseId !== 'string' || !RELEASE_ID_PATTERN.test(input.releaseId)) {
    return { ok: false, error: 'release_id_invalid' };
  }
  if (typeof input.payloadHash !== 'string' || !HASH_PATTERN.test(input.payloadHash)) {
    return { ok: false, error: 'payload_hash_invalid' };
  }
  if (typeof input.scopeKey !== 'string' || !SAFE_SCOPE_PATTERN.test(input.scopeKey)) {
    return { ok: false, error: 'scope_key_invalid' };
  }
  if (!ACK_OUTCOMES.includes(input.outcome)) return { ok: false, error: 'outcome_invalid' };
  if (typeof input.appliedAt !== 'string') return { ok: false, error: 'applied_at_invalid' };
  const appliedAtMs = Date.parse(input.appliedAt);
  if (!Number.isFinite(appliedAtMs) || appliedAtMs <= 0 || appliedAtMs > now + MAX_FUTURE_SKEW_MS) {
    return { ok: false, error: 'applied_at_invalid' };
  }
  if (!nonNegativeInt(input.insertedCount) || !nonNegativeInt(input.conflictCount)) {
    return { ok: false, error: 'ack_counts_invalid' };
  }
  if (typeof input.parserRefreshed !== 'boolean') return { ok: false, error: 'parser_refreshed_invalid' };
  if (typeof input.appVersion !== 'string' || !VERSION_PATTERN.test(input.appVersion)) {
    return { ok: false, error: 'app_version_invalid' };
  }
  if (input.appBuild !== undefined && !nonNegativeInt(input.appBuild)) {
    return { ok: false, error: 'app_build_invalid' };
  }
  return {
    ok: true,
    value: {
      installationId: input.installationId,
      releaseId: input.releaseId,
      payloadHash: input.payloadHash.toLowerCase(),
      scopeKey: input.scopeKey,
      outcome: input.outcome,
      appliedAtMs,
      appliedAt: new Date(appliedAtMs).toISOString(),
      insertedCount: input.insertedCount,
      conflictCount: input.conflictCount,
      parserRefreshed: input.parserRefreshed,
      appVersion: input.appVersion,
      appBuild: input.appBuild ?? null,
    },
  };
}

export function ackIdempotencyKey({ uid, installationId, releaseId, payloadHash, outcome }) {
  return createHash('sha256')
    .update([uid, installationId, releaseId, payloadHash.toLowerCase(), outcome].join('|'), 'utf8')
    .digest('hex');
}

export function verifyAck({ ack, uid, release, boundInstallationId = null }) {
  if (!release) return { ok: false, status: 404, error: 'release_not_found' };
  if (release.status !== 'published') return { ok: false, status: 409, error: 'release_not_published' };
  const expectedHash = release.payloadHashSha256 || release.payloadHash;
  if (typeof expectedHash !== 'string' || expectedHash.toLowerCase() !== ack.payloadHash) {
    return { ok: false, status: 409, error: 'payload_hash_mismatch' };
  }
  if ((release.scopeKey || 'global') !== ack.scopeKey) {
    return { ok: false, status: 409, error: 'scope_mismatch' };
  }
  if (boundInstallationId && boundInstallationId !== ack.installationId) {
    return { ok: false, status: 403, error: 'installation_mismatch' };
  }
  return {
    ok: true,
    record: {
      schemaVersion: ACK_SCHEMA_VERSION,
      uid,
      installationId: ack.installationId,
      releaseId: ack.releaseId,
      payloadHash: ack.payloadHash,
      scopeKey: ack.scopeKey,
      outcome: ack.outcome,
      appliedAt: ack.appliedAt,
      appliedAtMs: ack.appliedAtMs,
      insertedCount: ack.insertedCount,
      conflictCount: ack.conflictCount,
      parserRefreshed: ack.parserRefreshed,
      appVersion: ack.appVersion,
      appBuild: ack.appBuild,
      verified: true,
      deviceBound: Boolean(boundInstallationId),
    },
  };
}

/** Map a Firestore snake_case latest ACK to the UI model. */
export function mapAckForAdmin(id, raw = {}, uidFromPath = null) {
  const appliedAt = raw.applied_at;
  const appliedAtIso = typeof appliedAt?.toDate === 'function'
    ? appliedAt.toDate().toISOString()
    : (appliedAt instanceof Date ? appliedAt.toISOString() : (typeof appliedAt === 'string' ? appliedAt : null));
  return {
    id,
    uid: raw.uid || uidFromPath || null,
    verified: raw.writer === 'server',
    installationId: raw.device_id || id,
    networkId: raw.network_id || null,
    releaseId: raw.applied_version_id || null,
    version: raw.applied_version || null,
    versionCode: raw.applied_version_code ?? null,
    payloadHash: raw.payload_hash_sha256 || null,
    scopeKey: raw.scope_key || 'global',
    outcome: raw.outcome || 'unknown',
    parserRefreshed: raw.parser_refreshed === true,
    insertedCount: raw.inserted_count ?? 0,
    conflictCount: raw.conflict_count ?? 0,
    appVersion: raw.app_version || null,
    appBuild: raw.app_build ?? null,
    appliedAt: appliedAtIso,
    syncedAt: raw.synced_at || null,
  };
}

export function latestVerifiedAck(records = [], scopeKey = 'global') {
  return records
    .filter((record) => record?.verified === true && (record.scopeKey || 'global') === scopeKey)
    .sort((left, right) => Date.parse(right.appliedAt || 0) - Date.parse(left.appliedAt || 0))[0] || null;
}
