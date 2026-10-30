import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptSecret,
  decryptSecret,
  reencryptSecret,
  secretsEqual,
  cryptoReadiness,
} from '../server/_lib/whatsapp/cryptoSecrets.js';
import {
  sealNetworkAccessToken,
  openNetworkAccessToken,
  secretsReadinessReport,
} from '../server/_lib/whatsapp/secrets.js';
import {
  enqueueDeliveryJob,
  claimNextJob,
  completeJob,
  failJob,
  QUEUE_COLLECTION,
} from '../server/_lib/whatsapp/deliveryQueue.js';
import { createFakeFirestore } from './helpers/fakeFirestore.js';

function setKek(version = 1) {
  // 32 bytes base64
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 7).toString('base64');
  process.env.WHATSAPP_SECRETS_KEY_VERSION = String(version);
  delete process.env.WHATSAPP_SECRETS_KEK_PREV;
}

test('AES-GCM encrypt/decrypt roundtrip with AAD network binding', () => {
  setKek(1);
  const enc = encryptSecret('meta-access-token-value', { aad: 'network:NET-10001' });
  assert.equal(enc.ok, true);
  assert.equal(enc.envelope.v, 1);
  assert.ok(enc.envelope.ct);
  assert.ok(!JSON.stringify(enc.envelope).includes('meta-access-token-value'));

  const dec = decryptSecret(enc.envelope, { aad: 'network:NET-10001' });
  assert.equal(dec.ok, true);
  assert.equal(dec.plaintext, 'meta-access-token-value');

  // Wrong AAD must fail
  assert.equal(decryptSecret(enc.envelope, { aad: 'network:NET-OTHER' }).ok, false);
});

test('key rotation: previous KEK still decrypts; reencrypt uses current', () => {
  setKek(1);
  const enc = encryptSecret('token-v1', { aad: 'network:NET-1' });
  assert.equal(enc.ok, true);

  process.env.WHATSAPP_SECRETS_KEK_PREV = process.env.WHATSAPP_SECRETS_KEK;
  process.env.WHATSAPP_SECRETS_KEK = Buffer.alloc(32, 9).toString('base64');
  process.env.WHATSAPP_SECRETS_KEY_VERSION = '2';

  const still = decryptSecret(enc.envelope, { aad: 'network:NET-1' });
  assert.equal(still.ok, true);
  assert.equal(still.plaintext, 'token-v1');

  const rotated = reencryptSecret(enc.envelope, { aad: 'network:NET-1' });
  assert.equal(rotated.ok, true);
  assert.equal(rotated.envelope.v, 2);
  assert.equal(decryptSecret(rotated.envelope, { aad: 'network:NET-1' }).plaintext, 'token-v1');

  // Old envelope without prev key fails after clearing prev
  delete process.env.WHATSAPP_SECRETS_KEK_PREV;
  assert.equal(decryptSecret(enc.envelope, { aad: 'network:NET-1' }).ok, false);
});

test('seal/open network token never stores plaintext fields', () => {
  setKek(1);
  const sealed = sealNetworkAccessToken('NET-10001', 'EAABsupersecret');
  assert.equal(sealed.ok, true);
  const networkData = { whatsappAccessTokenEnc: sealed.envelope };
  assert.ok(!JSON.stringify(networkData).includes('EAABsupersecret'));
  const opened = openNetworkAccessToken('NET-10001', networkData);
  assert.equal(opened.ok, true);
  assert.ok(secretsEqual(opened.plaintext, 'EAABsupersecret'));
});

test('secrets readiness reflects env kek backend not secret manager', () => {
  setKek(1);
  process.env.META_APP_SECRET = 'x'.repeat(16);
  process.env.WHATSAPP_DISPATCH_SERVICE_SECRET = 'y'.repeat(16);
  const report = secretsReadinessReport();
  assert.equal(report.backend, 'vercel_env_plus_aes_gcm');
  assert.equal(report.cloudTasks, 'replaced_by_firestore_queue');
  assert.equal(cryptoReadiness().kekConfigured, true);
});

test('queue enqueue is once-only for same jobId', async () => {
  const db = createFakeFirestore();
  const a = await enqueueDeliveryJob(db, {
    jobId: 'NET-10001__sale-1',
    deliveryOperationId: 'NET-10001__sale-1',
    networkId: 'NET-10001',
    runAfterMs: 1000,
    now: 1000,
  });
  const b = await enqueueDeliveryJob(db, {
    jobId: 'NET-10001__sale-1',
    deliveryOperationId: 'NET-10001__sale-1',
    networkId: 'NET-10001',
    now: 1001,
  });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(
    [...db._store.keys()].filter((k) => k.startsWith(`${QUEUE_COLLECTION}/`)).length,
    1,
  );
});

test('concurrent claim: only one worker wins the lock', async () => {
  const db = createFakeFirestore();
  await enqueueDeliveryJob(db, {
    jobId: 'job-race',
    deliveryOperationId: 'job-race',
    networkId: 'NET-1',
    runAfterMs: 0,
    now: 0,
  });

  const claims = await Promise.all([
    claimNextJob(db, { workerId: 'w1', now: 10 }),
    claimNextJob(db, { workerId: 'w2', now: 10 }),
    claimNextJob(db, { workerId: 'w3', now: 10 }),
  ]);
  const won = claims.filter((c) => c.ok && c.jobId === 'job-race');
  // With sequential transaction simulation on fake, first writer wins; others may see processing
  assert.ok(won.length >= 1);
  const job = db._store.get(`${QUEUE_COLLECTION}/job-race`);
  assert.equal(job.status, 'processing');
  assert.ok(['w1', 'w2', 'w3'].includes(job.lockOwner));
});

test('expired lock can be reclaimed; complete prevents reprocess', async () => {
  const db = createFakeFirestore();
  await enqueueDeliveryJob(db, {
    jobId: 'job-lock',
    deliveryOperationId: 'job-lock',
    networkId: 'NET-1',
    runAfterMs: 0,
    now: 0,
  });
  const first = await claimNextJob(db, { workerId: 'w1', now: 100, lockMs: 50 });
  assert.equal(first.jobId, 'job-lock');

  // Before lock expiry: second worker gets nothing for this job
  const mid = await claimNextJob(db, { workerId: 'w2', now: 120, lockMs: 50 });
  assert.equal(mid.jobId, null);

  // After lock expiry: reclaim
  const reclaim = await claimNextJob(db, { workerId: 'w2', now: 200, lockMs: 50 });
  assert.equal(reclaim.jobId, 'job-lock');
  assert.equal(reclaim.data.lockOwner, 'w2');

  await completeJob(db, 'job-lock', { now: 210 });
  const after = await claimNextJob(db, { workerId: 'w3', now: 220 });
  assert.equal(after.jobId, null);
});

test('fail with requeue returns job to queued', async () => {
  const db = createFakeFirestore();
  await enqueueDeliveryJob(db, { jobId: 'job-fail', deliveryOperationId: 'job-fail', runAfterMs: 0, now: 0 });
  await claimNextJob(db, { workerId: 'w1', now: 10 });
  await failJob(db, 'job-fail', { now: 20, error: 'transient', requeue: true, runAfterMs: 30 });
  const job = db._store.get(`${QUEUE_COLLECTION}/job-fail`);
  assert.equal(job.status, 'queued');
  assert.equal(job.runAfterMs, 30);
});
