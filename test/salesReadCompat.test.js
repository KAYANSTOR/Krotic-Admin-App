import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSalesByIdentity,
  saleIdentityKeys,
  salesNetworkIds,
} from '../src/lib/salesReadCompat.js';

test('uses saleUuid, saleId, and document id as cross-path identity aliases', () => {
  assert.deepEqual(saleIdentityKeys({ id: 'doc-1', saleId: 'sale-1', saleUuid: 'uuid-1' }), [
    'saleUuid:uuid-1',
    'saleId:sale-1',
    'documentId:doc-1',
  ]);
  assert.deepEqual(saleIdentityKeys({ id: 'doc-2' }), ['documentId:doc-2']);
});

test('deduplicates legacy records and keeps the current networkId record', () => {
  const current = { id: 'current-doc', saleUuid: 'uuid-1', faceValue: 700, source: 'current' };
  const legacyDuplicate = { id: 'legacy-doc', saleUuid: 'uuid-1', faceValue: 500, source: 'legacy' };
  const legacyOnly = { id: 'legacy-only', saleId: 'sale-2', faceValue: 300 };

  assert.deepEqual(mergeSalesByIdentity([current], [legacyDuplicate, legacyOnly]), [current, legacyOnly]);
});

test('deduplicates by saleId or document id when saleUuid is absent', () => {
  const current = { id: 'same-doc', saleId: 'sale-1', source: 'current' };
  const duplicateBySaleId = { id: 'different-doc', saleId: 'sale-1', source: 'legacy' };
  const duplicateByDocumentId = { id: 'same-doc', source: 'legacy' };

  assert.deepEqual(mergeSalesByIdentity([current], [duplicateBySaleId, duplicateByDocumentId]), [current]);
});

test('only subscribes/reads once when networkId has not migrated', () => {
  assert.deepEqual(salesNetworkIds('uid-1', 'uid-1'), ['uid-1']);
  assert.deepEqual(salesNetworkIds('uid-1', 'NET-1'), ['NET-1', 'uid-1']);
});
