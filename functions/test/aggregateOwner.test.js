const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../index');

function snapshot(value) {
  return {
    exists: value !== undefined,
    data: () => value,
  };
}

function mockFirestore({ networkData, users = {}, matchingUsers = [] } = {}) {
  return {
    collection(name) {
      if (name === 'networks') {
        return { doc: () => ({ get: async () => snapshot(networkData) }) };
      }
      if (name === 'users') {
        return {
          doc(id) {
            return { get: async () => snapshot(users[id]) };
          },
          where(field, operator, value) {
            assert.equal(field, 'networkId');
            assert.equal(operator, '==');
            return {
              limit(count) {
                assert.equal(count, 2);
                return {
                  get: async () => ({
                    docs: matchingUsers.slice(0, count).map((user) => ({ id: user.id })),
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

test('non-UID network document resolves to its canonical owner_uid', async () => {
  const firestore = mockFirestore({ networkData: { owner_uid: 'owner-uid' } });
  assert.equal(await __test.resolveAggregateOwnerUid('NET-123', firestore), 'owner-uid');
});

test('legacy network with UID document ID falls back to that existing user', async () => {
  const firestore = mockFirestore({
    networkData: {},
    users: { 'legacy-uid': { networkId: 'legacy-uid' } },
  });
  assert.equal(await __test.resolveAggregateOwnerUid('legacy-uid', firestore), 'legacy-uid');
});

test('transitional network without owner_uid resolves a single matching user', async () => {
  const firestore = mockFirestore({
    networkData: {},
    matchingUsers: [{ id: 'owner-uid' }],
  });
  assert.equal(await __test.resolveAggregateOwnerUid('NET-123', firestore), 'owner-uid');
});

test('ambiguous network ownership fails closed instead of writing a wrong aggregate', async () => {
  const firestore = mockFirestore({
    networkData: {},
    matchingUsers: [{ id: 'owner-a' }, { id: 'owner-b' }],
  });
  await assert.rejects(__test.resolveAggregateOwnerUid('NET-123', firestore), /ambiguous_network_owner/);
});

test('unknown network ownership fails closed instead of creating a network-keyed report', async () => {
  const firestore = mockFirestore({ networkData: {} });
  await assert.rejects(__test.resolveAggregateOwnerUid('orphan-network', firestore), /network_owner_unresolved/);
});
