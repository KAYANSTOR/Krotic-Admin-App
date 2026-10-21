import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalSha256,
  importDefaultCatalog,
  normalizeDefaultCatalogManifest,
} from '../server/_lib/defaultCatalogImport.js';
import {
  ANDROID_DEFAULT_INBOUND_TEMPLATES,
  ANDROID_DEFAULT_OUTBOUND_TEMPLATES,
  ANDROID_DEFAULT_POS_TEMPLATE_SPECS,
  ANDROID_DEFAULT_WALLETS,
} from '../src/lib/androidSeedCatalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, '../contracts/fixtures/android-default-catalog-v1.json');
const manifestBytes = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestBytes);
const artifactSha256 = fs.readFileSync(
  path.join(here, '../contracts/fixtures/android-default-catalog-v1.sha256'), 'utf8',
).trim();
const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key] ?? null]));
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('checked-in Android manifest matches its raw SHA-256 sidecar', () => {
  assert.equal(artifactSha256.length, 64);
  assert.equal(artifactSha256, sha256(manifestBytes));
});

test('Admin seed arrays exactly mirror the Android manifest, including stable wallet IDs', () => {
  assert.deepEqual(
    ANDROID_DEFAULT_WALLETS.map((item) => pick(item, ['id', 'key', 'name', 'nameEn', 'sourceMode', 'senderId', 'packageName'])),
    manifest.wallets.map((item) => pick(item, ['id', 'key', 'name', 'nameEn', 'sourceMode', 'senderId', 'packageName'])),
  );
  assert.deepEqual(
    ANDROID_DEFAULT_INBOUND_TEMPLATES.map((item) => pick(item, [
      'id', 'walletId', 'walletKey', 'name', 'pattern', 'isActive', 'priority',
      'sampleBody', 'senderCode', 'identifierKind', 'requireReference',
    ])),
    manifest.transferTemplates.map((item) => pick(item, [
      'id', 'walletId', 'walletKey', 'name', 'pattern', 'isActive', 'priority',
      'sampleBody', 'senderCode', 'identifierKind', 'requireReference',
    ])),
  );
  assert.deepEqual(
    ANDROID_DEFAULT_OUTBOUND_TEMPLATES.map((item) => pick(item, ['key', 'body'])),
    manifest.outboundTemplates.map((item) => pick(item, ['key', 'body'])),
  );
  assert.deepEqual(
    ANDROID_DEFAULT_POS_TEMPLATE_SPECS.map((item) => pick(item, [
      'variant', 'name', 'pattern', 'priority', 'sampleBody', 'identifierKind',
      'senderNameLabel', 'noteLabel', 'requireReference',
    ])),
    manifest.posTemplateDefinitions.map((item) => pick(item, [
      'variant', 'name', 'pattern', 'priority', 'sampleBody', 'identifierKind',
      'senderNameLabel', 'noteLabel', 'requireReference',
    ])),
  );
});

test('canonical Android manifest validates as a publishable global draft payload', () => {
  const result = normalizeDefaultCatalogManifest(manifest, { now: Date.UTC(2026, 9, 21) });
  assert.equal(result.ok, true, result.error || JSON.stringify(result.details));
  assert.deepEqual(result.value.counts, {
    wallets: 6,
    transferTemplates: 13,
    outboundTemplates: 23,
    posTemplateDefinitions: 3,
  });
  assert.equal(result.value.payload.wallets[0].id, 'wallet-default-jaib');
  assert.equal(result.value.payload.transferTemplates[0].walletId, 'wallet-default-jaib');
  assert.equal(result.value.contentHashSha256, canonicalSha256(manifest));
});

test('manifest importer rejects a slug wallet ID or mismatched template wallet link', () => {
  const badId = structuredClone(manifest);
  badId.wallets[0].id = 'jaib';
  for (const template of badId.transferTemplates) {
    if (template.walletKey === 'Jaib') template.walletId = 'jaib';
  }
  const idResult = normalizeDefaultCatalogManifest(badId);
  assert.equal(idResult.ok, false);
  assert.equal(idResult.error, 'wallets[0]_canonical_id_mismatch');

  const badLink = structuredClone(manifest);
  badLink.transferTemplates[0].walletKey = 'Jawali';
  const linkResult = normalizeDefaultCatalogManifest(badLink);
  assert.equal(linkResult.ok, false);
  assert.equal(linkResult.error, 'transferTemplates[0]_wallet_link_invalid');
});

function createFakeDb() {
  const records = new Map();
  const makeRef = (collectionName, id) => ({ collectionName, id, path: `${collectionName}/${id}` });
  const db = {
    records,
    collection(name) {
      return { doc(id) { return makeRef(name, id); } };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(ref) {
          const value = records.get(ref.path);
          return { exists: value !== undefined, data: () => value };
        },
        create(ref, value) { writes.push([ref.path, value]); },
      };
      const result = await callback(transaction);
      if (result.ok) for (const [key, value] of writes) records.set(key, value);
      return result;
    },
  };
  return db;
}

test('import verifies raw checksum, saves an editable draft once, and is idempotent', async () => {
  const db = createFakeDb();
  const mismatch = await importDefaultCatalog({
    db,
    catalogJson: manifestBytes,
    artifactSha256: '0'.repeat(64),
    actorUid: 'admin-1',
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'catalog_checksum_mismatch');
  assert.equal(db.records.size, 0);

  const first = await importDefaultCatalog({
    db,
    catalogJson: manifestBytes,
    artifactSha256,
    actorUid: 'admin-1',
    sourceRevision: '6e8c396',
    now: Date.UTC(2026, 9, 21),
  });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.imported, true);
  assert.deepEqual(first.counts, {
    wallets: 6,
    transferTemplates: 13,
    outboundTemplates: 23,
    posTemplateDefinitions: 3,
  });
  assert.equal(db.records.get(`template_center_drafts/${first.draftId}`).payload.wallets[0].id, 'wallet-default-jaib');

  const second = await importDefaultCatalog({
    db,
    catalogJson: manifestBytes,
    artifactSha256,
    actorUid: 'admin-2',
    now: Date.UTC(2026, 9, 22),
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyImported, true);
  assert.equal(db.records.size, 3);
});
