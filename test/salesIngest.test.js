import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIngestInput,
  canonicalSalePayload,
  computePayloadHash,
  canonicalReceiptPayload,
  createInternalReceipt,
  verifyInternalReceipt,
} from '../api/sales/ingest.js';

const validBody = {
  saleId: 'sale_abc-123',
  amountMinor: 1500,
  currencyCode: 'yer',
  createdMs: 1_700_000_000_000,
  customerId: 'cust-1',
  cardId: 'card-9',
};

test('accepts a well-formed sale payload and normalizes the currency', () => {
  const result = validateIngestInput(validBody);
  assert.equal(result.ok, true);
  assert.equal(result.value.currencyCode, 'YER');
  assert.equal(result.value.amountMinor, 1500);
});

test('rejects malformed sale ids, amounts, currency, and timestamps', () => {
  assert.equal(validateIngestInput({ ...validBody, saleId: '' }).error, 'sale_id_required');
  assert.equal(validateIngestInput({ ...validBody, saleId: 'bad id!' }).error, 'sale_id_invalid');
  assert.equal(validateIngestInput({ ...validBody, amountMinor: 0 }).error, 'amount_invalid');
  assert.equal(validateIngestInput({ ...validBody, amountMinor: 12.5 }).error, 'amount_invalid');
  assert.equal(validateIngestInput({ ...validBody, currencyCode: '' }).error, 'currency_invalid');
  assert.equal(validateIngestInput({ ...validBody, createdMs: 0 }).error, 'created_at_invalid');
});

test('payload hash is stable, server-side, and changes with content', () => {
  const payload = { ...validBody, uid: 'user-1' };
  const hash = computePayloadHash(payload);
  assert.equal(hash.length, 64);
  assert.equal(hash, computePayloadHash({ ...validBody, uid: 'user-1' }));
  assert.notEqual(hash, computePayloadHash({ ...validBody, uid: 'user-2' }));
  assert.notEqual(hash, computePayloadHash({ ...validBody, uid: 'user-1', amountMinor: 1501 }));
});

test('canonical representation pins the uid and field order', () => {
  const canonical = canonicalSalePayload({ ...validBody, uid: 'user-1' });
  assert.match(canonical, /"uid":"user-1"/);
  assert.equal(canonical, JSON.stringify({
    saleId: validBody.saleId,
    uid: 'user-1',
    amountMinor: validBody.amountMinor,
    currencyCode: validBody.currencyCode,
    customerId: validBody.customerId,
    cardId: validBody.cardId,
    createdMs: validBody.createdMs,
  }));
});

test('internal HMAC receipt verifies the exact sale payload and expires', () => {
  const payload = { ...validBody, uid: 'user-1', currencyCode: 'YER' };
  const timestamp = 1_700_000_000_000;
  const secret = 'staging-only-test-secret';
  const token = createInternalReceipt({ payload, timestamp, secret });

  assert.equal(canonicalReceiptPayload(payload, timestamp).startsWith(`${timestamp}.`), true);
  assert.equal(verifyInternalReceipt({ token, payload, secret, now: timestamp }).ok, true);
  assert.equal(verifyInternalReceipt({
    token,
    payload: { ...payload, amountMinor: 1501 },
    secret,
    now: timestamp,
  }).error, 'hmac_invalid');
  assert.equal(verifyInternalReceipt({
    token,
    payload,
    secret,
    now: timestamp + 6 * 60 * 1000,
  }).error, 'hmac_expired_or_malformed');
});
