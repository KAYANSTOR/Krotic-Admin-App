import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPhoneIndexId,
  handleRequestOtp,
  handleVerifyOtp,
  normalizePhoneNumber,
} from '../api/_lib/phoneOtp.js';

const phoneNumber = '967773303450';
const uid = 'client_otp_1';
const env = {
  OTP_HASH_SECRET: 'test-only-otp-rate-limit-secret-32-bytes-minimum',
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_VERIFY_SERVICE_SID: 'VA00000000000000000000000000000000',
};

class FakeSnapshot {
  constructor(path, value) {
    this.id = path.split('/').at(-1);
    this.exists = value !== undefined;
    this.value = value;
    this.size = 0;
    this.docs = [];
  }
  data() { return this.value; }
}

class FakeRef {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() { return new FakeSnapshot(this.path, this.db.docs.get(this.path)); }
  async set(value, options = {}) {
    const previous = this.db.docs.get(this.path) || {};
    this.db.docs.set(this.path, options.merge ? { ...previous, ...value } : value);
  }
  async delete() { this.db.docs.delete(this.path); }
}

class FakeQuery {
  constructor(db, collectionPath, field, value, max = Infinity) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.field = field;
    this.value = value;
    this.max = max;
  }
  limit(max) { return new FakeQuery(this.db, this.collectionPath, this.field, this.value, max); }
  async get() {
    const docs = [...this.db.docs.entries()]
      .filter(([path, data]) => path.startsWith(`${this.collectionPath}/`)
        && !path.slice(this.collectionPath.length + 1).includes('/')
        && data?.[this.field] === this.value)
      .slice(0, this.max)
      .map(([path, data]) => {
        const snapshot = new FakeSnapshot(path, data);
        snapshot.id = path.slice(this.collectionPath.length + 1);
        return snapshot;
      });
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new FakeRef(this.db, `${this.path}/${id}`); }
  where(field, _operator, value) { return new FakeQuery(this.db, this.path, field, value); }
}

class FakeDb {
  constructor() { this.docs = new Map(); }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => new FakeSnapshot(ref.path, this.docs.get(ref.path)),
      set: (ref, value, options = {}) => writes.push({ type: 'set', ref, value, options }),
      delete: (ref) => writes.push({ type: 'delete', ref }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      if (write.type === 'delete') this.docs.delete(write.ref.path);
      else {
        const previous = this.docs.get(write.ref.path) || {};
        this.docs.set(write.ref.path, write.options.merge ? { ...previous, ...write.value } : write.value);
      }
    }
    return result;
  }
}

function seedExistingClient(db, targetUid = uid, targetPhone = phoneNumber) {
  db.docs.set(`network_registration_phone_index/${getPhoneIndexId(targetPhone)}`, { uid: targetUid });
  db.docs.set(`users/${targetUid}`, {
    uid: targetUid,
    phone: targetPhone,
    networkId: 'NET-10001',
    phone_verification_required: true,
    phone_verified: false,
  });
}

function fakeAuth() {
  return {
    async getUser(targetUid) { return { uid: targetUid, disabled: false }; },
    async createCustomToken(targetUid) { return `firebase-custom-token:${targetUid}`; },
  };
}

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(body, method = 'POST') {
  return { method, headers: { 'x-real-ip': '203.0.113.10' }, body };
}

function providerResponse(body = { status: 'pending' }, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('phone input normalizes to the digits-only format already used by the app', () => {
  assert.equal(normalizePhoneNumber('+967 773 303 450'), phoneNumber);
  assert.equal(normalizePhoneNumber(phoneNumber), phoneNumber);
  assert.equal(normalizePhoneNumber('0773 303 450'), null);
  assert.equal(normalizePhoneNumber('not-a-phone'), null);
  assert.equal(normalizePhoneNumber('+967773303450x'), null);
});

test('request calls Twilio Verify SMS and records verification before minting a Firebase token', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  const now = Date.UTC(2026, 9, 16, 0, 0, 0);
  const calls = [];
  const deps = {
    db,
    auth: fakeAuth(),
    env,
    now: () => now,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, fields: new URLSearchParams(options.body) });
      return providerResponse({ status: calls.length === 1 ? 'pending' : 'approved' });
    },
    logger() {},
  };

  const requestResponse = response();
  await handleRequestOtp(request({ phoneNumber: '+967 773 303 450' }), requestResponse, deps);
  assert.equal(requestResponse.statusCode, 200);
  assert.equal(requestResponse.body.success, true);
  assert.match(requestResponse.body.message, /If this number is registered/);
  assert.equal(calls[0].url, `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[0].fields.get('To'), `+${phoneNumber}`);
  assert.equal(calls[0].fields.get('Channel'), 'sms');
  assert.equal(
    Buffer.from(calls[0].options.headers.Authorization.slice('Basic '.length), 'base64').toString(),
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
  );
  assert.equal([...db.docs.keys()].some((path) => path.startsWith('auth_otps/')), false);

  const verifyResponse = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '004271' }), verifyResponse, deps);
  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.customToken, `firebase-custom-token:${uid}`);
  assert.equal(verifyResponse.body.uid, uid);
  assert.equal(verifyResponse.headers['Cache-Control'], 'no-store');
  assert.equal(db.docs.get(`users/${uid}`).phone_verified, true);
  assert.equal(db.docs.get(`users/${uid}`).phoneVerified, true);
  assert.equal(db.docs.get(`users/${uid}`).phone_verified_sms, true);
  assert.equal(db.docs.get(`users/${uid}`).phone_verification_required, false);
  assert.equal(db.docs.get(`users/${uid}`).phone_verified_at.toMillis(), now);
  assert.equal(calls[1].url, `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`);
  assert.equal(calls[1].fields.get('To'), `+${phoneNumber}`);
  assert.equal(calls[1].fields.get('Code'), '004271');
});

test('API key credentials are preferred over account auth token', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  let authorization = '';
  const result = response();
  await handleRequestOtp(request({ phoneNumber }), result, {
    db,
    auth: fakeAuth(),
    env: { ...env, TWILIO_API_KEY_SID: 'SK00000000000000000000000000000000', TWILIO_API_KEY_SECRET: 'test-api-key-secret' },
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return providerResponse();
    },
    logger() {},
  });
  assert.equal(result.statusCode, 200);
  assert.equal(
    Buffer.from(authorization.slice('Basic '.length), 'base64').toString(),
    'SK00000000000000000000000000000000:test-api-key-secret',
  );
});

test('request enforces resend limits and does not disclose unknown phone numbers', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  let sent = 0;
  const deps = {
    db,
    auth: fakeAuth(),
    env,
    now: () => Date.UTC(2026, 9, 16, 0, 0, 0),
    fetchImpl: async () => { sent += 1; return providerResponse(); },
    logger() {},
  };
  const first = response();
  await handleRequestOtp(request({ phoneNumber }), first, deps);
  assert.equal(first.statusCode, 200);
  assert.equal(sent, 1);

  const second = response();
  await handleRequestOtp(request({ phoneNumber }), second, deps);
  assert.equal(second.statusCode, 429);
  assert.ok(second.headers['Retry-After']);
  assert.equal(sent, 1);

  const unknown = response();
  await handleRequestOtp(request({ phoneNumber: '967777777777' }), unknown, deps);
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.body, first.body);
  assert.equal(sent, 1);
});

test('legacy existing accounts without a pending-registration flag receive no OTP and cannot use OTP sign-in', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  db.docs.set(`users/${uid}`, { uid, phone: phoneNumber, phone_verified: false });
  let sent = 0;
  const deps = {
    db,
    auth: fakeAuth(),
    env,
    fetchImpl: async () => {
      sent += 1;
      return providerResponse({ status: 'approved' });
    },
    logger() {},
  };
  const requestResult = response();
  await handleRequestOtp(request({ phoneNumber }), requestResult, deps);
  assert.equal(requestResult.statusCode, 200);
  assert.equal(sent, 0);

  const verifyResult = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '004271' }), verifyResult, deps);
  assert.equal(verifyResult.statusCode, 401);
  assert.equal(verifyResult.body.error, 'otp_invalid_or_expired');
  assert.equal(sent, 1);
  assert.equal(db.docs.get(`users/${uid}`).phone_verified, false);
});

test('invalid Twilio code is rejected without minting a Firebase token', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  const result = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '999999' }), result, {
    db,
    auth: fakeAuth(),
    env,
    fetchImpl: async () => providerResponse({ status: 'pending' }),
    logger() {},
  });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, 'otp_invalid_or_expired');
});

test('Twilio delivery failures do not reveal account existence or log phone/credentials', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  const logs = [];
  const result = response();
  await handleRequestOtp(request({ phoneNumber }), result, {
    db,
    auth: fakeAuth(),
    env,
    fetchImpl: async () => providerResponse({ code: 20003, message: 'sensitive provider detail' }, 401),
    logger: (...args) => logs.push(args),
  });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.message, /If this number is registered/);
  const renderedLogs = JSON.stringify(logs);
  assert.equal(renderedLogs.includes(phoneNumber), false);
  assert.equal(renderedLogs.includes(env.TWILIO_AUTH_TOKEN), false);
  assert.equal(renderedLogs.includes('sensitive provider detail'), false);
});

test('missing Twilio credentials, unsupported methods, and malformed codes are rejected safely', async () => {
  const notConfigured = response();
  await handleRequestOtp(request({ phoneNumber }), notConfigured, { env: { OTP_HASH_SECRET: env.OTP_HASH_SECRET } });
  assert.equal(notConfigured.statusCode, 503);

  const methodResponse = response();
  await handleRequestOtp(request({}, 'GET'), methodResponse, { env });
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'POST');

  const malformedResponse = response();
  await handleVerifyOtp(request({ phoneNumber, otp: 123456 }), malformedResponse, { env });
  assert.equal(malformedResponse.statusCode, 400);
});
