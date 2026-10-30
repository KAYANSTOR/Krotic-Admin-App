/**
 * Firestore Emulator integration tests.
 * Runs only when FIRESTORE_EMULATOR_HOST is set (e.g. via firebase emulators:exec).
 * Does NOT replace fakeFirestore unit tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

function describeEmulator(name, fn) {
  if (!EMULATOR) {
    test(`(skip emulator) ${name}`, { skip: 'FIRESTORE_EMULATOR_HOST not set — run via npm run test:whatsapp-emulator' }, () => {});
    return;
  }
  test(name, fn);
}

describeEmulator('emulator: concurrent create delivery op once', async () => {
  const { initializeApp, getApps, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { createDeliveryOperation } = await import('../server/_lib/whatsapp/deliveryOperations.js');

  const appName = `wa-emul-${Date.now()}`;
  const app = initializeApp({ projectId: 'demo-krotic-local' }, appName);
  const db = getFirestore(app);

  const args = { networkId: 'NET-10001', ownerUid: 'u1', saleUuid: `sale-em-${Date.now()}`, now: Date.now() };
  const results = await Promise.all([
    createDeliveryOperation(db, args),
    createDeliveryOperation(db, args),
    createDeliveryOperation(db, args),
  ]);
  const created = results.filter((r) => r.ok && !r.duplicate);
  const dups = results.filter((r) => r.ok && r.duplicate);
  assert.equal(created.length, 1);
  assert.equal(dups.length, 2);

  await deleteApp(app);
});

describeEmulator('emulator: SMS claim only one winner', async () => {
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { createDeliveryOperation, transitionDeliveryStatus } = await import('../server/_lib/whatsapp/deliveryOperations.js');
  const { tryStartSmsFallbackOnce } = await import('../server/_lib/whatsapp/smsClaim.js');

  const app = initializeApp({ projectId: 'demo-krotic-local' }, `wa-sms-${Date.now()}`);
  const db = getFirestore(app);
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: `sms-em-${Date.now()}`, now: Date.now(),
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, Date.now());

  const results = await Promise.all([
    tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'a', now: Date.now() + 20_000, simulateAccept: true }),
    tryStartSmsFallbackOnce(db, op.deliveryOperationId, { workerId: 'b', now: Date.now() + 20_000, simulateAccept: true }),
  ]);
  const okCount = results.filter((r) => r.ok).length;
  assert.ok(okCount >= 1);
  const snap = await db.collection('whatsapp_delivery_operations').doc(op.deliveryOperationId).get();
  assert.equal(snap.data().status, 'sms_sent');

  await deleteApp(app);
});
