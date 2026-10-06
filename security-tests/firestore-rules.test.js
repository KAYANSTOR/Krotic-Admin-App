import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorAddress) {
  test('Firestore rules tests (run with npm run test:rules)', { skip: true }, () => {});
} else {
  const [host, port] = emulatorAddress.split(':');
  const projectId = 'demo-krotic-firestore-rules';
  let testEnv;

  const account = (uid) => ({
    uid,
    phone: '967777777777',
    network_name: 'Test Network',
    is_active: true,
    is_trial: false,
    platform: 'android',
    app_version: '1.0.0',
    created_at: Timestamp.now(),
    last_seen_at: Timestamp.now(),
  });

  async function seedFixtures() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'Admins/admin-1'), {
        uid: 'admin-1',
        name: 'Admin',
        email: 'admin@example.test',
        phone: '',
        createdAt: 1,
      });
      await setDoc(doc(db, 'users/user-1'), account('user-1'));
      await setDoc(doc(db, 'users/user-2'), account('user-2'));
      await setDoc(doc(db, 'app_settings/global_config'), {
        isAppActive: true,
        defaultCommissionRate: 5,
      });
      await setDoc(doc(db, 'app_settings/private_config'), {
        internalNote: 'Must remain admin-only.',
      });
      await setDoc(doc(db, 'app_settings/global_config/notifications/legacy-1'), {
        title: 'Old broadcast',
        body: 'This must not be readable by a normal account.',
        timestamp: Timestamp.now(),
      });
      await setDoc(doc(db, 'users/user-1/notifications/inbox-1'), {
        title: 'Account inbox item',
        is_read: false,
        timestamp: Timestamp.now(),
      });
      await setDoc(doc(db, 'admin_notification_history/history-1'), {
        title: 'Private admin history',
        timestamp: Timestamp.now(),
      });
    });
  }

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        host,
        port: Number(port),
        rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedFixtures();
  });

  after(async () => {
    await testEnv?.cleanup();
  });

  test('a signed-in user cannot create their own Admins document', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(setDoc(doc(db, 'Admins/user-1'), {
      uid: 'user-1',
      name: 'Promoted user',
      email: 'user@example.test',
      phone: '',
      createdAt: Date.now(),
    }));
  });

  test('an existing admin can provision another admin; normal accounts cannot', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(setDoc(doc(adminDb, 'Admins/admin-2'), {
      uid: 'admin-2',
      name: 'Second Admin',
      email: 'admin2@example.test',
      phone: '',
      createdAt: Date.now(),
    }));
    const userDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(setDoc(doc(userDb, 'Admins/user-1-copy'), {
      uid: 'user-1-copy',
      name: 'Normal user',
      email: 'user@example.test',
      phone: '',
      createdAt: Date.now(),
    }));
  });

  test('a user can read root app settings but cannot read old global notification archives', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    await assertSucceeds(getDoc(doc(db, 'app_settings/global_config')));
    await assertFails(getDoc(doc(db, 'app_settings/private_config')));
    await assertFails(getDocs(collection(db, 'app_settings/global_config/notifications')));
  });

  test('a new account gets no historical broadcasts and can only read its own inbox', async () => {
    const db = testEnv.authenticatedContext('new-user').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/new-user'), account('new-user')));

    const inbox = await assertSucceeds(getDocs(collection(db, 'users/new-user/notifications')));
    assert.equal(inbox.size, 0);
    await assertFails(getDocs(collection(db, 'app_settings/global_config/notifications')));
    await assertFails(getDoc(doc(db, 'users/user-1/notifications/inbox-1')));
  });

  test('self-registration accepts the current Android payload but rejects privileged fields', async () => {
    const db = testEnv.authenticatedContext('new-user').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/new-user'), account('new-user')));

    const secondDb = testEnv.authenticatedContext('malicious-user').firestore();
    await assertFails(setDoc(doc(secondDb, 'users/malicious-user'), {
      ...account('malicious-user'),
      commission_rate: 99,
      role: 'admin',
    }));
  });

  test('users cannot read other users or admin notification history', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(getDoc(doc(db, 'users/user-2')));
    await assertFails(getDoc(doc(db, 'admin_notification_history/history-1')));
  });

  test('owners can update presence and the is_read flag only', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users/user-1'), {
      last_seen_at: Timestamp.now(),
      app_version: '1.0.1',
    }));
    await assertSucceeds(updateDoc(doc(db, 'users/user-1/notifications/inbox-1'), {
      is_read: true,
    }));
    await assertFails(updateDoc(doc(db, 'users/user-1'), {
      is_active: false,
    }));
  });

  test('admins can read private history and nested legacy notifications', async () => {
    const db = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(getDoc(doc(db, 'admin_notification_history/history-1')));
    await assertSucceeds(getDocs(collection(db, 'app_settings/global_config/notifications')));
  });

  test('sale uploads are constrained and an owner cannot revise a completed sale', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    const saleRef = doc(db, 'networks/user-1/sales/sale-1');
    const sale = {
      saleId: 'sale-1',
      customerId: 'customer-1',
      cardId: 'card-1',
      faceValue: 100,
      amount: 100,
      amountMinor: 10000,
      currencyCode: 'IQD',
      face_value: 100,
      commission: 0,
      commissionAmount: 0,
      netAmount: 100,
      status: 'COMPLETED',
      createdAt: Timestamp.now(),
      created_at: Timestamp.now(),
      source: 'krotak_app',
    };
    await assertSucceeds(setDoc(saleRef, sale));
    await assertSucceeds(updateDoc(saleRef, sale));
    await assertFails(updateDoc(saleRef, { amountMinor: 990000 }));
    await assertFails(setDoc(doc(db, 'networks/user-1/sales/forged'), {
      ...sale,
      saleId: 'forged',
      status: 'PENDING',
    }));
    await assertFails(setDoc(doc(db, 'networks/user-1/sales/inconsistent'), {
      ...sale,
      saleId: 'inconsistent',
      amount: 999,
    }));
  });
}
