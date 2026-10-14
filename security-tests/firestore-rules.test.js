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
  deleteDoc,
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

  // الملف الشخصي فقط: لا حقول صلاحية (is_active/is_trial) — صارت قرارًا خادميًا.
  const account = (uid) => ({
    uid,
    phone: '967777777777',
    network_name: 'Test Network',
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
      await setDoc(doc(db, 'admin_aggregates/user-1'), {
        totalFaceValue: 1000,
        totalTransactions: 2,
        totalAdminEarnings: 50,
        totalPaid: 0,
      });
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
      // هوية شبكة خادمية (NET-xxxxx) مرتبطة بالمالك عبر owner_uid.
      await setDoc(doc(db, 'networks/NET-10001'), {
        networkId: 'NET-10001',
        owner_uid: 'user-1',
        accessStatus: 'TRIAL',
      });
      await setDoc(doc(db, 'networks/NET-10001/settlements/settlement-1'), {
        amountMinor: 100,
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

  test('admin documents are server-write-only; a client admin cannot write them', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertFails(setDoc(doc(adminDb, 'Admins/admin-2'), {
      uid: 'admin-2',
      name: 'Second Admin',
      email: 'admin2@example.test',
      phone: '',
      createdAt: Date.now(),
    }));
    await assertFails(deleteDoc(doc(adminDb, 'Admins/admin-1')));
    // القراءة للمدير مسموحة (لعرض القائمة).
    await assertSucceeds(getDoc(doc(adminDb, 'Admins/admin-1')));

    const userDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(setDoc(doc(userDb, 'Admins/user-1-copy'), {
      uid: 'user-1-copy',
      name: 'Normal user',
      email: 'user@example.test',
      phone: '',
      createdAt: Date.now(),
    }));
  });

  test('admins can read billing aggregates while normal accounts cannot', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'admin_aggregates/user-1')));

    const userDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(getDoc(doc(userDb, 'admin_aggregates/user-1')));
  });

  test('payment and settlement records are server-write-only for every client', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertFails(setDoc(doc(adminDb, 'networks/user-1/payments/payment-1'), { amount: 25, month: '2026-10' }));
    await assertFails(setDoc(doc(adminDb, 'networks/NET-10001/settlements/settlement-2'), { amountMinor: 50 }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'networks/user-1/payments/payment-1'), { amount: 25, month: '2026-10' });
    });
    const paymentRef = doc(adminDb, 'networks/user-1/payments/payment-1');
    await assertSucceeds(getDoc(paymentRef));
    await assertFails(updateDoc(paymentRef, { amount: 30 }));
    await assertFails(deleteDoc(paymentRef));

    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(setDoc(doc(ownerDb, 'networks/user-1/payments/payment-2'), { amount: 10, month: '2026-10' }));
  });

  test('the hardcoded primary-admin bypass no longer exists', async () => {
    const exPrimaryDb = testEnv.authenticatedContext('akicZMi3cqcDXqlLUZMLL9OdAg53', {
      email: 'jarallhalkboudi@gmail.com',
    }).firestore();
    await assertFails(setDoc(doc(exPrimaryDb, 'private_test_records/record-1'), { value: 1 }));
    await assertFails(getDoc(doc(exPrimaryDb, 'private_test_records/record-1')));
  });

  test('a user can read root app settings but cannot read private settings or old broadcasts', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    await assertSucceeds(getDoc(doc(db, 'app_settings/global_config')));
    await assertFails(getDoc(doc(db, 'app_settings/private_config')));
    await assertFails(getDocs(collection(db, 'app_settings/global_config/notifications')));
  });

  test('app settings are server-write-only even for admins', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertFails(setDoc(doc(adminDb, 'app_settings/global_config'), { is_app_active: false }, { merge: true }));
  });

  test('a new account gets no historical broadcasts and can only read its own inbox', async () => {
    const db = testEnv.authenticatedContext('new-user').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/new-user'), account('new-user')));

    const inbox = await assertSucceeds(getDocs(collection(db, 'users/new-user/notifications')));
    assert.equal(inbox.size, 0);
    await assertFails(getDocs(collection(db, 'app_settings/global_config/notifications')));
    await assertFails(getDoc(doc(db, 'users/user-1/notifications/inbox-1')));
  });


  test('self-registration accepts the profile payload but rejects access fields', async () => {
    const db = testEnv.authenticatedContext('new-user').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/new-user'), account('new-user')));

    const privileged = testEnv.authenticatedContext('privileged-user').firestore();
    await assertFails(setDoc(doc(privileged, 'users/privileged-user'), {
      ...account('privileged-user'),
      is_active: true,
    }));
    await assertFails(setDoc(doc(privileged, 'users/privileged-user'), {
      ...account('privileged-user'),
      is_trial: false,
    }));
    await assertFails(setDoc(doc(privileged, 'users/privileged-user'), {
      ...account('privileged-user'),
      commission_rate: 99,
      accessStatus: 'ACTIVE_PAID',
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
    await assertFails(updateDoc(doc(db, 'users/user-1'), { is_active: false }));
  });

  test('access and billing fields are server-owned: not even an admin can write them', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { is_active: false }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { is_trial: false }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { accessStatus: 'LOCKED_EXPIRED' }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { subscriptionEndsAt: Timestamp.now() }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { commission_rate: 3 }));
    await assertSucceeds(updateDoc(doc(adminDb, 'users/user-1'), { network_name: 'Renamed' }));
  });

  test('network identity documents are server-write-only but readable by admin and owner', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'networks/NET-10001')));
    await assertFails(setDoc(doc(adminDb, 'networks/NET-10002'), { networkId: 'NET-10002', owner_uid: 'user-2' }));

    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    await assertSucceeds(getDoc(doc(ownerDb, 'networks/NET-10001')));
    await assertFails(setDoc(doc(ownerDb, 'networks/NET-10001'), { accessStatus: 'ACTIVE_PAID' }, { merge: true }));

    const strangerDb = testEnv.authenticatedContext('user-2').firestore();
    await assertFails(getDoc(doc(strangerDb, 'networks/NET-10001')));
  });

  test('admins can read private history and nested legacy notifications', async () => {
    const db = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(getDoc(doc(db, 'admin_notification_history/history-1')));
    await assertSucceeds(getDocs(collection(db, 'app_settings/global_config/notifications')));
  });

  test('every admin can read and append the audit log; it stays append-only', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(setDoc(doc(adminDb, 'admin_audit_logs/log-1'), {
      action: 'SETTINGS_SAVE',
      actorUid: 'admin-1',
      createdAtMs: 1,
    }));
    await assertSucceeds(getDocs(collection(adminDb, 'admin_audit_logs')));
    await assertFails(updateDoc(doc(adminDb, 'admin_audit_logs/log-1'), { action: 'TAMPERED' }));
    await assertFails(deleteDoc(doc(adminDb, 'admin_audit_logs/log-1')));

    const userDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(setDoc(doc(userDb, 'admin_audit_logs/log-2'), {
      action: 'SETTINGS_SAVE',
      actorUid: 'user-1',
      createdAtMs: 2,
    }));
    await assertFails(getDocs(collection(userDb, 'admin_audit_logs')));
  });

  test('sale uploads are constrained; server-owned fields and revisions are rejected', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    const saleRef = doc(db, 'networks/user-1/sales/sale-1');
    const sale = {
      saleId: 'sale-1',
      customerId: 'customer-1',
      cardId: 'card-1',
      faceValue: 100,
      amount: 100,
      amountMinor: 10000,
      currencyCode: 'YER',
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
    await assertFails(setDoc(doc(db, 'networks/user-1/sales/server-fields'), {
      ...sale,
      saleId: 'server-fields',
      settlement_status: 'SETTLED',
    }));
    await assertFails(setDoc(doc(db, 'networks/user-1/sales/server-commission'), {
      ...sale,
      saleId: 'server-commission',
      commissionMinor: 500,
    }));
  });
}

