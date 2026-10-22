import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countReads,
  readCounters,
  resetReadCounters,
  trackRead,
  trackSnapshot,
} from '../src/lib/localDb/readMeter.js';

test('trackRead preserves the result and counts returned documents', async () => {
  resetReadCounters();
  const result = { docs: [{ id: 'one' }, { id: 'two' }], metadata: { fromCache: false } };
  const returned = await trackRead('users:list', async () => result);

  assert.equal(returned, result);
  assert.deepEqual(readCounters(), {
    total: 2,
    calls: 1,
    byLabel: {
      'users:list': {
        reads: 2,
        calls: 1,
        cacheReads: 0,
        serverReads: 2,
        unknownSourceReads: 0,
      },
    },
  });
});

test('empty queries count the minimum read and retain cache source', async () => {
  resetReadCounters();
  await trackRead('users:empty', async () => ({ docs: [], metadata: { fromCache: true } }));

  assert.equal(readCounters().total, 1);
  assert.equal(readCounters().byLabel['users:empty'].cacheReads, 1);
});

test('document reads count one existing document', async () => {
  resetReadCounters();
  await trackRead('config:read', async () => ({ exists: () => true, metadata: { fromCache: false } }));

  assert.equal(readCounters().byLabel['config:read'].reads, 1);
});

test('snapshot tracking counts initial rows and later non-removal changes', () => {
  resetReadCounters();
  trackSnapshot('sales:live', {
    size: 3,
    metadata: { fromCache: false },
    docChanges: () => [{ type: 'added' }, { type: 'modified' }, { type: 'removed' }],
  }, { initial: true });
  trackSnapshot('sales:live', {
    size: 2,
    metadata: { fromCache: false },
    docChanges: () => [{ type: 'modified' }, { type: 'removed' }],
  });
  trackSnapshot('sales:live', {
    size: 2,
    metadata: { fromCache: true },
    docChanges: () => [],
  });

  assert.equal(readCounters().total, 4);
  assert.equal(readCounters().calls, 2);
});

test('countReads groups repeated operations by label and can reset', () => {
  resetReadCounters();
  countReads('sales:list', 2);
  countReads('sales:list', 1);

  assert.equal(readCounters().byLabel['sales:list'].reads, 3);
  resetReadCounters();
  assert.deepEqual(readCounters(), { total: 0, calls: 0, byLabel: {} });
});