import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import {
  buildMetaOtpPayload,
  getOtpChallengeId,
  getPhoneIndexId,
  handleRequestOtp,
  handleVerifyOtp,
  normalizePhoneNumber,
} from '../api/_lib/whatsappOtp.js';

const phoneNumber = '967773303450';
const uid = 'client_otp_1';
const otpSecret = 'test-only-otp-hash-secret-32-bytes-minimum';
const env = {
  OTP_HASH_SECRET: otpSecret,
  META_WHATSAPP_ACCESS_TOKEN: 'test-access-token',
  META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  META_WHATSAPP_TEMPLATE_NAME: 'verification_code',
  META_WHATSAPP_TEMPLATE_LANGUAGE: 'ar',
  META_WHATSAPP_API_VERSION: 'v26.0',
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
      .map(([path, data]) => new FakeSnapshot(path, data));
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
  db.docs.set(`users/${targetUid}`, { uid: targetUid, phone: targetPhone, networkId: 'NET-10001' });
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
  return {
    method,
    headers: { 'x-real-ip': '203.0.113.10' },
    body,
  };
}

test('phone input normalizes to the digits-only format already used by the app', () => {
  assert.equal(normalizePhoneNumber('+967 773 303 450'), phoneNumber);
  assert.equal(normalizePhoneNumber(phoneNumber), phoneNumber);
  assert.equal(normalizePhoneNumber('0773 303 450'), null);
  assert.equal(normalizePhoneNumber('not-a-phone'), null);
  assert.equal(normalizePhoneNumber('+967773303450x'), null);
});

test('Meta OTP template payload supplies the code in both required components', () => {
  const payload = buildMetaOtpPayload({
    phoneNumber,
    otp: '004271',
    templateName: 'verification_code',
    templateLanguage: 'ar',
  });
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, phoneNumber);
  assert.equal(payload.template.name, 'verification_code');
  assert.deepEqual(payload.template.components.map((component) => component.type), ['body', 'button']);
  assert.equal(payload.template.components[0].parameters[0].text, '004271');
  assert.equal(payload.template.components[1].parameters[0].text, '004271');
  assert.equal(payload.template.components[1].sub_type, 'url');
});

test('request stores only a keyed hash, sends OTP through Meta, and verify returns the existing UID token once', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  const now = Date.UTC(2026, 9, 16, 0, 0, 0);
  let capturedRequest;
  const deps = {
    db,
    auth: fakeAuth(),
    env,
    now: () => now,
    randomInt: () => 4271,
    fetchImpl: async (url, options) => {
      capturedRequest = { url, options, payload: JSON.parse(options.body) };
      return { ok: true, status: 200, async json() { return { messages: [{ id: 'wamid.test' }] }; } };
    },
    logger() {},
  };

  const requestResponse = response();
  await handleRequestOtp(request({ phoneNumber: '+967 773 303 450' }), requestResponse, deps);
  assert.equal(requestResponse.statusCode, 200);
  assert.equal(requestResponse.body.success, true);
  assert.match(requestResponse.body.message, /If this number is registered/);
  assert.equal(capturedRequest.url, 'https://graph.facebook.com/v26.0/123456789012345/messages');
  assert.equal(capturedRequest.options.headers.Authorization, `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}`);
  assert.equal(capturedRequest.payload.to, phoneNumber);
  assert.equal(capturedRequest.payload.template.components[0].parameters[0].text, '004271');

  const challengePath = `auth_otps/${getOtpChallengeId(phoneNumber, otpSecret)}`;
  const challenge = db.docs.get(challengePath);
  assert.ok(challenge);
  assert.equal(challenge.uid, uid);
  assert.equal(challenge.expiresAt.toMillis(), now + 5 * 60 * 1000);
  assert.equal(challenge.attempts, 0);
  assert.equal('otp' in challenge, false);
  assert.equal('phoneNumber' in challenge, false);
  assert.notEqual(challenge.otpHash, '004271');

  const verifyResponse = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '004271' }), verifyResponse, { ...deps, randomInt: undefined });
  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.customToken, `firebase-custom-token:${uid}`);
  assert.equal(verifyResponse.body.uid, uid);
  assert.equal(verifyResponse.headers['Cache-Control'], 'no-store');
  assert.equal(db.docs.has(challengePath), false);

  const replayResponse = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '004271' }), replayResponse, deps);
  assert.equal(replayResponse.statusCode, 401);
  assert.equal(replayResponse.body.error, 'otp_invalid_or_expired');
});

test('request rate limits repeat sends and does not disclose unknown phone numbers', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  let sent = 0;
  const deps = {
    db,
    auth: fakeAuth(),
    env,
    now: () => Date.UTC(2026, 9, 16, 0, 0, 0),
    randomInt: () => 1,
    fetchImpl: async () => { sent += 1; return { ok: true, status: 200, async json() { return {}; } }; },
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

test('expired or incorrect codes are rejected; five wrong attempts consume the challenge', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  const now = Date.UTC(2026, 9, 16, 0, 0, 0);
  const deps = {
    db,
    auth: fakeAuth(),
    env,
    now: () => now,
    randomInt: () => 99,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return {}; } }),
    logger() {},
  };

  const requested = response();
  await handleRequestOtp(request({ phoneNumber }), requested, deps);
  const challengePath = `auth_otps/${getOtpChallengeId(phoneNumber, otpSecret)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invalid = response();
    await handleVerifyOtp(request({ phoneNumber, otp: '999999' }), invalid, deps);
    assert.equal(invalid.statusCode, 401);
  }
  assert.equal(db.docs.has(challengePath), false);

  const validAfterLockout = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '000099' }), validAfterLockout, deps);
  assert.equal(validAfterLockout.statusCode, 401);

  db.docs.set(challengePath, {
    uid,
    otpHash: 'a'.repeat(64),
    attempts: 0,
    expiresAt: Timestamp.fromMillis(now - 1),
  });
  const expired = response();
  await handleVerifyOtp(request({ phoneNumber, otp: '000099' }), expired, deps);
  assert.equal(expired.statusCode, 401);
  assert.equal(db.docs.has(challengePath), false);
});

test('provider send failure leaves no usable OTP and keeps a generic response', async () => {
  const db = new FakeDb();
  seedExistingClient(db);
  const logs = [];
  const result = response();
  await handleRequestOtp(request({ phoneNumber }), result, {
    db,
    auth: fakeAuth(),
    env,
    now: () => Date.UTC(2026, 9, 16, 0, 0, 0),
    randomInt: () => 123456,
    fetchImpl: async () => ({ ok: false, status: 400, async json() { return { error: { code: 132001 } }; } }),
    logger: (...args) => logs.push(args),
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.message, 'If this number is registered, a verification code will be sent.');
  assert.equal(db.docs.has(`auth_otps/${getOtpChallengeId(phoneNumber, otpSecret)}`), false);
  assert.equal(JSON.stringify(logs).includes(phoneNumber), false);
  assert.equal(JSON.stringify(logs).includes('123456'), false);
});

test('request rejects unsupported methods and malformed OTP input with explicit status codes', async () => {
  const methodResponse = response();
  await handleRequestOtp(request({}, 'GET'), methodResponse, { env });
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'POST');

  const malformedResponse = response();
  await handleVerifyOtp(request({ phoneNumber, otp: 123456 }), malformedResponse, {
    env,
    db: new FakeDb(),
    auth: fakeAuth(),
  });
  assert.equal(malformedResponse.statusCode, 400);
});
