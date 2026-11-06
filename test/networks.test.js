import { Timestamp } from 'firebase-admin/firestore';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNetworkInput,
  computeRenewalEnd,
  ACCESS_STATUSES,
  legacyAccessFields,
  updateAccess,
  repairLegacyAccess,
  deleteAccount,
  TRIAL_DAYS,
  RENEWAL_DAYS,
} from '../server/apiHandlers/networks.js';

const DAY_MS = 24 * 60 * 60 * 1000;

test('access statuses and durations match the owner policy', () => {
  assert.deepEqual(ACCESS_STATUSES, ['TRIAL', 'ACTIVE_PAID', 'SUSPENDED_GRACE', 'LOCKED_EXPIRED']);
  assert.equal(TRIAL_DAYS, 30);
  assert.equal(RENEWAL_DAYS, 30);
});

test('provision requires a valid owner uid', () => {
  assert.equal(validateNetworkInput({ action: 'provision', ownerUid: 'user_1' }).ok, true);
  assert.equal(validateNetworkInput({ action: 'provision', ownerUid: 'bad uid!' }).error, 'owner_uid_invalid');
  assert.equal(validateNetworkInput({ action: 'nope' }).error, 'unknown_action');
});

test('update-access validates each server-owned field', () => {
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', accessStatus: 'ACTIVE_PAID' }).ok, true);
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', accessStatus: 'NOPE' }).error, 'access_status_invalid');
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', commission_rate: 150 }).error, 'commission_rate_invalid');
  // توثيق الهاتف أُزيل نهائيًا: الحقل لم يعد مقبولًا ولا يُحسب ضمن الحقول.
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1', phone_verified: true }).error, 'no_fields');
  assert.equal(validateNetworkInput({ action: 'update-access', uid: 'user_1' }).error, 'no_fields');
});

test('renew is manual and only 30 days', () => {
  assert.equal(validateNetworkInput({ action: 'renew', uid: 'user_1', extensionDays: 30 }).ok, true);
  assert.equal(validateNetworkInput({ action: 'renew', uid: 'user_1', extensionDays: 7 }).error, 'extension_days_invalid');
  assert.equal(validateNetworkInput({ action: 'renew', uid: 'user_1' }).value.extensionDays, 30);
});

test('batch-expiry requires a positive timestamp', () => {
  assert.equal(validateNetworkInput({ action: 'batch-expiry', subscriptionEndsAt: 1_800_000_000_000 }).ok, true);
  assert.equal(validateNetworkInput({ action: 'batch-expiry', subscriptionEndsAt: 0 }).error, 'subscription_end_invalid');
});

test('renewal adds 30 days to the later of the current end and now', () => {
  const now = 1_700_000_000_000;
  // لاشتراك منتهٍ: يبدأ من الآن.
  assert.equal(computeRenewalEnd(now - 5 * DAY_MS, now), now + 30 * DAY_MS);
  // لاشتراك سارٍ: يُضاف إلى تاريخ الانتهاء الحالي.
  assert.equal(computeRenewalEnd(now + 10 * DAY_MS, now), now + 40 * DAY_MS);
  assert.equal(computeRenewalEnd(0, now), now + 30 * DAY_MS);
});


test('legacy access fields mirror all supported access statuses', () => {
  assert.deepEqual(legacyAccessFields('TRIAL'), {
    is_active: true,
    is_trial: true,
  });
  assert.deepEqual(legacyAccessFields('ACTIVE_PAID'), {
    is_active: true,
    is_trial: false,
  });
  assert.deepEqual(legacyAccessFields('SUSPENDED_GRACE'), {
    is_active: false,
    is_trial: false,
  });
  assert.deepEqual(legacyAccessFields('LOCKED_EXPIRED'), {
    is_active: false,
    is_trial: false,
  });
});

test('legacy subscription end is kept in sync when access dates change', () => {
  const endAt = { timestampFixture: true };
  assert.deepEqual(legacyAccessFields('ACTIVE_PAID', endAt), {
    is_active: true,
    is_trial: false,
    subscription_end_date: endAt,
  });
});


test('updateAccess atomically synchronizes suspension and reactivation fields', async () => {
  const documents = new Map([
    ['users/user_1', {
      uid: 'user_1',
      networkId: 'NET-10001',
      accessStatus: 'TRIAL',
      is_active: true,
      is_trial: true,
    }],
    ['networks/NET-10001', {
      owner_uid: 'user_1',
      accessStatus: 'TRIAL',
      is_active: true,
      is_trial: true,
    }],
  ]);
  const auditEntries = [];
  const reference = (collection, id) => ({ path: `${collection}/${id}`, id });
  const db = {
    collection(collection) {
      return {
        doc(id) { return reference(collection, id); },
        async add(value) { auditEntries.push(value); },
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          const current = documents.get(ref.path);
          return { exists: current !== undefined, data: () => current, ref };
        },
        set(ref, value, options = {}) {
          const current = documents.get(ref.path) || {};
          documents.set(ref.path, options.merge ? { ...current, ...value } : { ...value });
        },
      });
    },
  };

  const suspended = await updateAccess(db, {
    value: { uid: 'user_1', accessStatus: 'SUSPENDED_GRACE' },
    actorUid: 'admin_1',
    now: 1_800_000_000_000,
  });
  assert.equal(suspended.status, 'updated');
  for (const path of ['users/user_1', 'networks/NET-10001']) {
    const document = documents.get(path);
    assert.equal(document.accessStatus, 'SUSPENDED_GRACE');
    assert.equal(document.is_active, false);
    assert.equal(document.is_trial, false);
  }

  await updateAccess(db, {
    value: { uid: 'user_1', accessStatus: 'ACTIVE_PAID' },
    actorUid: 'admin_1',
    now: 1_800_000_000_001,
  });
  for (const path of ['users/user_1', 'networks/NET-10001']) {
    const document = documents.get(path);
    assert.equal(document.accessStatus, 'ACTIVE_PAID');
    assert.equal(document.is_active, true);
    assert.equal(document.is_trial, false);
  }

  const endMs = 1_900_000_000_000;
  await updateAccess(db, {
    value: { uid: 'user_1', subscriptionEndsAtMs: endMs },
    actorUid: 'admin_1',
    now: 1_800_000_000_002,
  });
  for (const path of ['users/user_1', 'networks/NET-10001']) {
    const document = documents.get(path);
    assert.equal(document.subscriptionEndsAt.toMillis(), endMs);
    assert.equal(document.subscription_end_date.toMillis(), endMs);
  }

  assert.equal(auditEntries.length, 3);
});


test('repair-access validates cursor and bounded page size', () => {
  assert.equal(validateNetworkInput({ action: 'repair-access' }).ok, true);
  assert.equal(validateNetworkInput({ action: 'repair-access', cursor: 'user_1', limit: 200 }).ok, true);
  assert.equal(validateNetworkInput({ action: 'repair-access', limit: 201 }).error, 'repair_limit_invalid');
  assert.equal(validateNetworkInput({ action: 'repair-access', limit: 0 }).error, 'repair_limit_invalid');
});

test('repairLegacyAccess fixes previously suspended user and network records without reactivation', async () => {
  const timestamp = { toMillis: () => 1_900_000_000_000 };
  const docs = new Map([
    ['users/user_1', {
      uid: 'user_1',
      networkId: 'NET-10001',
      accessStatus: 'SUSPENDED_GRACE',
      is_active: true,
      is_trial: true,
      subscriptionEndsAt: timestamp,
    }],
    ['networks/NET-10001', {
      owner_uid: 'user_1',
      accessStatus: 'SUSPENDED_GRACE',
      is_active: true,
      is_trial: true,
    }],
  ]);
  const audits = [];
  const makeRef = (collection, id) => ({ path: `${collection}/${id}`, id, collection });
  const userQuery = {
    after: null,
    pageSize: 100,
    orderBy() { return this; },
    startAfter(id) { this.after = id; return this; },
    limit(n) { this.pageSize = n; return this; },
    async get() {
      const all = [...docs.entries()]
        .filter(([path]) => path.startsWith('users/'))
        .map(([path, data]) => ({ id: path.slice('users/'.length), ref: makeRef('users', path.slice('users/'.length)), data: () => data }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const filtered = all.filter((entry) => !this.after || entry.id > this.after).slice(0, this.pageSize);
      return { docs: filtered, size: filtered.length };
    },
  };
  const db = {
    collection(name) {
      return {
        doc(id) { return makeRef(name, id); },
        orderBy() { return userQuery; },
        async add(value) { audits.push(value); },
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          const value = docs.get(ref.path);
          return { exists: value !== undefined, data: () => value, ref };
        },
        set(ref, value, options = {}) {
          const current = docs.get(ref.path) || {};
          docs.set(ref.path, options.merge ? { ...current, ...value } : { ...value });
        },
      });
    },
  };

  const result = await repairLegacyAccess(db, {
    value: { action: 'repair-access', cursor: null, limit: 100 },
    actorUid: 'admin_1',
    now: 1_800_000_000_000,
  });
  assert.equal(result.status, 'access_repaired');
  assert.equal(result.scanned, 1);
  assert.equal(result.usersUpdated, 1);
  assert.equal(result.networksUpdated, 1);
  assert.equal(result.done, true);

  for (const key of ['users/user_1', 'networks/NET-10001']) {
    const value = docs.get(key);
    assert.equal(value.accessStatus, 'SUSPENDED_GRACE');
    assert.equal(value.is_active, false);
    assert.equal(value.is_trial, false);
    assert.equal(value.subscriptionEndsAt.toMillis(), timestamp.toMillis());
    assert.equal(value.subscription_end_date.toMillis(), timestamp.toMillis());
  }
  assert.equal(audits.length, 1);
});

test('deleteAccount purges client, network documents, sales subcollections, phone index and aggregate records', async () => {
  const docs = new Map([
    ['users/user_del', { uid: 'user_del', networkId: 'NET-99999', phone: '967771234567' }],
    ['users/user_del/template_acks/device-1', { uid: 'user_del' }],
    ['users/user_del/account_feature_audit/change-1', { uid: 'user_del' }],
    ['networks/NET-99999', { owner_uid: 'user_del', networkId: 'NET-99999' }],
    ['networks/NET-99999/sales/sale_del', { saleId: 'sale_del' }],
    ['networks/NET-99999/payments/payment_del', { amount: 10 }],
    ['networks/NET-99999/inventory_snapshot/current', { availableCount: 10 }],
    ['networks/NET-99999/device_heartbeats/device-1', { accountId: 'user_del' }],
    ['admin_aggregates/user_del', { totalSales: 50 }],
    ['sale_ingest_registry/user_del_sale_del', { uid: 'user_del', saleUuid: 'sale_del' }],
    ['notification_requests/request_del', { targetUid: 'user_del' }],
    ['notification_deliveries/delivery_del', { targetUid: 'user_del' }],
  ]);
  const deletedDocs = new Set();
  const audits = [];
  let generatedId = 0;

  function makeDocRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      async get() {
        const val = docs.get(path);
        return { exists: val !== undefined && !deletedDocs.has(path), data: () => val, id: path.split('/').pop() };
      },
      async delete() {
        deletedDocs.add(path);
        docs.delete(path);
      },
      collection(subName) {
        return makeColRef(`${path}/${subName}`);
      },
      async listCollections() {
        return [
          'sales', 'payments', 'settlements', '_metadata', 'devices', 'notifications',
          'template_acks', 'account_feature_audit', 'device_heartbeats', 'inventory_snapshot',
        ].map((s) => makeColRef(`${path}/${s}`));
      },
    };
  }

  function makeColRef(path) {
    return {
      id: path.split('/').pop(),
      limit() {
        return this;
      },
      async get() {
        const prefix = `${path}/`;
        const matches = [...docs.entries()]
          .filter(([key]) => key.startsWith(prefix) && key.split('/').length === path.split('/').length + 1)
          .map(([key, value]) => ({ id: key.split('/').pop(), ref: makeDocRef(key), data: () => value }));
        return {
          empty: matches.length === 0,
          size: matches.length,
          docs: matches,
        };
      },
      doc(id) {
        return makeDocRef(`${path}/${id ?? `generated-${++generatedId}`}`);
      },
        where() {
          return {
            limit() { return this; },
            async get() {
              const prefix = `${path}/`;
              const matches = [...docs.entries()]
                .filter(([key]) => key.startsWith(prefix) && key.split('/').length === path.split('/').length + 1)
                .map(([key, value]) => ({ id: key.split('/').pop(), ref: makeDocRef(key), data: () => value }));
              return { empty: matches.length === 0, size: matches.length, docs: matches };
            },
          };
      },
    };
  }

  const db = {
    collection(name) {
      return {
        doc(id) {
          return makeDocRef(`${name}/${id ?? `generated-${++generatedId}`}`);
        },
        where(field, op, val) {
          return {
            limit() { return this; },
            async get() {
              const matches = [];
              for (const [k, v] of docs.entries()) {
                if (k.startsWith(`${name}/`) && v && v[field] === val && !deletedDocs.has(k)) {
                  matches.push({ id: k.split('/').pop(), ref: makeDocRef(k), data: () => v });
                }
              }
              return { empty: matches.length === 0, size: matches.length, docs: matches };
            },
          };
        },
        async add(data) {
          audits.push(data);
          return { id: 'audit_new' };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, value) {
          ops.push({ type: 'set', ref, value });
        },
        delete(ref) {
          ops.push({ type: 'delete', ref });
        },
        async commit() {
          for (const operation of ops) {
            if (operation.type === 'set') docs.set(operation.ref.path, operation.value);
            else {
              deletedDocs.add(operation.ref.path);
              docs.delete(operation.ref.path);
            }
          }
        },
      };
    },
  };

  const result = await deleteAccount(db, {
    uid: 'user_del',
    actorUid: 'admin_1',
    now: 1_800_000_000_000,
    authService: { async deleteUser() {} },
  });

  assert.equal(result.status, 'deleted');
  assert.equal(result.uid, 'user_del');
  assert.equal(docs.has('users/user_del'), false);
  assert.equal(docs.has('networks/NET-99999'), false);
  assert.equal(docs.has('networks/NET-99999/sales/sale_del'), false);
  assert.equal(docs.has('networks/NET-99999/payments/payment_del'), false);
  assert.equal(docs.has('networks/NET-99999/inventory_snapshot/current'), false);
  assert.equal(docs.has('networks/NET-99999/device_heartbeats/device-1'), false);
  assert.equal(docs.has('users/user_del/template_acks/device-1'), false);
  assert.equal(docs.has('users/user_del/account_feature_audit/change-1'), false);
  assert.equal(docs.has('admin_aggregates/user_del'), false);
  assert.equal(docs.has('sale_ingest_registry/user_del_sale_del'), false);
  assert.equal(docs.has('notification_requests/request_del'), false);
  assert.equal(docs.has('notification_deliveries/delivery_del'), false);
  const tombstones = [...docs.entries()]
    .filter(([path]) => path.startsWith('sync_tombstones/'))
    .map(([, value]) => value);
  assert.ok(tombstones.some((entry) => entry.collection === 'sales' && entry.networkId === 'NET-99999' && entry.id === 'sale_del'));
  assert.ok(tombstones.some((entry) => entry.collection === 'payments' && entry.networkId === 'NET-99999' && entry.id === 'payment_del'));
  assert.ok(tombstones.some((entry) => entry.collection === 'users' && entry.id === 'user_del'));
  assert.ok(tombstones.some((entry) => entry.collection === 'networks' && entry.id === 'NET-99999'));
  assert.ok(tombstones.some((entry) => entry.collection === 'admin_aggregates' && entry.id === 'user_del'));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'NETWORK_DELETE');
});
