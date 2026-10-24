import test from 'node:test';
import assert from 'node:assert/strict';
import { plain } from '../src/lib/localDb/plain.js';
import { applyRows, applyTombstones, syncSource, createSyncController, resetSalesHistoryCursorsOnce } from '../src/lib/localDb/syncCore.js';
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

test('second sync without changes reads only the check query', async () => {
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

  assert.equal(result.changed, 0);
  assert.equal(pullCalls, 0, 'the incremental pull must be skipped when nothing changed');
});

test('manual legacy path refresh resets sales and payment cursors once without deleting cached data', async () => {
  const localDb = createMemoryDb();
  await localDb.sync_state.put({ key: 'sales', cursorMs: 500 });
  await localDb.sync_state.put({ key: 'payments', cursorMs: 700 });
  await localDb.sync_state.put({ key: 'users', cursorMs: 900 });
  await localDb.sales.put({ networkId: 'NET-1', id: 'cached-sale', updatedAtMs: 12 });

  assert.equal(await resetSalesHistoryCursorsOnce(localDb), true);
  assert.equal((await localDb.sync_state.get('sales')).cursorMs, 0);
  assert.equal((await localDb.sync_state.get('payments')).cursorMs, 0);
  assert.equal((await localDb.sync_state.get('users')).cursorMs, 900);
  assert.equal(await localDb.sales.count(), 1, 'existing local rows are retained for idempotent refresh');

  await localDb.sync_state.put({ key: 'sales', cursorMs: 1200 });
  assert.equal(await resetSalesHistoryCursorsOnce(localDb), false);
  assert.equal((await localDb.sync_state.get('sales')).cursorMs, 1200);
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
