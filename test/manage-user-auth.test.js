import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTargetClient, validateManageUserInput } from '../server/apiHandlers/manage-user-auth.js';

function fakeDb({ userExists = false, adminExists = false } = {}) {
  const reads = [];
  const db = {
    collection(name) {
      return {
        doc(uid) {
          return {
            async get() {
              reads.push({ collection: name, uid });
              return { exists: name === 'users' ? userExists : adminExists };
            },
          };
        },
      };
    },
  };
  return { db, reads };
}

test('authorizes a registered client that is not an Admin', async () => {
  const { db, reads } = fakeDb({ userExists: true, adminExists: false });

  const result = await authorizeTargetClient(db, 'client_123');

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(reads.sort((a, b) => a.collection.localeCompare(b.collection)), [
    { collection: 'Admins', uid: 'client_123' },
    { collection: 'users', uid: 'client_123' },
  ]);
});

test('rejects a target that has an Admin document even when it is also in users', async () => {
  const { db } = fakeDb({ userExists: true, adminExists: true });

  const result = await authorizeTargetClient(db, 'admin_123');

  assert.deepEqual(result, { ok: false, error: 'target_not_client' });
});

test('rejects a UID without a registered users document', async () => {
  const { db } = fakeDb({ userExists: false, adminExists: false });

  const result = await authorizeTargetClient(db, 'missing_123');

  assert.deepEqual(result, { ok: false, error: 'target_not_client' });
});

test('accepts supported actions and preserves the client password behavior', () => {
  assert.deepEqual(validateManageUserInput({ action: 'get', uid: 'client_123' }), {
    ok: true,
    action: 'get',
    uid: 'client_123',
    password: undefined,
  });
  assert.deepEqual(validateManageUserInput({ action: 'set-password', uid: 'client_123', password: 'newpass' }), {
    ok: true,
    action: 'set-password',
    uid: 'client_123',
    password: 'newpass',
  });
  assert.deepEqual(validateManageUserInput({ action: 'reset-link', uid: 'client_123' }), {
    ok: true,
    action: 'reset-link',
    uid: 'client_123',
    password: undefined,
  });
});

test('rejects malformed UIDs and unsafe input types before any database lookup', () => {
  assert.equal(validateManageUserInput({ action: 'get', uid: '../admin' }).error, 'uid_invalid');
  assert.equal(validateManageUserInput({ action: 'get', uid: 'a'.repeat(129) }).error, 'uid_invalid');
  assert.equal(validateManageUserInput({ action: 'get', uid: 12345 }).error, 'uid_invalid');
  assert.equal(validateManageUserInput({ action: 'set-password', uid: 'client_123', password: 'short' }).error, 'password_too_short');
  assert.equal(validateManageUserInput({ action: 'set-password', uid: 'client_123', password: 'x'.repeat(129) }).error, 'password_too_long');
  assert.equal(validateManageUserInput({ action: 'set-password', uid: 'client_123', password: { value: 'secret' } }).error, 'password_invalid');
  assert.equal(validateManageUserInput({ action: 'delete', uid: 'client_123' }).error, 'unknown_action');
});
