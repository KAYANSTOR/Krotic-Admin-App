import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOutstanding,
  PENDING_SETTLEMENT,
  SETTLED,
  PARTIAL,
  monthBounds,
  monthlySalesQuery,
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

test('calendar month bounds use Yemen local time and a half-open interval', () => {
  const bounds = monthBounds('2026-10');
  assert.equal(bounds.start.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(monthBounds('2026-13'), null);
  assert.equal(monthBounds('2026-00'), null);
  assert.equal(monthBounds('202610'), null);
});

test('monthly sales query scopes FIFO candidates to only the selected month', () => {
  const calls = [];
  const query = {
    where(...args) { calls.push(['where', ...args]); return this; },
    orderBy(...args) { calls.push(['orderBy', ...args]); return this; },
    limit(...args) { calls.push(['limit', ...args]); return this; },
  };
  const ref = { collection(name) { calls.push(['collection', name]); return query; } };
  assert.equal(monthlySalesQuery(ref, '2026-10', 400), query);
  assert.deepEqual(calls.map((call) => call[0]), ['collection', 'where', 'where', 'orderBy', 'limit']);
  assert.equal(calls[0][1], 'sales');
  assert.deepEqual(calls[1].slice(1, 3), ['createdAt', '>=']);
  assert.deepEqual(calls[2].slice(1, 3), ['createdAt', '<']);
  assert.equal(calls[3][1], 'createdAt');
  assert.equal(calls[4][1], 400);
  assert.throws(() => monthlySalesQuery(ref, '2026-13'), /month_invalid/);
});
