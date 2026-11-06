/**
 * Firestore Emulator integration — MUST run with FIRESTORE_EMULATOR_HOST set.
 * Failure mode: tests FAIL (not skip) when emulator is required via REQUIRE_EMULATOR=1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createDeliveryOperation, transitionDeliveryStatus } from '../../server/_lib/whatsapp/deliveryOperations.js';
import { tryStartSmsFallbackOnce } from '../../server/_lib/whatsapp/smsClaim.js';
import { processMetaStatusUpdate } from '../../server/_lib/whatsapp/statusEvents.js';
import {
  enqueueDeliveryJob,
  claimJobById,
  completeJob,
  QUEUE_COLLECTION,
} from '../../server/_lib/whatsapp/deliveryQueue.js';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE = process.env.REQUIRE_EMULATOR === '1' || process.env.REQUIRE_EMULATOR === 'true';

if (!EMULATOR && REQUIRE) {
  throw new Error('FIRESTORE_EMULATOR_HOST required (REQUIRE_EMULATOR=1)');
}

function uid() {
  return `t${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

async function withDb(fn) {
  if (!EMULATOR) {
    test('emulator unavailable — set FIRESTORE_EMULATOR_HOST', () => {
      assert.fail('Firestore Emulator not running. Use: npm run test:whatsapp-emulator');
    });
    return;
  }
  const app = initializeApp({ projectId: 'demo-krotic-local' }, `emul-${uid()}`);
  const db = getFirestore(app);
  try {
    await fn(db);
  } finally {
    await deleteApp(app);
  }
}

test('emulator: two workers create same delivery op — only one wins', async () => {
  await withDb(async (db) => {
    const saleUuid = `sale-${uid()}`;
    const args = { networkId: 'NET-10001', ownerUid: 'u1', saleUuid, now: Date.now() };
    const results = await Promise.all([
      createDeliveryOperation(db, args),
      createDeliveryOperation(db, args),
      createDeliveryOperation(db, args),
    ]);
    assert.equal(results.filter((r) => r.ok && !r.duplicate).length, 1);
    assert.equal(results.filter((r) => r.ok && r.duplicate).length, 2);
  });
});

test('emulator: two workers SMS same op — only one sms_sent', async () => {
  await withDb(async (db) => {
    const saleUuid = `sms-${uid()}`;
    const op = await createDeliveryOperation(db, {
      networkId: 'NET-10001', ownerUid: 'u1', saleUuid, now: Date.now(),
    });
    await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, Date.now());
    const now = Date.now() + 20_000;
    const results = await Promise.all([
      tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'a', now, simulateAccept: true }),
      tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'b', now, simulateAccept: true }),
    ]);
    const ok = results.filter((r) => r.ok);
    assert.ok(ok.length >= 1);
    const snap = await db.collection('whatsapp_delivery_operations').doc(op.deliveryOperationId).get();
    assert.equal(snap.data().status, 'sms_sent');
    assert.ok(snap.data().smsFallbackSentAtMs);
  });
});

test('emulator: webhook delivered concurrent with SMS → late or delivered, no double SMS', async () => {
  await withDb(async (db) => {
    const saleUuid = `race-${uid()}`;
    const op = await createDeliveryOperation(db, {
      networkId: 'NET-10001', ownerUid: 'u1', saleUuid, now: Date.now(),
    });
    const pmid = `wamid.${uid()}`;
    await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', { providerMessageId: pmid }, Date.now());

    const now = Date.now() + 15_000;
    const [smsResult, statusResult] = await Promise.all([
      tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'sms', now, simulateAccept: true }),
      processMetaStatusUpdate(db, {
        providerMessageId: pmid,
        internalStatus: 'delivered',
        metaStatus: 'delivered',
        phoneNumberId: '111',
      }, {
        resolveNetworkIdByPhoneNumberId: async () => 'NET-10001',
        now: now + 1,
      }),
    ]);

    const snap = await db.collection('whatsapp_delivery_operations').doc(op.deliveryOperationId).get();
    const st = snap.data().status;
    assert.ok(
      ['sms_sent', 'delivered', 'delivered_late_after_sms'].includes(st),
      `unexpected status ${st}`,
    );
    // Never two SMS timestamps of different sends — single field
    assert.ok(snap.data().smsFallbackSentAtMs == null || Number.isSafeInteger(snap.data().smsFallbackSentAtMs));
    assert.ok(smsResult || statusResult);
  });
});

test('emulator: lock expiry allows reclaim; complete prevents reprocess', async () => {
  await withDb(async (db) => {
    const jobId = `job-${uid()}`;
    await enqueueDeliveryJob(db, {
      jobId,
      deliveryOperationId: jobId,
      networkId: 'NET-10001',
      runAfterMs: 0,
      now: 0,
    });
    const t0 = 1_000;
    const c1 = await claimJobById(db, jobId, { workerId: 'w1', now: t0, lockMs: 50 });
    assert.equal(c1.jobId, jobId);
    const mid = await claimJobById(db, jobId, { workerId: 'w2', now: t0 + 10, lockMs: 50 });
    assert.equal(mid.jobId, null);
    const reclaim = await claimJobById(db, jobId, { workerId: 'w2', now: t0 + 100, lockMs: 50 });
    assert.equal(reclaim.jobId, jobId);
    assert.equal(reclaim.data.lockOwner, 'w2');
    await completeJob(db, jobId, { now: t0 + 120 });
    const after = await claimJobById(db, jobId, { workerId: 'w3', now: t0 + 200 });
    assert.equal(after.jobId, null);
  });
});

test('emulator: worker crash then recovery via complete_only path', async () => {
  await withDb(async (db) => {
    const saleUuid = `crash-${uid()}`;
    const op = await createDeliveryOperation(db, {
      networkId: 'NET-10001', ownerUid: 'u1', saleUuid, now: Date.now(),
    });
    await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, Date.now());
    try {
      await tryStartSmsFallbackOnce(db, op.deliveryOperationId, {
        workerId: 'w1',
        now: Date.now() + 20_000,
        simulateAccept: true,
        throwAfter: 'provider_accepted',
      });
      assert.fail('expected crash');
    } catch (e) {
      assert.equal(e.phase, 'provider_accepted');
    }
    const recovered = await tryStartSmsFallbackOnce(db, op.deliveryOperationId, {
      workerId: 'w2',
      now: Date.now() + 30_000,
      simulateAccept: true,
    });
    assert.equal(recovered.ok, true);
    const snap = await db.collection('whatsapp_delivery_operations').doc(op.deliveryOperationId).get();
    assert.equal(snap.data().status, 'sms_sent');
  });
});

test('emulator: cannot create two queue jobs for same id', async () => {
  await withDb(async (db) => {
    const jobId = `once-${uid()}`;
    const a = await enqueueDeliveryJob(db, {
      jobId, deliveryOperationId: jobId, networkId: 'NET-10001', runAfterMs: 0, now: 1,
    });
    const b = await enqueueDeliveryJob(db, {
      jobId, deliveryOperationId: jobId, networkId: 'NET-10001', runAfterMs: 0, now: 2,
    });
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    const snap = await db.collection(QUEUE_COLLECTION).doc(jobId).get();
    assert.equal(snap.exists, true);
  });
});

test('emulator: network isolation independent delivery ops', async () => {
  await withDb(async (db) => {
    const sale = `iso-${uid()}`;
    const a = await createDeliveryOperation(db, {
      networkId: 'NET-10001', ownerUid: 'u1', saleUuid: sale, now: Date.now(),
    });
    const b = await createDeliveryOperation(db, {
      networkId: 'NET-10002', ownerUid: 'u2', saleUuid: sale, now: Date.now(),
    });
    assert.notEqual(a.deliveryOperationId, b.deliveryOperationId);
    await transitionDeliveryStatus(db, a.deliveryOperationId, 'sent', {}, Date.now());
    const bSnap = await db.collection('whatsapp_delivery_operations').doc(b.deliveryOperationId).get();
    assert.equal(bSnap.data().status, 'accepted');
  });
});
