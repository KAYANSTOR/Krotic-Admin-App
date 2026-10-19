import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import {
  authenticateAdmin,
  ensureFirebaseAdmin,
  getAppFirestore,
} from '../server/_lib/firebaseAdmin.js';
import {
  getTemplateCenterCatalog,
  normalizeDraftInput,
  previewOutboundTemplate,
  simulateInboundTemplates,
  validateTemplatePayload,
} from '../server/_lib/templateCenter.js';

const DRAFTS = 'template_center_drafts';
const RELEASES = 'template_center_releases';
const POINTERS = 'template_center_pointers';
const MAX_DRAFTS = 100;
const MAX_RELEASES = 100;
const SCHEMA_VERSION = 1;

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function scopeKey(scope) {
  return scope.type === 'global' ? 'global' : `network:${scope.networkId}`;
}

function sendError(res, status, error, details) {
  return res.status(status).json({ success: false, error, ...(details ? { details } : {}) });
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function authenticateUser(req) {
  const token = getBearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'missing_token' };
  try {
    const identity = await getAuth().verifyIdToken(token);
    return { ok: true, uid: identity.uid };
  } catch {
    return { ok: false, status: 401, error: 'invalid_token' };
  }
}

function auditRecord({ action, actorUid, targetId, details = {} }) {
  return {
    action,
    actorUid,
    targetType: 'template_center',
    targetId: targetId || null,
    details,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  };
}

async function listDrafts(db) {
  const snapshot = await db.collection(DRAFTS).limit(MAX_DRAFTS).get();
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .sort((left, right) => (right.updatedAt?.toMillis?.() ?? 0) - (left.updatedAt?.toMillis?.() ?? 0));
}

async function listReleases(db, scope) {
  let query = db.collection(RELEASES).orderBy('publishedAt', 'desc').limit(MAX_RELEASES);
  if (scope) query = query.where('scopeKey', '==', scopeKey(scope));
  const snapshot = await query.get();
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

async function resolvePublishedRelease(db, uid, appVersion, appBuild) {
  const userSnapshot = await db.collection('users').doc(uid).get();
  const user = userSnapshot.exists ? userSnapshot.data() : {};
  const networkId = typeof user.networkId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(user.networkId)
    ? user.networkId
    : null;
  const scopes = [];
  if (networkId) scopes.push({ type: 'network', networkId });
  scopes.push({ type: 'global' });

  for (const scope of scopes) {
    const key = scopeKey(scope);
    const pointerSnapshot = await db.collection(POINTERS).doc(key).get();
    if (!pointerSnapshot.exists) continue;
    const releaseId = pointerSnapshot.data().releaseId;
    if (typeof releaseId !== 'string') continue;
    const releaseSnapshot = await db.collection(RELEASES).doc(releaseId).get();
    if (!releaseSnapshot.exists) continue;
    const release = releaseSnapshot.data();
    if (release.status !== 'published' || release.scopeKey !== key
        || !Number.isInteger(release.minAppBuild) || release.minAppBuild < 0) continue;
    if (compareVersions(release.minAppVersion, '0.0.0') === null) continue;
    const validation = validateTemplatePayload(release.payload, { allowDrafts: false });
    if (!validation.ok) continue;
    if (release.minAppBuild > 0 && (!Number.isInteger(appBuild) || appBuild < release.minAppBuild)) continue;
    if (release.minAppVersion !== '0.0.0'
        && (!appVersion || compareVersions(appVersion, release.minAppVersion) < 0)) continue;
    return {
      source: scope.type,
      scope,
      release: { ...release, id: releaseSnapshot.id },
    };
  }
  return null;
}

function compareVersions(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string'
      || !/^\d+\.\d+\.\d+$/.test(left) || !/^\d+\.\d+\.\d+$/.test(right)) return null;
  const parse = (value) => String(value).split('.').map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  if ([...a, ...b].some((part) => !Number.isSafeInteger(part) || part < 0)) {
    return null;
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function validateCompatibility(input) {
  if (input.minAppVersion !== undefined
      && (typeof input.minAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.minAppVersion))) {
    return { ok: false, error: 'min_app_version_invalid' };
  }
  if (input.minAppBuild !== undefined
      && (!Number.isInteger(input.minAppBuild) || input.minAppBuild < 0 || input.minAppBuild > 2147483647)) {
    return { ok: false, error: 'min_app_build_invalid' };
  }
  return {
    ok: true,
    value: {
      minAppVersion: input.minAppVersion || '0.0.0',
      minAppBuild: input.minAppBuild ?? 0,
    },
  };
}

async function publishDraft(db, {
  draftId,
  draft: draftOverride,
  actorUid,
  expectedReleaseId,
  compatibility,
  rollbackOf = null,
}) {
  if (!draftOverride && (typeof draftId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(draftId))) {
    return { ok: false, status: 400, error: 'draft_id_invalid' };
  }
  let draft = draftOverride;
  if (!draft) {
    const draftSnapshot = await db.collection(DRAFTS).doc(draftId).get();
    if (!draftSnapshot.exists) return { ok: false, status: 404, error: 'draft_not_found' };
    draft = draftSnapshot.data();
  }
  const normalizedDraft = normalizeDraftInput(draft);
  if (!normalizedDraft.ok) return { ok: false, status: 400, error: 'payload_invalid', details: normalizedDraft.details || [normalizedDraft.error] };
  draft = normalizedDraft.value;
  const validation = validateTemplatePayload(draft.payload, { allowDrafts: false });
  if (!validation.ok) return { ok: false, status: 400, error: 'payload_invalid', details: validation.errors };
  const resolvedCompatibility = validateCompatibility(compatibility || {});
  if (!resolvedCompatibility.ok) return { ok: false, status: 400, error: resolvedCompatibility.error };
  const pointerRef = db.collection(POINTERS).doc(scopeKey(draft.scope));
  const releaseId = randomUUID();
  const releaseRef = db.collection(RELEASES).doc(releaseId);
  const auditRef = db.collection('admin_audit_logs').doc();
  const payloadHash = createHash('sha256').update(JSON.stringify(draft.payload), 'utf8').digest('hex');
  const releaseNumber = await db.runTransaction(async (transaction) => {
    const currentPointer = await transaction.get(pointerRef);
    const currentReleaseId = currentPointer.exists ? currentPointer.data().releaseId : null;
    if ((expectedReleaseId ?? null) !== currentReleaseId) {
      const error = new Error('release_conflict');
      error.code = 'release_conflict';
      throw error;
    }
    const previousNumber = currentPointer.exists ? Number(currentPointer.data().versionCode) || 0 : 0;
    const nextNumber = previousNumber + 1;
    transaction.create(releaseRef, {
      schemaVersion: SCHEMA_VERSION,
      releaseId,
      version: `1.0.${nextNumber}`,
      versionCode: nextNumber,
      status: 'published',
      scope: draft.scope,
      scopeKey: scopeKey(draft.scope),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      minAppVersion: resolvedCompatibility.value.minAppVersion,
      minAppBuild: resolvedCompatibility.value.minAppBuild,
      payload: draft.payload,
      payloadHashSha256: payloadHash,
      publishedAt: FieldValue.serverTimestamp(),
      publishedBy: actorUid,
      ...(rollbackOf ? { rollbackOf } : {}),
    });
    transaction.set(pointerRef, {
      releaseId,
      version: `1.0.${nextNumber}`,
      versionCode: nextNumber,
      schemaVersion: SCHEMA_VERSION,
      scope: draft.scope,
      minAppVersion: resolvedCompatibility.value.minAppVersion,
      minAppBuild: resolvedCompatibility.value.minAppBuild,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });
    transaction.create(auditRef, auditRecord({
      action: rollbackOf ? 'TEMPLATE_RELEASE_ROLLBACK' : 'TEMPLATE_RELEASE_PUBLISH',
      actorUid,
      targetId: releaseId,
      details: { scope: draft.scope, versionCode: nextNumber, rollbackOf },
    }));
    return nextNumber;
  });
  return { ok: true, releaseId, versionCode: releaseNumber };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'method_not_allowed');
  }
  const initialized = ensureFirebaseAdmin();
  if (!initialized.ok) return sendError(res, 503, initialized.error);
  const input = normalizeBody(req.body);
  if (!input) return sendError(res, 400, 'request_body_invalid');
  const db = getAppFirestore();

  if (input.action === 'read-active') {
    const caller = await authenticateUser(req);
    if (!caller.ok) return sendError(res, caller.status, caller.error);
    const appBuild = input.appBuild === undefined ? null : Number(input.appBuild);
    if (appBuild != null && (!Number.isInteger(appBuild) || appBuild < 0)) {
      return sendError(res, 400, 'app_build_invalid');
    }
    const appVersion = input.appVersion === undefined ? null : input.appVersion;
    if (appVersion != null && (typeof appVersion !== 'string' || compareVersions(appVersion, '0.0.0') === null)) {
      return sendError(res, 400, 'app_version_invalid');
    }
    try {
      const result = await resolvePublishedRelease(db, caller.uid, appVersion, appBuild);
      return res.status(200).json({ success: true, result });
    } catch (error) {
      console.error('template-center active release lookup failed', error);
      return sendError(res, 500, 'template_center_read_failed');
    }
  }

  const caller = await authenticateAdmin(req, { getAuth, getFirestore: getAppFirestore });
  if (!caller.ok) return sendError(res, caller.status, caller.error);

  try {
    switch (input.action) {
      case 'catalog':
        return res.status(200).json({ success: true, catalog: getTemplateCenterCatalog() });
      case 'list': {
        const [drafts, releases] = await Promise.all([listDrafts(db), listReleases(db)]);
        const pointersSnapshot = await db.collection(POINTERS).get();
        const pointers = pointersSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        return res.status(200).json({ success: true, drafts, releases, pointers });
      }
      case 'list-networks': {
        const snapshot = await db.collection('networks').limit(500).get();
        const networks = snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            ownerUid: data.owner_uid || data.ownerUid || null,
            name: data.name || data.network_name || data.networkName || entry.id,
          };
        });
        return res.status(200).json({ success: true, networks });
      }
      case 'save-draft': {
        const normalized = normalizeDraftInput(input.draft);
        if (!normalized.ok) return sendError(res, 400, normalized.error, normalized.details);
        const draftId = normalized.value.id || randomUUID();
        const ref = db.collection(DRAFTS).doc(draftId);
        const existing = await ref.get();
        const payload = {
          title: normalized.value.title,
          scope: normalized.value.scope,
          payload: normalized.value.payload,
          baseReleaseId: normalized.value.baseReleaseId,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.callerUid,
          ...(existing.exists ? {} : {
            createdAt: FieldValue.serverTimestamp(),
            createdBy: caller.callerUid,
          }),
        };
        const batch = db.batch();
        batch.set(ref, payload, { merge: true });
        batch.create(db.collection('admin_audit_logs').doc(), auditRecord({
          action: existing.exists ? 'TEMPLATE_DRAFT_UPDATE' : 'TEMPLATE_DRAFT_CREATE',
          actorUid: caller.callerUid,
          targetId: draftId,
          details: { scope: normalized.value.scope },
        }));
        await batch.commit();
        return res.status(existing.exists ? 200 : 201).json({ success: true, id: draftId });
      }
      case 'delete-draft': {
        if (typeof input.draftId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.draftId)) {
          return sendError(res, 400, 'draft_id_invalid');
        }
        const draftRef = db.collection(DRAFTS).doc(input.draftId);
        const draftSnapshot = await draftRef.get();
        if (!draftSnapshot.exists) return sendError(res, 404, 'draft_not_found');
        const batch = db.batch();
        batch.delete(draftRef);
        batch.create(db.collection('admin_audit_logs').doc(), auditRecord({
          action: 'TEMPLATE_DRAFT_DELETE',
          actorUid: caller.callerUid,
          targetId: input.draftId,
        }));
        await batch.commit();
        return res.status(200).json({ success: true });
      }
      case 'simulate-inbound': {
        if (!input.payload || !Array.isArray(input.payload.transferTemplates)
            || typeof input.body !== 'string' || input.body.length > 4000
            || (input.sender != null && (typeof input.sender !== 'string' || input.sender.length > 160))) {
          return sendError(res, 400, 'simulation_input_invalid');
        }
        const validation = validateTemplatePayload(input.payload);
        if (!validation.ok) return sendError(res, 400, 'simulation_input_invalid', validation.errors);
        return res.status(200).json({
          success: true,
          result: simulateInboundTemplates(input.payload, { body: input.body, sender: input.sender || '' }),
        });
      }
      case 'preview-outbound': {
        if (!input.template || typeof input.template.body !== 'string' || input.template.body.length > 2000
            || (input.values != null && (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)
              || Object.keys(input.values).length > 50
              || Object.entries(input.values).some(([key, value]) => key.length > 100
                || (typeof value === 'string' && value.length > 4000)
                || (typeof value === 'number' && !Number.isFinite(value))
                || !['string', 'number', 'boolean'].includes(typeof value) && value !== null)))) {
          return sendError(res, 400, 'preview_input_invalid');
        }
        return res.status(200).json({
          success: true,
          result: previewOutboundTemplate(input.template, input.values || {}),
        });
      }
      case 'publish': {
        const result = await publishDraft(db, {
          draftId: input.draftId,
          actorUid: caller.callerUid,
          expectedReleaseId: input.expectedReleaseId ?? null,
          compatibility: { minAppVersion: input.minAppVersion, minAppBuild: input.minAppBuild },
        });
        if (!result.ok) return sendError(res, result.status, result.error, result.details);
        return res.status(201).json({ success: true, ...result });
      }
      case 'rollback': {
        if (typeof input.releaseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.releaseId)) {
          return sendError(res, 400, 'release_id_invalid');
        }
        const releaseSnapshot = await db.collection(RELEASES).doc(input.releaseId).get();
        if (!releaseSnapshot.exists || releaseSnapshot.data().status !== 'published') {
          return sendError(res, 404, 'release_not_found');
        }
        const original = releaseSnapshot.data();
        const pointerSnapshot = await db.collection(POINTERS).doc(original.scopeKey).get();
        const currentReleaseId = pointerSnapshot.exists ? pointerSnapshot.data().releaseId : null;
        const normalizedOriginal = normalizeDraftInput({
          title: `تراجع إلى ${original.version}`,
          scope: original.scope,
          payload: original.payload,
        });
        if (!normalizedOriginal.ok) return sendError(res, 400, 'release_payload_invalid');
        const result = await publishDraft(db, {
          draft: normalizedOriginal.value,
          actorUid: caller.callerUid,
          expectedReleaseId: currentReleaseId,
          compatibility: {
            minAppVersion: original.minAppVersion,
            minAppBuild: original.minAppBuild,
          },
          rollbackOf: input.releaseId,
        });
        if (!result.ok) return sendError(res, result.status, result.error, result.details);
        return res.status(201).json({ success: true, ...result });
      }
      default:
        return sendError(res, 400, 'unknown_action');
    }
  } catch (error) {
    if (error?.code === 'release_conflict') return sendError(res, 409, 'release_conflict');
    console.error('template-center action failed', { action: input.action, error });
    return sendError(res, 500, 'template_center_failed');
  }
}

export default handler;
