import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSettlementInput,
  settlementDocId,
} from '../api/settlement.js';
import {
  validateCancelInput,
  cancellationDocId,
} from '../api/sale/cancel.js';

test('settlement validates amount, idempotency, and explicit extension policy', () => {
  const valid = {
    uid: 'user-1',
    amountMinor: 2000,
    idempotencyKey: 'settle_abcdef12',
    extendAccess: true,
  };
  const parsed = validateSettlementInput(valid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.extensionDays, 30);
  assert.equal(validateSettlementInput({ ...valid, amountMinor: 0 }).error, 'amount_invalid');
  assert.equal(validateSettlementInput({ ...valid, idempotencyKey: 'short' }).error, 'idempotency_key_invalid');
  assert.equal(validateSettlementInput({ ...valid, extensionDays: 7 }).error, 'extension_days_invalid');
  assert.equal(validateSettlementInput({ ...valid, extendAccess: false, extensionDays: 0 }).ok, true);
});

test('settlement id is stable and scoped to uid and idempotency key', () => {
  const id = settlementDocId('user-1', 'settle_abcdef12');
  assert.equal(id, settlementDocId('user-1', 'settle_abcdef12'));
  assert.notEqual(id, settlementDocId('user-2', 'settle_abcdef12'));
  assert.notEqual(id, settlementDocId('user-1', 'settle_abcdef13'));
});

test('cancel validates immutable sale identity and requires a reason', () => {
  const valid = {
    uid: 'user-1',
    saleId: 'sale_abc-123',
    idempotencyKey: 'cancel_abcdef12',
    reason: 'إلغاء بناءً على طلب المدير',
  };
  assert.equal(validateCancelInput(valid).ok, true);
  assert.equal(validateCancelInput({ ...valid, reason: '' }).error, 'reason_required');
  assert.equal(validateCancelInput({ ...valid, saleId: 'bad id' }).error, 'sale_id_invalid');
  assert.equal(validateCancelInput({ ...valid, idempotencyKey: 'short' }).error, 'idempotency_key_invalid');
});

test('cancellation id is stable and scoped to sale operation', () => {
  const id = cancellationDocId('user-1', 'sale_abc-123', 'cancel_abcdef12');
  assert.equal(id, cancellationDocId('user-1', 'sale_abc-123', 'cancel_abcdef12'));
  assert.notEqual(id, cancellationDocId('user-1', 'sale_other', 'cancel_abcdef12'));
  assert.notEqual(id, cancellationDocId('user-1', 'sale_abc-123', 'cancel_abcdef13'));
});
