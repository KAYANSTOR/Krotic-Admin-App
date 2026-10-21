import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTemplateCenterHandler } from '../server/_lib/templateCenterApi.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const catalogJson = fs.readFileSync(new URL('../contracts/fixtures/android-default-catalog-v1.json', import.meta.url), 'utf8');
const artifactSha256 = fs.readFileSync(new URL('../contracts/fixtures/android-default-catalog-v1.sha256', import.meta.url), 'utf8').trim();

function handler(db, admin = { ok: true, callerUid: 'admin-1' }) {
  return createTemplateCenterHandler({
    ensureFirebaseAdmin: () => ({ ok: true }),
    authenticateAdmin: async () => admin,
    getDb: () => db,
  });
}

function post(body) {
  return { method: 'POST', headers: {}, body };
}

test('template-center import action requires admin auth and saves the canonical catalog as an editable draft', async () => {
  const db = createFakeFirestore();
  const endpoint = handler(db);
  const response = createRes();
  await endpoint(post({ action: 'import-default-catalog', catalogJson, artifactSha256, sourceRevision: '6e8c396' }), response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.imported, true);
  assert.deepEqual(response.body.counts, {
    wallets: 6,
    transferTemplates: 13,
    outboundTemplates: 23,
    posTemplateDefinitions: 3,
  });
  const draft = db._store.get(`template_center_drafts/${response.body.draftId}`);
  assert.equal(draft.origin, 'android_builtin_seed');
  assert.equal(draft.payload.wallets[0].id, 'wallet-default-jaib');
  assert.equal(draft.payload.transferTemplates[0].walletId, 'wallet-default-jaib');
  assert.ok(db._store.has(`template_center_default_catalogs/${response.body.importId}`));

  const repeated = createRes();
  await endpoint(post({ action: 'import-default-catalog', catalogJson, artifactSha256 }), repeated);
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.body.alreadyImported, true);
});

test('template-center import action rejects a non-admin without writing catalog or draft records', async () => {
  const db = createFakeFirestore();
  const endpoint = handler(db, { ok: false, status: 403, error: 'not_admin' });
  const response = createRes();
  await endpoint(post({ action: 'import-default-catalog', catalogJson, artifactSha256 }), response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, 'not_admin');
  assert.equal(db._store.size, 0);
});

test('admin can retrieve the imported manifest and POS definitions for review', async () => {
  const db = createFakeFirestore({
    'template_center_default_catalogs/import-1': {
      manifest: { catalogId: 'krotak-default-seed-catalog', catalogVersion: '1.0.0' },
      draftId: 'draft-1',
      posTemplateDefinitions: [{ id: 'pos-default-cards-to-pos' }],
      catalogId: 'krotak-default-seed-catalog',
      catalogVersion: '1.0.0',
      schemaVersion: 1,
      source: 'Krotak-Pro official seeders',
      contentHashSha256: 'a'.repeat(64),
      counts: { wallets: 6, transferTemplates: 13, outboundTemplates: 23, posTemplateDefinitions: 3 },
      status: 'imported',
      importedAtMs: 1,
      importedBy: 'admin-1',
    },
  });
  const response = createRes();
  await handler(db)(post({ action: 'get-default-catalog-import', importId: 'import-1' }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.catalog.catalogVersion, '1.0.0');
  assert.equal(response.body.metadata.id.split('/').at(-1), 'import-1');
  assert.deepEqual(response.body.posTemplateDefinitions, [{ id: 'pos-default-cards-to-pos' }]);
});
