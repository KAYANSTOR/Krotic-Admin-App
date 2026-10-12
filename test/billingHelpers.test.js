import test from 'node:test';
import assert from 'node:assert/strict';
import { toDate } from '../src/lib/format.js';
import {
  chunkArray,
  FIRESTORE_BATCH_LIMIT,
  getCurrentMonthKey,
  monthKeyFromDate,
} from '../src/lib/billingHelpers.js';

test('builds a month key from a Firestore Timestamp-like value', () => {
  const timestamp = { toDate: () => new Date(2024, 6, 15, 12, 30) };

  assert.equal(toDate(timestamp).getTime(), new Date(2024, 6, 15, 12, 30).getTime());
  assert.equal(monthKeyFromDate(timestamp), '2024-07');
});

test('returns null for invalid dates instead of creating an invalid month bucket', () => {
  assert.equal(monthKeyFromDate({ toDate: () => new Date('not-a-date') }), null);
  assert.equal(monthKeyFromDate('not-a-date'), null);
});

test('resolves the actual current month through the helper', () => {
  assert.equal(getCurrentMonthKey(new Date(2025, 0, 2)), '2025-01');
  assert.equal(getCurrentMonthKey(new Date(2025, 11, 31)), '2025-12');
});

test('splits more than 500 writes into safe batches of at most 450', () => {
  const items = Array.from({ length: 1001 }, (_, index) => index);
  const batches = chunkArray(items);

  assert.deepEqual(batches.map((batch) => batch.length), [450, 450, 101]);
  assert.ok(batches.every((batch) => batch.length <= FIRESTORE_BATCH_LIMIT));
  assert.deepEqual(batches.flat(), items);
});
