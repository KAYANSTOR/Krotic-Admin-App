import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/lib/mapWithConcurrency.js';

test('limits concurrent work and preserves input order', async () => {
  let active = 0;
  let peak = 0;

  const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return index;
  });

  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
});

test('returns an empty list without calling the mapper', async () => {
  let called = false;
  const results = await mapWithConcurrency([], 4, async () => {
    called = true;
  });

  assert.deepEqual(results, []);
  assert.equal(called, false);
});
