import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDeleteCustomerInput } from '../api/delete-customer.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer deletion requires an exact UID confirmation and a valid optional network ID', () => {
  assert.deepEqual(
    validateDeleteCustomerInput({ uid: 'client_123', confirmationUid: 'client_123', networkId: 'NET-10001' }),
    { ok: true, value: { uid: 'client_123', networkId: 'NET-10001' } },
  );
  assert.equal(validateDeleteCustomerInput({ uid: 'client_123', confirmationUid: 'client_12' }).error, 'uid_confirmation_required');
  assert.equal(validateDeleteCustomerInput({ uid: 'client_123', confirmationUid: 'client_123', networkId: 'bad/id' }).error, 'network_mapping_invalid');
  assert.equal(validateDeleteCustomerInput({ uid: '../other', confirmationUid: '../other' }).error, 'uid_invalid');
});

test('customer deletion route checks admin authority and network ownership before cascading deletes', async () => {
  const api = await read('api/delete-customer.js');
  assert.match(api, /authenticateAdmin\(req/);
  assert.match(api, /collection\('Admins'\)\.doc\(uid\)/);
  assert.match(api, /network\.owner_uid !== uid/);
  assert.match(api, /linkedUsers\.docs\.some/);
  assert.match(api, /auth\.deleteUser\(uid\)/);
  assert.match(api, /db\.recursiveDelete\(networkRef\)/);
  assert.match(api, /db\.recursiveDelete\(userRef\)/);
  assert.match(api, /sale_ingest_registry/);
  assert.match(api, /network_registration_phone_index/);
  assert.match(api, /notification_requests/);
  assert.match(api, /notification_deliveries/);
  assert.match(api, /details: \{ anonymized: true \}/);
});

test('admin password change reauthenticates the current admin and never logs password values', async () => {
  const [form, settings, audit] = await Promise.all([
    read('src/components/ChangeOwnPasswordModal.jsx'),
    read('src/pages/SettingsPage.jsx'),
    read('src/lib/auditLog.js'),
  ]);
  assert.match(form, /reauthenticateWithCredential\(user, credential\)/);
  assert.match(form, /updatePassword\(user, newPassword\)/);
  assert.match(form, /currentPassword/);
  assert.match(settings, /ChangeOwnPasswordModal/);
  assert.match(settings, /تغيير كلمة المرور/);
  assert.match(audit, /ADMIN_PASSWORD_CHANGE/);
  assert.doesNotMatch(form, /details:\s*\{[^}]*password/i);
});
