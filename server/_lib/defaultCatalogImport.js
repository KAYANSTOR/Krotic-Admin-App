import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeDraftInput, validateTemplatePayload } from './templateCenter.js';

export const DEFAULT_CATALOG_IMPORTS = 'template_center_default_catalogs';
export const DEFAULT_CATALOG_IMPORT_MAX_BYTES = 150_000;
export const DEFAULT_CATALOG_IMPORT_MAX_ITEMS = 250;

const DRAFTS = 'template_center_drafts';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const ALLOWED_TOP_LEVEL = new Set([
  'catalogId',
  'catalogVersion',
  'schemaVersion',
  'source',
  'scope',
  'wallets',
  'transferTemplates',
  'outboundTemplates',
  'posTemplateDefinitions',
]);
const ITEM_FIELDS = Object.freeze({
  wallets: new Set([
    'id', 'key', 'managedBy', 'name', 'nameEn', 'packageName', 'senderId', 'sourceMode', 'status',
  ]),
  transferTemplates: new Set([
    'id', 'identifierKind', 'isActive', 'managedBy', 'name', 'pattern', 'priority',
    'requireReference', 'sampleBody', 'senderCode', 'walletId', 'walletKey',
  ]),
  outboundTemplates: new Set([
    'body', 'category', 'id', 'isActive', 'key', 'managedBy', 'requiredVariables', 'scope', 'title', 'variables',
  ]),
  posTemplateDefinitions: new Set([
    'id', 'idPattern', 'identifierKind', 'managedBy', 'name', 'noteLabel', 'pattern', 'priority',
    'requireReference', 'sampleBody', 'scope', 'senderNameLabel', 'variant',
  ]),
});
const POS_VARIANTS = new Set(['cards-to-pos', 'cards-to-pos-customer', 'balance-request']);
const IDENTIFIER_KINDS = new Set([
  'phone', 'alternativeNumber', 'account', 'senderNameOnly', 'balanceRequestCode',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function validateItemFields(listName, items) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isRecord(item)) return `${listName}[${index}]_invalid`;
    const allowed = ITEM_FIELDS[listName];
    const unknown = Object.keys(item).find((key) => !allowed.has(key));
    if (unknown) return `${listName}[${index}]_unknown_field:${unknown}`;
    if (item.managedBy !== 'seed') return `${listName}[${index}]_managed_by_invalid`;
  }
  return null;
}

function validatePosDefinitions(items) {
  const ids = new Set();
  const variants = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const at = `posTemplateDefinitions[${index}]`;
    if (!SAFE_ID.test(item.id || '') || !POS_VARIANTS.has(item.variant)) return `${at}_identity_invalid`;
    if (ids.has(item.id) || variants.has(item.variant)) return `${at}_duplicate`;
    ids.add(item.id);
    variants.add(item.variant);
    if (item.scope !== 'per_pos' || item.idPattern !== 'tpl-pos-{posId}-{variant}') return `${at}_scope_invalid`;
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) return `${at}_name_invalid`;
    if (typeof item.pattern !== 'string' || !item.pattern.trim() || item.pattern.length > 500) return `${at}_pattern_invalid`;
    if (!Number.isInteger(item.priority) || item.priority < 0 || item.priority > 9999) return `${at}_priority_invalid`;
    if (!IDENTIFIER_KINDS.has(item.identifierKind)) return `${at}_identifier_kind_invalid`;
    if (typeof item.requireReference !== 'boolean') return `${at}_require_reference_invalid`;
    if (typeof item.sampleBody !== 'string' || item.sampleBody.length > 2000) return `${at}_sample_body_invalid`;
    if (item.managedBy !== 'seed') return `${at}_managed_by_invalid`;
    for (const field of ['senderNameLabel', 'noteLabel']) {
      if (item[field] != null && (typeof item[field] !== 'string' || item[field].length > 120)) {
        return `${at}_${field}_invalid`;
      }
    }
  }
  return null;
}

/** Validates the versioned Android seed manifest and produces the current release payload. */
export function normalizeDefaultCatalogManifest(manifest, { now = Date.now() } = {}) {
  if (!isRecord(manifest)) return { ok: false, error: 'catalog_invalid' };
  const unknownTopLevel = Object.keys(manifest).find((key) => !ALLOWED_TOP_LEVEL.has(key));
  if (unknownTopLevel) return { ok: false, error: `catalog_unknown_field:${unknownTopLevel}` };
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > DEFAULT_CATALOG_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'catalog_too_large' };
  }
  if (manifest.catalogId !== 'krotak-default-seed-catalog'
      || typeof manifest.catalogVersion !== 'string' || !VERSION.test(manifest.catalogVersion)
      || manifest.schemaVersion !== 1
      || manifest.source !== 'Krotak-Pro official seeders'
      || manifest.scope !== 'seeded-defaults-only') {
    return { ok: false, error: 'catalog_header_invalid' };
  }
  for (const name of Object.keys(ITEM_FIELDS)) {
    if (!Array.isArray(manifest[name]) || manifest[name].length > DEFAULT_CATALOG_IMPORT_MAX_ITEMS) {
      return { ok: false, error: `catalog_${name}_invalid` };
    }
    const itemError = validateItemFields(name, manifest[name]);
    if (itemError) return { ok: false, error: itemError };
  }
  if (manifest.wallets.length === 0 || manifest.transferTemplates.length === 0
      || manifest.outboundTemplates.length === 0 || manifest.posTemplateDefinitions.length === 0) {
    return { ok: false, error: 'catalog_sections_empty' };
  }
  const posError = validatePosDefinitions(manifest.posTemplateDefinitions);
  if (posError) return { ok: false, error: posError };

  const createdAt = new Date(now).toISOString();
  const payload = {
    wallets: manifest.wallets.map((wallet) => ({
      ...wallet,
      createdAt: typeof wallet.createdAt === 'string' ? wallet.createdAt : createdAt,
    })),
    transferTemplates: manifest.transferTemplates,
    outboundTemplates: manifest.outboundTemplates,
  };
  const normalized = normalizeDraftInput({
    title: `كتالوج Android الافتراضي ${manifest.catalogVersion}`,
    scope: { type: 'global' },
    payload,
  });
  if (!normalized.ok) {
    return { ok: false, error: 'catalog_payload_invalid', details: normalized.details || [normalized.error] };
  }
  const publishValidation = validateTemplatePayload(normalized.value.payload, { allowDrafts: false });
  if (!publishValidation.ok) {
    return { ok: false, error: 'catalog_not_publishable', details: publishValidation.errors };
  }
  return {
    ok: true,
    value: {
      catalogId: manifest.catalogId,
      catalogVersion: manifest.catalogVersion,
      schemaVersion: manifest.schemaVersion,
      source: manifest.source,
      scope: manifest.scope,
      manifest,
      payload: normalized.value.payload,
      counts: {
        wallets: manifest.wallets.length,
        transferTemplates: manifest.transferTemplates.length,
        outboundTemplates: manifest.outboundTemplates.length,
        posTemplateDefinitions: manifest.posTemplateDefinitions.length,
      },
      contentHashSha256: canonicalSha256(manifest),
      posTemplateDefinitions: manifest.posTemplateDefinitions,
    },
  };
}

function deterministicIds(catalogId, catalogVersion) {
  const versionSlug = catalogVersion.replaceAll('.', '-');
  const base = `${catalogId}-${versionSlug}`;
  return {
    importId: `android-seed-${base}`,
    draftId: `android-seed-${base}`,
  };
}

/** Stores the complete catalog and an editable global draft atomically; never publishes it. */
export async function importDefaultCatalog({
  db,
  catalogJson,
  artifactSha256,
  actorUid,
  sourceRevision = null,
  now = Date.now(),
}) {
  if (!db || typeof db.runTransaction !== 'function' || typeof actorUid !== 'string' || !actorUid) {
    return { ok: false, status: 500, error: 'import_dependencies_invalid' };
  }
  if (sourceRevision != null && (typeof sourceRevision !== 'string' || !/^[a-f0-9]{7,40}$/i.test(sourceRevision))) {
    return { ok: false, status: 400, error: 'source_revision_invalid' };
  }
  if (typeof catalogJson !== 'string'
      || Buffer.byteLength(catalogJson, 'utf8') > DEFAULT_CATALOG_IMPORT_MAX_BYTES) {
    return { ok: false, status: 400, error: 'catalog_json_invalid' };
  }
  if (typeof artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(artifactSha256)) {
    return { ok: false, status: 400, error: 'catalog_checksum_invalid' };
  }
  const actualArtifactSha256 = createHash('sha256').update(catalogJson, 'utf8').digest('hex');
  if (actualArtifactSha256 !== artifactSha256.toLowerCase()) {
    return { ok: false, status: 400, error: 'catalog_checksum_mismatch' };
  }
  let catalog;
  try {
    catalog = JSON.parse(catalogJson);
  } catch {
    return { ok: false, status: 400, error: 'catalog_json_invalid' };
  }
  const normalized = normalizeDefaultCatalogManifest(catalog, { now });
  if (!normalized.ok) return { ...normalized, status: 400 };
  const { value } = normalized;
  const { importId, draftId } = deterministicIds(value.catalogId, value.catalogVersion);
  const importRef = db.collection(DEFAULT_CATALOG_IMPORTS).doc(importId);
  const draftRef = db.collection(DRAFTS).doc(draftId);
  const auditRef = db.collection('admin_audit_logs').doc();
  const timestampMs = Number(now);

  try {
    return await db.runTransaction(async (transaction) => {
      const [existingImport, existingDraft] = await Promise.all([
        transaction.get(importRef),
        transaction.get(draftRef),
      ]);
      if (existingImport.exists) {
        const saved = existingImport.data();
        if (saved.contentHashSha256 !== value.contentHashSha256) {
          return { ok: false, status: 409, error: 'catalog_version_conflict' };
        }
        return {
          ok: true,
          imported: false,
          alreadyImported: true,
          importId,
          draftId,
          draftAvailable: existingDraft.exists,
          artifactSha256: actualArtifactSha256,
          contentHashSha256: value.contentHashSha256,
          counts: value.counts,
          posTemplateDefinitions: { stored: true, includedInReleasePayload: false },
        };
      }
      if (existingDraft.exists) return { ok: false, status: 409, error: 'catalog_draft_conflict' };

      transaction.create(importRef, {
        catalogId: value.catalogId,
        catalogVersion: value.catalogVersion,
        schemaVersion: value.schemaVersion,
        source: value.source,
        scope: value.scope,
        sourceRevision,
        artifactSha256: actualArtifactSha256,
        contentHashSha256: value.contentHashSha256,
        counts: value.counts,
        manifest: value.manifest,
        posTemplateDefinitions: value.posTemplateDefinitions,
        draftId,
        status: 'imported',
        importedAt: FieldValue.serverTimestamp(),
        importedAtMs: timestampMs,
        importedBy: actorUid,
      });
      transaction.create(draftRef, {
        title: `كتالوج Android الافتراضي ${value.catalogVersion}`,
        scope: { type: 'global', networkId: null },
        payload: value.payload,
        baseReleaseId: null,
        origin: 'android_builtin_seed',
        catalogImportId: importId,
        catalogId: value.catalogId,
        catalogVersion: value.catalogVersion,
        catalogHashSha256: value.contentHashSha256,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
      transaction.create(auditRef, {
        action: 'ANDROID_DEFAULT_CATALOG_IMPORT',
        actorUid,
        targetType: 'template_center_catalog',
        targetId: importId,
        details: { catalogId: value.catalogId, catalogVersion: value.catalogVersion, draftId,
          contentHashSha256: value.contentHashSha256, counts: value.counts, sourceRevision },
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: timestampMs,
      });
      return {
        ok: true,
        imported: true,
        alreadyImported: false,
        importId,
        draftId,
        draftAvailable: true,
        artifactSha256: actualArtifactSha256,
        contentHashSha256: value.contentHashSha256,
        counts: value.counts,
        posTemplateDefinitions: { stored: true, includedInReleasePayload: false },
      };
    });
  } catch (error) {
    console.error('default catalog import transaction failed', error);
    return { ok: false, status: 500, error: 'catalog_import_failed' };
  }
}

export function summarizeCatalogImport(id, data) {
  return {
    id,
    catalogId: data.catalogId,
    catalogVersion: data.catalogVersion,
    schemaVersion: data.schemaVersion,
    source: data.source,
    sourceRevision: data.sourceRevision || null,
    contentHashSha256: data.contentHashSha256,
    counts: data.counts,
    draftId: data.draftId,
    status: data.status,
    importedAt: data.importedAt || null,
    importedAtMs: data.importedAtMs,
    importedBy: data.importedBy,
  };
}
