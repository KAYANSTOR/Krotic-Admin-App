import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIngestInput, ackForExistingSale } from '../api/sales/ingest.js';

const base = { amountMinor: 1500, currencyCode: 'YER', createdMs: 1_700_000_000_000 };

test('ingest accepts the canonical saleUuid and the legacy saleId', () => {
  const withUuid = validateIngestInput({ ...base, saleUuid: 'sale_uuid_1' });
  assert.equal(withUuid.ok, true);
  assert.equal(withUuid.value.saleUuid, 'sale_uuid_1');
  assert.equal(withUuid.value.saleId, 'sale_uuid_1');

  const withLegacy = validateIngestInput({ ...base, saleId: 'legacy_1' });
  assert.equal(withLegacy.ok, true);
  assert.equal(withLegacy.value.saleUuid, 'legacy_1');
});

test('ingest still rejects missing/invalid ids and non-YER currency', () => {
  assert.equal(validateIngestInput(base).error, 'sale_id_required');
  assert.equal(validateIngestInput({ ...base, saleUuid: 'bad id!' }).error, 'sale_id_invalid');
  assert.equal(validateIngestInput({ ...base, saleUuid: 'ok_1', currencyCode: 'USD' }).error, 'currency_invalid');
});

test('an existing sale always returns a successful ACK (never a conflict error)', () => {
  const existing = { saleUuid: 'sale_uuid_1', payloadHash: 'hash-a' };
  const same = ackForExistingSale(existing, 'hash-a');
  assert.equal(same.status, 'ALREADY_EXISTS_ACKED');
  assert.equal(same.saleUuid, 'sale_uuid_1');
  assert.equal(same.samePayload, true);

  // استخدام معرّف قائم لحمولة مختلفة تعارض، وليس نجاح مزامنة.
  const different = ackForExistingSale(existing, 'hash-b');
  assert.equal(different.status, 'PAYLOAD_CONFLICT');
  assert.equal(different.samePayload, false);

  // توافق مع السجلات القديمة التي تحمل saleId فقط.
  const legacy = ackForExistingSale({ saleId: 'legacy_1', payloadHash: 'h' }, 'h');
  assert.equal(legacy.saleUuid, 'legacy_1');
});
