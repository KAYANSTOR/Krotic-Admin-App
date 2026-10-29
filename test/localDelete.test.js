import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeDeletedAccountLocally } from '../src/lib/localDb/localData.js';
import { createMemoryDb } from './helpers/memoryDb.js';

function addLocalDeleteQueries(table, keyField) {
  table.bulkDelete = async (keys) => {
    for (const key of keys) await table.delete(key);
  };
  table.where = (field) => ({
    anyOf: (values) => ({
      delete: async () => {
        const rows = await table.toArray();
        const matching = rows.filter((row) => field === keyField && values.includes(row[field]));
        for (const row of matching) {
          const key = keyField === 'networkId' ? [row.networkId, row.id] : row[keyField];
          await table.delete(key);
        }
        return matching.length;
      },
    }),
  });
}

test('deleted account is immediately removed from local users, networks, aggregates, sales and payments', async () => {
  const localDb = createMemoryDb();
  addLocalDeleteQueries(localDb.networks, 'networkId');
  addLocalDeleteQueries(localDb.sales, 'networkId');
  addLocalDeleteQueries(localDb.payments, 'networkId');

  await localDb.users.put({ uid: 'user-1', networkId: 'NET-10001' });
  await localDb.networks.put({ networkId: 'NET-10001', owner_uid: 'user-1' });
  await localDb.networks.put({ networkId: 'user-1', owner_uid: 'user-1' });
  await localDb.networks.put({ networkId: 'NET-OTHER', owner_uid: 'user-2' });
  await localDb.aggregates.put({ uid: 'user-1', salesCount: 3 });
  await localDb.sales.put({ networkId: 'NET-10001', id: 'sale-1' });
  await localDb.sales.put({ networkId: 'user-1', id: 'sale-2' });
  await localDb.sales.put({ networkId: 'NET-OTHER', id: 'sale-3' });
  await localDb.payments.put({ networkId: 'NET-10001', id: 'payment-1' });
  await localDb.payments.put({ networkId: 'NET-OTHER', id: 'payment-2' });

  const result = await purgeDeletedAccountLocally(localDb, {
    uid: 'user-1',
    networkIds: ['NET-10001', 'user-1'],
  });

  assert.equal(result, true);
  assert.equal(await localDb.users.count(), 0);
  assert.deepEqual((await localDb.networks.toArray()).map((row) => row.networkId), ['NET-OTHER']);
  assert.equal(await localDb.aggregates.count(), 0);
  assert.deepEqual((await localDb.sales.toArray()).map((row) => row.id), ['sale-3']);
  assert.deepEqual((await localDb.payments.toArray()).map((row) => row.id), ['payment-2']);
});
