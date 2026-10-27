import test from 'node:test';
import assert from 'node:assert/strict';
import { plain } from '../src/lib/localDb/plain.js';
import {
  applyRows,
  applyTombstones,
  syncSource,
  createSyncController,
  resetLegacyDataCursorsOnce,
  importUnindexedRowsWhenCountChanges,
} from '../src/lib/localDb/syncCore.js';
import { createMemoryDb, createFakeSource } from './helpers/memoryDb.js';

test('plain converts Firestore timestamps into epoch milliseconds', () => {
  const stamp = { toMillis: () => 1700000000000 };
  assert.equal(plain(stamp), 1700000000000);
  assert.deepEqual(plain({ createdAt: stamp, amount: 100 }), { createdAt: 1700000000000, amount: 100 });
  assert.deepEqual(plain([stamp]), [1700000000000]);
  assert.equal(plain(null), null);
  assert.equal(plain('text'), 'text');
});

test('first sync downloads every document and stores the cursors', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('sales', 'sales', [
    { networkId: 'NET-1', id: 's1', updatedAtMs: 10, amount: 5 },
    { networkId: 'NET-1', id: 's2', updatedAtMs: 20, amount: 7 },
  ]);

  const result = await syncSource(localDb, source, {
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => src.pullSince(src, cursor, onRows),
  });

  assert.equal(result.changed, 2);
  assert.equal(await localDb.sales.count(), 2);
  const cursor = await localDb.sync_state.get('sales');
  assert.equal(cursor.cursorMs, 20);
});

test('second sync at the same cursor reprocesses the inclusive row safely', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('sales', 'sales', [
    { networkId: 'NET-1', id: 's1', updatedAtMs: 10 },
  ]);
  const ctx = {
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => src.pullSince(src, cursor, onRows),
  };

  await syncSource(localDb, source, ctx);
  let pullCalls = 0;
  const result = await syncSource(localDb, source, {
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => {
      pullCalls += 1;
      return src.pullSince(src, cursor, onRows);
    },
  });

  assert.equal(result.changed, 1);
  assert.equal(pullCalls, 1, 'the inclusive cursor pull rechecks rows at the saved timestamp');
});

test('sync fetches newly added rows when latest timestamp equals the saved cursor', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('sales', 'sales', [
    { networkId: 'uid-old', id: 'sale-before', updatedAtMs: 100, amount: 10 },
  ]);
  const ctx = {
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => src.pullSince(src, cursor, onRows),
  };

  await syncSource(localDb, source, ctx);
  source.rows.push({ networkId: 'uid-old', id: 'sale-new-same-ms', updatedAtMs: 100, amount: 20 });

  const result = await syncSource(localDb, source, ctx);
  assert.equal(result.changed, 2, 'equal timestamps must trigger an inclusive pull');
  assert.equal(await localDb.sales.count(), 2);
  assert.ok((await localDb.sales.toArray()).some((sale) => sale.id === 'sale-new-same-ms'));
});

test('manual legacy refresh resets entity cursors once without deleting cached data', async () => {
  const localDb = createMemoryDb();
  await localDb.sync_state.put({ key: 'sales', cursorMs: 500 });
  await localDb.sync_state.put({ key: 'payments', cursorMs: 700 });
  await localDb.sync_state.put({ key: 'users', cursorMs: 900 });
  await localDb.sync_state.put({ key: 'networks', cursorMs: 1100 });
  await localDb.sync_state.put({ key: 'audit_logs', cursorMs: 1300 });
  await localDb.sales.put({ networkId: 'NET-1', id: 'cached-sale', updatedAtMs: 12 });

  assert.equal(await resetLegacyDataCursorsOnce(localDb), true);
  assert.equal((await localDb.sync_state.get('sales')).cursorMs, 0);
  assert.equal((await localDb.sync_state.get('payments')).cursorMs, 0);
  assert.equal((await localDb.sync_state.get('users')).cursorMs, 0);
  assert.equal((await localDb.sync_state.get('networks')).cursorMs, 0);
  assert.equal((await localDb.sync_state.get('audit_logs')).cursorMs, 1300);
  assert.equal(await localDb.sales.count(), 1, 'existing local rows are retained for idempotent refresh');

  await localDb.sync_state.put({ key: 'sales', cursorMs: 1200 });
  assert.equal(await resetLegacyDataCursorsOnce(localDb), false);
  assert.equal((await localDb.sync_state.get('sales')).cursorMs, 1200);
});

test('manual history scan imports only unindexed rows and rescans only when collection count changes', async () => {
  const localDb = createMemoryDb();
  const source = { key: 'sales', table: 'sales' };
  let remoteCount = 3;
  let scanCalls = 0;
  let rows = [
    { networkId: 'uid-old', id: 'legacy-1', amount: 12 },
    { networkId: 'NET-1', id: 'current-1', updatedAtMs: 100, amount: 20 },
    { networkId: 'uid-old', id: 'legacy-zero', updatedAtMs: 0, amount: 5 },
  ];
  const options = {
    getRemoteCount: async () => remoteCount,
    scanAll: async (_src, onRows) => { scanCalls += 1; await onRows(rows); },
    now: () => 1234,
  };

  const first = await importUnindexedRowsWhenCountChanges(localDb, [source], options);
  assert.deepEqual(first, { scannedDocuments: 3, importedRows: 2, scannedSources: 1 });
  assert.equal(await localDb.sales.count(), 2);
  assert.equal(scanCalls, 1);

  const unchanged = await importUnindexedRowsWhenCountChanges(localDb, [source], options);
  assert.deepEqual(unchanged, { scannedDocuments: 0, importedRows: 0, scannedSources: 0 });
  assert.equal(scanCalls, 1, 'unchanged collections should not be rescanned');

  remoteCount = 4;
  rows = [...rows, { networkId: 'uid-old', id: 'legacy-2', amount: 17 }];
  const added = await importUnindexedRowsWhenCountChanges(localDb, [source], options);
  assert.equal(added.importedRows, 3, 'the changed count triggers an idempotent refresh of unindexed rows');
  assert.equal(await localDb.sales.count(), 3);
  assert.equal(scanCalls, 2);
});

test('empty sources skip the pull query and still pick up rows backfilled to updatedAtMs=1', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('users', 'users', []);
  let pullCalls = 0;
  const ctx = {
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => {
      pullCalls += 1;
      return src.pullSince(src, cursor, onRows);
    },
  };

  const empty = await syncSource(localDb, source, ctx);
  assert.equal(empty.changed, 0);
  assert.equal(pullCalls, 0, 'an empty source must not pay for a second read');

  source.rows = [{ uid: 'u1', networkName: 'شبكة', updatedAtMs: 1 }];
  const filled = await syncSource(localDb, source, ctx);
  assert.equal(filled.changed, 1);
  assert.equal(pullCalls, 1);
  assert.equal(await localDb.users.count(), 1);
});

test('a settled sale is updated locally instead of duplicated', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('sales', 'sales', [
    { networkId: 'NET-1', id: 's1', updatedAtMs: 10, status: 'PENDING' },
  ]);
  const ctx = {
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => src.pullSince(src, cursor, onRows),
  };
  await syncSource(localDb, source, ctx);

  source.rows = [{ networkId: 'NET-1', id: 's1', updatedAtMs: 30, status: 'SETTLED' }];
  source.rows.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  await syncSource(localDb, source, ctx);

  const rows = await localDb.sales.toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'SETTLED');
});

test('a deleted sale is removed locally through its tombstone', async () => {
  const localDb = createMemoryDb();
  await applyRows(localDb, { key: 'sales', table: 'sales' }, [
    { networkId: 'NET-1', id: 's1', updatedAtMs: 10 },
  ]);
  assert.equal(await localDb.sales.count(), 1);

  await applyTombstones(localDb, [{ collection: 'sales', networkId: 'NET-1', id: 's1' }]);
  assert.equal(await localDb.sales.count(), 0);
});

test('an interrupted page resumes from the cursor without losing rows', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('sales', 'sales', [
    { networkId: 'NET-1', id: 's1', updatedAtMs: 10 },
    { networkId: 'NET-1', id: 's2', updatedAtMs: 20 },
    { networkId: 'NET-1', id: 's3', updatedAtMs: 30 },
  ], { pageSize: 2 });

  // الفشل في منتصف الصفحة الثانية: لا يتحرك المؤشر.
  let failed = false;
  const ctx = {
    latestMs: (src) => src.latestMs(),
    pullSince: async (src, cursor, onRows) => {
      const pending = src.rows.filter((row) => row.updatedAtMs >= cursor);
      await onRows(pending.slice(0, 2));
      if (!failed) {
        failed = true;
        throw new Error('connection lost');
      }
      await onRows(pending.slice(2));
      return 30;
    },
  };

  await assert.rejects(() => syncSource(localDb, source, ctx));
  const cursorAfterFailure = await localDb.sync_state.get('sales');
  assert.equal(cursorAfterFailure, undefined, 'the cursor must not advance on a failed write');

  await syncSource(localDb, source, ctx);
  const rows = await localDb.sales.toArray();
  assert.equal(rows.length, 3, 'the interrupted sync must resume and store every row');
});

test('the sync controller throttles automatic syncs but always allows manual ones', async () => {
  const localDb = createMemoryDb();
  const source = createFakeSource('sales', 'sales', [{ networkId: 'NET-1', id: 's1', updatedAtMs: 10 }]);
  const controller = createSyncController({ minAutoIntervalMs: 60_000, now: () => Date.now() });
  controller.configure({
    latestMs: (src) => src.latestMs(),
    pullSince: (src, cursor, onRows) => src.pullSince(src, cursor, onRows),
  });

  await controller.run(localDb, [source], { reason: 'auto' });
  const throttled = await controller.run(localDb, [source], { reason: 'auto' });
  assert.equal(throttled, null, 'an automatic sync inside the interval must be skipped');

  const manual = await controller.run(localDb, [source], { reason: 'manual' });
  assert.ok(Array.isArray(manual));
});

test('the local database exposes the rows offline without any server read', async () => {
  const localDb = createMemoryDb();
  await applyRows(localDb, { key: 'users', table: 'users' }, [
    { uid: 'u1', networkId: 'NET-1', updatedAtMs: 10, networkName: 'شبكة' },
  ]);
  const users = await localDb.users.toArray();
  assert.equal(users.length, 1);
  assert.equal(users[0].networkName, 'شبكة');
});
