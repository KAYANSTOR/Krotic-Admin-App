import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCY,
  isWholeRiyal,
  isPositiveRiyal,
  commissionFor,
  percentToBps,
  bpsToPercent,
  commissionFromBps,
} from '../api/_lib/money.js';

test('currency is whole-riyal YER with no fils', () => {
  assert.equal(CURRENCY, 'YER');
  assert.equal(isWholeRiyal(0), true);
  assert.equal(isWholeRiyal(2500), true);
  assert.equal(isWholeRiyal(12.5), false);
  assert.equal(isWholeRiyal(-1), false);
  assert.equal(isPositiveRiyal(0), false);
  assert.equal(isPositiveRiyal(1), true);
});

test('commission rounds to the nearest whole riyal (Math.round)', () => {
  assert.equal(commissionFor(1000, 5), 50);
  assert.equal(commissionFor(1001, 5), 50); // 50.05 -> 50
  assert.equal(commissionFor(1010, 5), 51); // 50.5 -> 51
  assert.equal(commissionFor(999, 5), 50); // 49.95 -> 50
  assert.equal(commissionFor(0, 5), 0);
  assert.equal(commissionFor(1000, 0), 0);
  assert.equal(commissionFor(1000, -3), 0);
});

test('rate conversions are lossless between percent and basis points', () => {
  assert.equal(percentToBps(5), 500);
  assert.equal(percentToBps(0.5), 50);
  assert.equal(bpsToPercent(500), 5);
  assert.equal(commissionFromBps(1000, 500), 50);
  assert.equal(commissionFromBps(1000, 50), 5);
});
