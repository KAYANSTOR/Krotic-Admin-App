import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSettlementInput,
  settlementDocId,
  settlementNotification,
} from '../api/settlement.js';

test('settlement validates amount, month, idempotency, and extension policy', () => {
  const valid = {
    uid: 'user-1',
    amountMinor: 2000,
    month: '2026-10',
    idempotencyKey: 'settle_abcdef12',
    extendAccess: true,
  };
  const parsed = validateSettlementInput(valid);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.extensionDays, 30);
  assert.equal(validateSettlementInput({ ...valid, amountMinor: 0 }).error, 'amount_invalid');
  assert.equal(validateSettlementInput({ ...valid, idempotencyKey: 'short' }).error, 'idempotency_key_invalid');
  assert.equal(validateSettlementInput({ ...valid, month: '2026-13' }).error, 'month_invalid');
  assert.equal(validateSettlementInput({ ...valid, extensionDays: 7 }).error, 'extension_days_invalid');
  assert.equal(validateSettlementInput({ ...valid, extendAccess: false, extensionDays: 0 }).ok, true);
});

test('settlement id is stable and scoped to uid and idempotency key', () => {
  const id = settlementDocId('user-1', 'settle_abcdef12');
  assert.equal(id, settlementDocId('user-1', 'settle_abcdef12'));
  assert.notEqual(id, settlementDocId('user-2', 'settle_abcdef12'));
  assert.notEqual(id, settlementDocId('user-1', 'settle_abcdef13'));
});

test('settlement notification includes the selected month and amount', () => {
  const notification = settlementNotification({ month: '2026-10', amountMinor: 2500 }, 'settlement-1', 'admin-1');
  assert.equal(notification.type, 'settlement_approved');
  assert.match(notification.title, /تسوية/);
  assert.match(notification.message, /أكتوبر/);
  assert.match(notification.message, /٢٬٥٠٠|2500/);
  assert.equal(notification.settlementId, 'settlement-1');
  assert.equal(notification.is_read, false);
});
