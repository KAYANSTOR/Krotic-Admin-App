import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { provisionSelfRegistration, RegistrationError, validateSelfRegistration } from '../server/apiHandlers/register-network.js';

process.env.KROTAK_HMAC_SECRET = 'test-only-secret-value-with-at-least-thirty-two-bytes';

class FakeRef {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
}
class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path; }
  where(field, operator, value) {
    return { query: true, collection: this.path, field, operator, value, limit() { return this; } };
  }
  doc(id) {
    const key = id ?? `generated-${++this.db.autoId}`;
    return new FakeRef(this.db, `${this.path}/${key}`);
  }
}
class FakeDb {
  constructor() { this.docs = new Map(); this.autoId = 0; }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => {
        if (ref?.query) {
          const docs = [...this.docs.entries()]
            .filter(([path, data]) => path.startsWith(`${ref.collection}/`)
              && data?.[ref.field] === ref.value)
            .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }));
          return { docs };
        }
        const data = this.docs.get(ref.path);
        return { exists: data !== undefined, data: () => data };
      },
      set: (ref, data, options = {}) => writes.push({ ref, data, options }),
    };
    const result = await callback(transaction);
    for (const { ref, data, options } of writes) {
      const existing = this.docs.get(ref.path) || {};
      this.docs.set(ref.path, options.merge ? { ...existing, ...data } : data);
    }
    return result;
  }
}
const validInput = {
  networkName: 'شبكة الاختبار',
  phone: '967773303450',
  platform: 'android',
  appVersion: '1.0.15',
};

test('self-registration accepts only profile fields and normalized phone digits', () => {
  assert.deepEqual(validateSelfRegistration(validInput), { ok: true, value: validInput });
  assert.equal(validateSelfRegistration({ ...validInput, accessStatus: 'ACTIVE_PAID' }).error, 'fields_not_allowed');
  assert.equal(validateSelfRegistration({ ...validInput, is_trial: true }).error, 'fields_not_allowed');
  assert.equal(validateSelfRegistration({ ...validInput, phone: '+967 773 303 450' }).error, 'phone_invalid');
  assert.equal(validateSelfRegistration({ ...validInput, networkName: ' ' }).error, 'network_name_invalid');
});

test('the server atomically creates one network and a bounded 30-day trial', async () => {
  const db = new FakeDb();
  const now = Date.UTC(2026, 9, 15, 0, 0, 0);
  const result = await provisionSelfRegistration(db, { uid: 'client_1', profile: validInput, now });
  assert.equal(result.status, 'created');
  assert.equal(result.networkId, 'NET-10001');
  assert.equal(result.trialStartedAtMs, now);
  assert.equal(result.subscriptionEndsAtMs, now + 30 * 24 * 60 * 60 * 1000);

  const user = db.docs.get('users/client_1');
  const network = db.docs.get('networks/NET-10001');
  assert.equal(user.accessStatus, 'TRIAL');
  assert.equal(user.is_active, true);
  assert.equal(user.is_trial, true);
  assert.equal(user.phone_verified, false);
  assert.equal(user.phoneVerified, false);
  assert.equal(user.phone_verification_required, false);
  assert.equal(user.phone_verified_manual, false);
  assert.equal(user.subscription_end_date.toMillis(), result.subscriptionEndsAtMs);
  assert.equal(user.subscriptionEndsAt.toMillis(), result.subscriptionEndsAtMs);
  assert.equal(user.createdAtMs, now);
  assert.equal(user.updatedAtMs, now);
  assert.equal(network.owner_uid, 'client_1');
  assert.equal(network.createdAtMs, now);
  assert.equal(network.updatedAtMs, now);
  assert.equal(typeof network.networkSecretEncrypted, 'string');
  assert.equal(db.docs.get('networks/NET-10001/_metadata/info').phoneNumber, validInput.phone);
  assert.equal(db.docs.has(`network_registration_phone_index/${createHash('sha256').update(validInput.phone).digest('hex')}`), true);
});

test('retrying the same registration is idempotent and does not extend the trial', async () => {
  const db = new FakeDb();
  const first = await provisionSelfRegistration(db, {
    uid: 'client_2', profile: validInput, now: Date.UTC(2026, 9, 15),
  });
  const second = await provisionSelfRegistration(db, {
    uid: 'client_2', profile: validInput, now: Date.UTC(2026, 10, 15),
  });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.networkId, first.networkId);
  assert.equal(second.trialStartedAtMs, first.trialStartedAtMs);
  assert.equal(second.subscriptionEndsAtMs, first.subscriptionEndsAtMs);
  assert.equal(db.docs.get('users/client_2').phone_verification_required, false);
  assert.equal(db.docs.get('counters/networks').lastNetworkId, 'NET-10001');
});

test('existing owner network is reused when the user mapping is missing', async () => {
  const db = new FakeDb();
  db.docs.set('users/client_existing', { uid: 'client_existing', phone: validInput.phone });
  db.docs.set('networks/NET-10077', {
    networkId: 'NET-10077', owner_uid: 'client_existing',
    trialStartedAt: Timestamp.fromMillis(1_800_000_000_000),
    subscriptionEndsAt: Timestamp.fromMillis(1_802_000_000_000),
  });

  const result = await provisionSelfRegistration(db, {
    uid: 'client_existing', profile: validInput, now: Date.UTC(2026, 9, 15),
  });

  assert.equal(result.status, 'duplicate');
  assert.equal(result.networkId, 'NET-10077');
  assert.equal(db.docs.has('counters/networks'), false);
});

test('ambiguous owner networks stop registration instead of creating a third network', async () => {
  const db = new FakeDb();
  db.docs.set('users/client_ambiguous', { uid: 'client_ambiguous', phone: validInput.phone });
  db.docs.set('networks/NET-10078', { networkId: 'NET-10078', owner_uid: 'client_ambiguous' });
  db.docs.set('networks/NET-10079', { networkId: 'NET-10079', owner_uid: 'client_ambiguous' });

  await assert.rejects(
    provisionSelfRegistration(db, { uid: 'client_ambiguous', profile: validInput }),
    (error) => error instanceof RegistrationError
      && error.status === 409 && error.code === 'network_mapping_ambiguous',
  );
  assert.equal(db.docs.has('counters/networks'), false);
});

test('retrying a pending registration removes the temporary SMS gate without claiming verification', async () => {
  const db = new FakeDb();
  await provisionSelfRegistration(db, { uid: 'client_pending', profile: validInput });
  db.docs.set('users/client_pending', {
    ...db.docs.get('users/client_pending'),
    phone_verification_required: true,
    phone_verified: false,
    phoneVerified: false,
  });

  await provisionSelfRegistration(db, { uid: 'client_pending', profile: validInput });

  const user = db.docs.get('users/client_pending');
  assert.equal(user.phone_verification_required, false);
  assert.equal(user.phone_verified, false);
  assert.equal(user.phoneVerified, false);
});

test('an existing owned network repairs missing user access fields from its server record', async () => {
  const db = new FakeDb();
  const startedAt = Timestamp.fromMillis(Date.UTC(2026, 9, 1));
  const endsAt = Timestamp.fromMillis(Date.UTC(2026, 9, 31));
  db.docs.set('users/client_access_repair', {
    uid: 'client_access_repair',
    networkId: 'NET-10021',
    phone: validInput.phone,
  });
  db.docs.set('networks/NET-10021', {
    networkId: 'NET-10021',
    owner_uid: 'client_access_repair',
    accessStatus: 'TRIAL',
    trialStartedAt: startedAt,
    subscriptionEndsAt: endsAt,
    is_active: true,
    is_trial: true,
  });

  const result = await provisionSelfRegistration(db, {
    uid: 'client_access_repair',
    profile: validInput,
    now: Date.UTC(2026, 10, 15),
  });

  const user = db.docs.get('users/client_access_repair');
  assert.equal(result.status, 'duplicate');
  assert.equal(user.accessStatus, 'TRIAL');
  assert.equal(user.is_active, true);
  assert.equal(user.is_trial, true);
  assert.equal(user.trialStartedAt.toMillis(), startedAt.toMillis());
  assert.equal(user.subscriptionEndsAt.toMillis(), endsAt.toMillis());
  assert.equal(user.subscription_end_date.toMillis(), endsAt.toMillis());
});

test('an existing owned network without a trusted access status does not auto-activate the user', async () => {
  const db = new FakeDb();
  db.docs.set('users/client_no_access', {
    uid: 'client_no_access',
    networkId: 'NET-10022',
    phone: validInput.phone,
  });
  db.docs.set('networks/NET-10022', {
    networkId: 'NET-10022',
    owner_uid: 'client_no_access',
  });

  await provisionSelfRegistration(db, {
    uid: 'client_no_access',
    profile: validInput,
  });

  const user = db.docs.get('users/client_no_access');
  assert.equal(user.accessStatus, undefined);
  assert.equal(user.is_active, undefined);
  assert.equal(user.is_trial, undefined);
});

test('an admin-provisioned account can complete a missing profile without a new trial', async () => {
  const db = new FakeDb();
  const startedAt = Timestamp.fromMillis(Date.UTC(2026, 9, 1));
  const endsAt = Timestamp.fromMillis(Date.UTC(2026, 9, 31));
  db.docs.set('users/client_3', {
    uid: 'client_3',
    networkId: 'NET-10020',
    owner_uid: 'client_3',
    accessStatus: 'TRIAL',
    trialStartedAt: startedAt,
    subscriptionEndsAt: endsAt,
    is_active: true,
    is_trial: true,
  });
  db.docs.set('networks/NET-10020', { networkId: 'NET-10020', owner_uid: 'client_3' });
  const result = await provisionSelfRegistration(db, {
    uid: 'client_3',
    profile: validInput,
    now: Date.UTC(2026, 10, 15),
  });
  assert.equal(result.status, 'duplicate');
  assert.equal(result.networkId, 'NET-10020');
  assert.equal(result.trialStartedAtMs, startedAt.toMillis());
  assert.equal(result.subscriptionEndsAtMs, endsAt.toMillis());
  assert.equal(db.docs.get('users/client_3').network_name, validInput.networkName);
  assert.equal(db.docs.get('networks/NET-10020/_metadata/info').phoneNumber, validInput.phone);
  assert.equal(db.docs.has('counters/networks'), false);
});

test('a phone index owned by another UID cannot receive a second trial', async () => {
  const db = new FakeDb();
  const indexId = createHash('sha256').update(validInput.phone).digest('hex');
  db.docs.set(`network_registration_phone_index/${indexId}`, { uid: 'other_client' });
  await assert.rejects(
    provisionSelfRegistration(db, { uid: 'new_client', profile: validInput }),
    (error) => error instanceof RegistrationError && error.status === 409 && error.code === 'phone_already_registered',
  );
  assert.equal(db.docs.has('counters/networks'), false);
  assert.equal(db.docs.has('users/new_client'), false);
});
