import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideAdminBootstrap } from '../server/_lib/adminBootstrap.js';

const PRIMARY_UID = 'primaryUid123';
const PRIMARY_EMAIL = 'Owner@Example.com';
const base = { primaryUid: PRIMARY_UID, primaryEmail: PRIMARY_EMAIL, existingAdminData: null, emailVerified: false };

test('a stranger Firebase account is not promoted to admin', () => {
  const result = decideAdminBootstrap({ ...base, callerUid: 'randomUid', callerEmail: 'attacker@evil.com', emailVerified: true });
  assert.equal(result.allow, false);
  assert.equal(result.create, false);
});

test('an existing admin document with matching uid is allowed without creating a new one', () => {
  const result = decideAdminBootstrap({ ...base, callerUid: 'adminUid', callerEmail: 'a@b.com', existingAdminData: { uid: 'adminUid' } });
  assert.deepEqual(result, { allow: true, create: false });
});

test('an admin document without a matching uid is rejected', () => {
  for (const doc of [{}, { email: 'a@b.com' }, { uid: 'otherUid' }]) {
    const result = decideAdminBootstrap({ ...base, callerUid: 'adminUid', callerEmail: 'a@b.com', existingAdminData: doc });
    assert.equal(result.allow, false);
  }
});

test('the primary owner is recognised by uid', () => {
  const result = decideAdminBootstrap({ ...base, callerUid: PRIMARY_UID, callerEmail: 'whatever@x.com' });
  assert.deepEqual(result, { allow: true, create: true });
});

test('the owner email alone is not enough unless verified', () => {
  assert.equal(decideAdminBootstrap({ ...base, callerUid: 'newUid', callerEmail: 'owner@example.com', emailVerified: false }).allow, false);
  assert.equal(decideAdminBootstrap({ ...base, callerUid: 'newUid', callerEmail: 'owner@example.com', emailVerified: undefined }).allow, false);
  assert.deepEqual(
    decideAdminBootstrap({ ...base, callerUid: 'newUid', callerEmail: 'OWNER@example.com', emailVerified: true }),
    { allow: true, create: true },
  );
});

test('missing uid is rejected', () => {
  assert.equal(decideAdminBootstrap({ ...base, callerUid: '', callerEmail: PRIMARY_EMAIL, emailVerified: true }).allow, false);
});

test('admin-session handler routes bootstrap through the decision helper', () => {
  const source = readFileSync(new URL('../api/admin-session.js', import.meta.url), 'utf8');
  assert.match(source, /decideAdminBootstrap\(/);
  assert.doesNotMatch(source, /callerEmail === PRIMARY_ADMIN_EMAIL\.toLowerCase\(\) \|\|\s*\n?\s*callerUid === PRIMARY_ADMIN_UID \|\|\s*\n?\s*adminSnap\?\.exists/);
});

test('bootstrap admin documents carry updatedAtMs for the local admin list', () => {
  for (const file of ['../api/admin-session.js', '../server/_lib/firebaseAdmin.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /updatedAtMs:/, `${file} must stamp updatedAtMs`);
  }
});
