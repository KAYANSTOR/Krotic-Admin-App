import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_DATA_CACHE_PREFIX,
  LOCAL_CACHE_TTL,
  buildAdminDataStorageKey,
  createAdminDataCache,
  withAdminDataCacheMetadata,
} from '../src/lib/adminDataCache.js';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    keys() { return [...values.keys()]; },
  };
}

test('builds a custom cache key that is always scoped to the UID', () => {
  assert.equal(buildAdminDataStorageKey('admin/one', 'dashboard'), `${ADMIN_DATA_CACHE_PREFIX}admin%2Fone:dashboard`);
  assert.notEqual(buildAdminDataStorageKey('admin-a', 'dashboard'), buildAdminDataStorageKey('admin-b', 'dashboard'));
  assert.equal(buildAdminDataStorageKey(null, 'dashboard'), null);
});

test('does not serve one UID from another UID scope', async () => {
  const storage = fakeStorage();
  let uid = 'admin-a';
  const cache = createAdminDataCache({ getUid: () => uid, getStorage: () => storage });

  assert.deepEqual(await cache.readCached('dashboard', async () => ({ owner: uid })), { owner: 'admin-a' });
  uid = 'admin-b';
  assert.deepEqual(await cache.readCached('dashboard', async () => ({ owner: uid })), { owner: 'admin-b' });
  assert.ok(storage.keys().includes(buildAdminDataStorageKey('admin-a', 'dashboard')));
  assert.ok(storage.keys().includes(buildAdminDataStorageKey('admin-b', 'dashboard')));
});

test('clear removes only the application custom namespace', async () => {
  const storage = fakeStorage({ 'krotak:filter': 'all' });
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  await cache.readCached('dashboard', async () => ({ ok: true }));
  cache.clear();
  assert.equal(storage.getItem('krotak:filter'), 'all');
  assert.deepEqual(storage.keys(), ['krotak:filter']);
});

test('invalidates only the selected cache keys for the current UID', async () => {
  const storage = fakeStorage();
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  await cache.readCached('all-users', async () => [{ uid: 'one' }]);
  await cache.readCached('dashboard-stats', async () => ({ totalUsers: 1 }));

  cache.invalidate(['all-users']);
  assert.equal(cache.getState('all-users'), null);
  assert.ok(cache.getState('dashboard-stats'));
  assert.equal(storage.getItem(buildAdminDataStorageKey('admin-a', 'all-users')), null);
  assert.ok(storage.getItem(buildAdminDataStorageKey('admin-a', 'dashboard-stats')));
});

test('invalidates a UID-owned cache-key prefix without touching another entity', async () => {
  const storage = fakeStorage();
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  await cache.readCached('aggregate:user-1:5', async () => ({ rate: 5 }));
  await cache.readCached('aggregate:user-1:10', async () => ({ rate: 10 }));
  await cache.readCached('aggregate:user-2:5', async () => ({ rate: 5 }));

  cache.invalidate(['aggregate:user-1:*']);
  assert.equal(cache.getState('aggregate:user-1:5'), null);
  assert.equal(cache.getState('aggregate:user-1:10'), null);
  assert.ok(cache.getState('aggregate:user-2:5'));
  assert.equal(storage.getItem(buildAdminDataStorageKey('admin-a', 'aggregate:user-1:10')), null);
  assert.ok(storage.getItem(buildAdminDataStorageKey('admin-a', 'aggregate:user-2:5')));
});

test('stores a confirmed mutation result under the current UID without touching other keys', async () => {
  const storage = fakeStorage();
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  cache.set('billing-history:user-1', { payments: [{ id: 'p1', amount: 3 }] });
  assert.deepEqual(
    await cache.readCached('billing-history:user-1', async () => ({ payments: [] })),
    { payments: [{ id: 'p1', amount: 3 }] },
  );
  assert.equal(cache.getState('billing-history:user-1').lastSyncedAt, null);
});

test('notifies active subscribers after refresh or a confirmed local cache update', async () => {
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => fakeStorage() });
  const received = [];
  const unsubscribe = cache.subscribe('dashboard', (value) => received.push(value));
  await cache.readCached('dashboard', async () => ({ total: 1 }));
  cache.set('dashboard', { total: 2 });
  unsubscribe();
  cache.set('dashboard', { total: 3 });
  assert.deepEqual(received, [{ total: 1 }, { total: 2 }]);
});

test('passes the prior UID-scoped value and force flag to a delta loader', async () => {
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => fakeStorage() });
  await cache.readCached('billing-history:user-1', async () => ({ sales: ['sale-1'] }));
  let receivedContext;
  await cache.readCached('billing-history:user-1', async (context) => {
    receivedContext = context;
    return { sales: ['sale-1', 'sale-2'] };
  }, { force: true });

  assert.deepEqual(receivedContext.cachedValue, { sales: ['sale-1'] });
  assert.equal(receivedContext.uid, 'admin-a');
  assert.equal(receivedContext.force, true);
});

test('preserving a restored UID removes foreign snapshots but keeps its own', async () => {
  const storage = fakeStorage();
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  await cache.readCached('dashboard', async () => ({ owner: 'admin-a' }));
  await cache.readCached('dashboard', async () => ({ owner: 'admin-b' }), { uid: 'admin-b' });
  cache.clear({ preserveUid: 'admin-a' });
  assert.ok(storage.getItem(buildAdminDataStorageKey('admin-a', 'dashboard')));
  assert.equal(storage.getItem(buildAdminDataStorageKey('admin-b', 'dashboard')), null);
});

test('force bypasses memory/local custom cache', async () => {
  const storage = fakeStorage();
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  let calls = 0;
  assert.deepEqual(await cache.readCached('dashboard', async () => ({ value: ++calls })), { value: 1 });
  assert.deepEqual(await cache.readCached('dashboard', async () => ({ value: ++calls })), { value: 1 });
  assert.deepEqual(await cache.readCached('dashboard', async () => ({ value: ++calls }), { force: true }), { value: 2 });
  assert.equal(calls, 2);
  assert.equal(cache.getState('dashboard').lastSyncedAt, null);
});

test('does not infer server freshness from an untagged loader result', async () => {
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => fakeStorage() });
  assert.deepEqual(await cache.readCached('dashboard', async () => ({ value: 1 })), { value: 1 });
  assert.equal(cache.getState('dashboard').fromCache, null);
  assert.equal(cache.getState('dashboard').lastSyncedAt, null);
});

test('records server-sync time only for a loader explicitly marked server-confirmed', async () => {
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => fakeStorage() });
  assert.deepEqual(await cache.readCached('billing', async () => (
    withAdminDataCacheMetadata({ rows: [] }, { fromCache: false })
  )), { rows: [] });
  assert.equal(cache.getState('billing').fromCache, false);
  assert.ok(cache.getState('billing').lastSyncedAt > 0);
});

test('a fresh persisted snapshot avoids a network read until TTL expiry or explicit force', async () => {
  const storage = fakeStorage();
  const firstSession = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  await firstSession.readCached('dashboard', async () => ({ saved: 'recent' }));
  firstSession.clear({ preserveUid: 'admin-a' });

  const restoredSession = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  let networkReads = 0;
  assert.deepEqual(await restoredSession.readCached('dashboard', async () => {
    networkReads += 1;
    return { saved: 'network' };
  }), { saved: 'recent' });
  assert.equal(networkReads, 0);

  assert.deepEqual(await restoredSession.readCached('dashboard', async () => {
    networkReads += 1;
    return { saved: 'forced refresh' };
  }, { force: true }), { saved: 'forced refresh' });
  assert.equal(networkReads, 1);
});

test('serves an old persisted snapshot offline and does not drop it at the freshness TTL', async () => {
  const storage = fakeStorage();
  const key = buildAdminDataStorageKey('admin-a', 'dashboard');
  storage.setItem(key, JSON.stringify({
    cachedAt: Date.now() - LOCAL_CACHE_TTL - 1000,
    value: { saved: 'offline snapshot' },
  }));
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });

  const result = await cache.readCached('dashboard', async () => {
    throw new Error('network unavailable');
  });
  assert.deepEqual(result, { saved: 'offline snapshot' });
  assert.equal(cache.getState('dashboard').fromCache, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(storage.getItem(key));
});

test('returns stale in-memory data while its background revalidation fails', async () => {
  const cache = createAdminDataCache({
    getUid: () => 'admin-a',
    getStorage: () => fakeStorage(),
    memoryTtl: 0,
    localCacheTtl: 0,
  });
  assert.deepEqual(await cache.readCached('dashboard', async () => ({ saved: true })), { saved: true });
  assert.deepEqual(await cache.readCached('dashboard', async () => {
    throw new Error('network unavailable');
  }), { saved: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.getState('dashboard').fromCache, true);
});

test('a request started under a cleared UID scope cannot write after logout/switch', async () => {
  const storage = fakeStorage();
  const cache = createAdminDataCache({ getUid: () => 'admin-a', getStorage: () => storage });
  let resolveOld;
  const oldRequest = cache.readCached('dashboard', () => new Promise((resolve) => { resolveOld = resolve; }));

  await Promise.resolve();
  cache.clear();
  const newRequest = cache.readCached('dashboard', async () => ({ owner: 'admin-b' }), { uid: 'admin-b' });
  resolveOld({ owner: 'admin-a' });
  await Promise.all([oldRequest, newRequest]);

  assert.equal(storage.getItem(buildAdminDataStorageKey('admin-a', 'dashboard')), null);
  assert.deepEqual(JSON.parse(storage.getItem(buildAdminDataStorageKey('admin-b', 'dashboard'))).value, { owner: 'admin-b' });
});
