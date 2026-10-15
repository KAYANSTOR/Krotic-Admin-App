import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePaymentInput, paymentDocId } from '../api/record-payment.js';

const valid = { uid: 'user-1', amount: 5000, month: '2026-10', idempotencyKey: 'key_abcdef12' };

test('accepts a valid payment and rejects invalid fields', () => {
  assert.equal(validatePaymentInput(valid).ok, true);
  assert.equal(validatePaymentInput({ ...valid, uid: 'bad uid!' }).error, 'uid_invalid');
  assert.equal(validatePaymentInput({ ...valid, amount: 0 }).error, 'amount_invalid');
  assert.equal(validatePaymentInput({ ...valid, amount: 1.5 }).error, 'amount_invalid');
  assert.equal(validatePaymentInput({ ...valid, month: '2026-13' }).error, 'month_invalid');
  assert.equal(validatePaymentInput({ ...valid, month: '10-2026' }).error, 'month_invalid');
  assert.equal(validatePaymentInput({ ...valid, idempotencyKey: 'short' }).error, 'idempotency_key_invalid');
});

test('payment id is deterministic per uid+key and distinct across them', () => {
  const id = paymentDocId('user-1', 'key_abcdef12');
  assert.equal(id, paymentDocId('user-1', 'key_abcdef12'));
  assert.notEqual(id, paymentDocId('user-2', 'key_abcdef12'));
  assert.notEqual(id, paymentDocId('user-1', 'key_abcdef13'));
  assert.ok(id.length <= 40);
});
