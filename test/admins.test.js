import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdminInput, ADMIN_ACTIONS } from '../api/admins.js';
import { isAdminUid } from '../server/_lib/firebaseAdmin.js';

test('admin actions are enumerated and default to list', () => {
  assert.deepEqual(ADMIN_ACTIONS, ['list', 'create', 'update', 'delete']);
  assert.deepEqual(validateAdminInput({}), { ok: true, value: { action: 'list' } });
  assert.equal(validateAdminInput({ action: 'nope' }).error, 'unknown_action');
});

test('creating an admin validates name, email, password and phone', () => {
  const ok = validateAdminInput({ action: 'create', name: 'مدير', email: 'a@b.com', password: 'secret1', phone: '777' });
  assert.equal(ok.ok, true);
  assert.equal(validateAdminInput({ action: 'create', name: '', email: 'a@b.com', password: 'secret1' }).error, 'name_invalid');
  assert.equal(validateAdminInput({ action: 'create', name: 'x', email: 'bad', password: 'secret1' }).error, 'email_invalid');
  assert.equal(validateAdminInput({ action: 'create', name: 'x', email: 'a@b.com', password: '123' }).error, 'password_rejected');
});

test('update requires at least one mutable field; delete requires a valid uid', () => {
  assert.equal(validateAdminInput({ action: 'update', uid: 'admin-1', name: 'جديد' }).ok, true);
  assert.equal(validateAdminInput({ action: 'update', uid: 'admin-1' }).error, 'no_fields');
  assert.equal(validateAdminInput({ action: 'delete', uid: 'bad uid!' }).error, 'uid_invalid');
  assert.equal(validateAdminInput({ action: 'delete', uid: 'admin-1' }).ok, true);
});

test('server admin check accepts the legacy lowercase admins collection', async () => {
  const makeDb = (legacyAdmin) => ({
    collection(name) {
      return {
        doc(uid) {
          return {
            async get() {
              if (name === 'admins' && legacyAdmin) return { exists: true, data: () => ({ uid }) };
              return { exists: false, data: () => undefined };
            },
          };
        },
      };
    },
  });

  assert.equal(await isAdminUid('legacy-admin-test-uid', () => makeDb(true)), true);
  assert.equal(await isAdminUid('missing-admin-test-uid', () => makeDb(false)), false);
});
