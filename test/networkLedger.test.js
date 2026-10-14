import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOutstanding,
  PENDING_SETTLEMENT,
  SETTLED,
  PARTIAL,
} from '../api/_lib/networkLedger.js';

test('running balance is totalCommissionDue minus totalPaidAmount, never negative', () => {
  assert.equal(computeOutstanding(1000, 400), 600);
  assert.equal(computeOutstanding(1000, 1000), 0);
  assert.equal(computeOutstanding(1000, 1200), 0);
  assert.equal(computeOutstanding(undefined, 50), 0);
});

test('ledger settlement statuses are explicit', () => {
  assert.equal(PENDING_SETTLEMENT, 'PENDING_SETTLEMENT');
  assert.equal(SETTLED, 'SETTLED');
  assert.equal(PARTIAL, 'PARTIAL');
});
