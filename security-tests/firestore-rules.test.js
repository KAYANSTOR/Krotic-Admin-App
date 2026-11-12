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
  collectionGroup,
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
      await setDoc(doc(db, 'users/user-1/template_acks/device-12345678'), {
        uid: 'user-1', device_id: 'device-12345678', writer: 'server',
      });
      await setDoc(doc(db, 'users/user-1/account_feature_audit/audit-1'), {
        account_uid: 'user-1', action: 'account_features_update',
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
      await setDoc(doc(db, 'networks/NET-10001/device_heartbeats/install-1'), {
        installationId: 'install-1',
        accountId: 'user-1',
        serverReceivedAtMs: 1792992600000,
      });
      await setDoc(doc(db, 'device_bindings/install-1'), {
        uid: 'user-1',
        installationId: 'install-1',
      });
      await setDoc(doc(db, 'networks/NET-10001/sales/sale-1'), { saleId: 'sale-1', status: 'COMPLETED' });
      await setDoc(doc(db, 'networks/NET-10001/payments/payment-1'), { amount: 100 });
      await setDoc(doc(db, 'networks/NET-10001/wa_inbox/message-1'), {
        networkId: 'NET-10001', messageId: 'message-1', text: 'Incoming message',
        status: 'pending', receivedAtMs: 1792992600000, expiresAtMs: 1792993200000,
      });
      await setDoc(doc(db, 'networks/NET-10001/wa_deliveries/dlv-sale-1-card-1'), {
        deliveryOperationId: 'dlv-sale-1-card-1', networkId: 'NET-10001', saleRef: 'sale-1', cardRef: 'card-1',
        state: 'delivered', whatsappStatus: 'delivered', finalOutcome: 'whatsapp', createdAtMs: 1792992600000,
      });
      await setDoc(doc(db, 'networks/NET-10001/inventory_snapshot/current'), {
        schemaVersion: 1,
        snapshotId: 'snap-1',
        inventoryRevision: 3,
        totalAvailableCards: 40,
        totalReservedCards: 1,
        totalSoldCards: 10,
        totalInvalidCards: 0,
        breakdown: [],
      });
      await setDoc(doc(db, 'sync_tombstones/tombstone-1'), {
        collection: 'sales', networkId: 'NET-10001', id: 'old-sale', updatedAtMs: 1,
      });
      await setDoc(doc(db, 'whatsapp_network_secrets/NET-10001'), {
        whatsappAccessTokenEnc: 'test-ciphertext-only',
      });
      await setDoc(doc(db, 'whatsapp_message_requests/request-1'), {
        networkId: 'NET-10001', requestHash: 'opaque-test-hash', status: 'sent',
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

  test('template drafts, releases and active pointers are server-only', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const userDb = testEnv.authenticatedContext('user-1').firestore();
    const protectedPaths = [
      'template_center_drafts/draft-1',
      'template_center_releases/release-1',
      'template_center_pointers/global',
    ];

    for (const path of protectedPaths) {
      await assertFails(getDoc(doc(adminDb, path)));
      await assertFails(setDoc(doc(adminDb, path), { value: 'admin-client-write' }));
      await assertFails(getDoc(doc(userDb, path)));
      await assertFails(setDoc(doc(userDb, path), { value: 'user-client-write' }));
    }
  });

  test('admins can read billing aggregates while normal accounts cannot', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertSucceeds(getDoc(doc(adminDb, 'admin_aggregates/user-1')));

    const userDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(getDoc(doc(userDb, 'admin_aggregates/user-1')));
  });

  test('only admins can read sales and payments collection groups', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const userDb = testEnv.authenticatedContext('user-1').firestore();

    const sales = await assertSucceeds(getDocs(collectionGroup(adminDb, 'sales')));
    assert.equal(sales.size, 1);
    const payments = await assertSucceeds(getDocs(collectionGroup(adminDb, 'payments')));
    assert.equal(payments.size, 1);
    await assertFails(getDocs(collectionGroup(userDb, 'sales')));
    await assertFails(getDocs(collectionGroup(userDb, 'payments')));
  });

  test('heartbeat telemetry is server-write-only and admin-readable', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const otherDb = testEnv.authenticatedContext('user-2').firestore();
    const heartbeatPath = 'networks/NET-10001/device_heartbeats/install-1';

    await assertSucceeds(getDoc(doc(adminDb, heartbeatPath)));
    await assertFails(setDoc(doc(adminDb, 'networks/NET-10001/device_heartbeats/client-write'), {
      installationId: 'client-write',
    }));
    await assertFails(getDoc(doc(ownerDb, heartbeatPath)));
    await assertFails(setDoc(doc(ownerDb, 'networks/NET-10001/device_heartbeats/client-write'), {
      installationId: 'client-write',
    }));
    await assertFails(getDoc(doc(otherDb, heartbeatPath)));
    await assertFails(setDoc(doc(otherDb, 'networks/NET-10001/device_heartbeats/client-write'), {
      installationId: 'client-write',
    }));
  });

  test('device bindings are server-write-only and never readable by the device owner', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const otherDb = testEnv.authenticatedContext('user-2').firestore();

    await assertSucceeds(getDoc(doc(adminDb, 'device_bindings/install-1')));
    await assertFails(setDoc(doc(adminDb, 'device_bindings/install-2'), {
      uid: 'user-1', installationId: 'install-2',
    }));
    await assertFails(getDoc(doc(ownerDb, 'device_bindings/install-1')));
    await assertFails(setDoc(doc(ownerDb, 'device_bindings/install-1'), {
      uid: 'user-2', installationId: 'install-1',
    }));
    await assertFails(getDoc(doc(otherDb, 'device_bindings/install-1')));
  });

  test('inventory snapshots are admin-readable and server-write-only', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const otherDb = testEnv.authenticatedContext('user-2').firestore();
    const snapshotPath = 'networks/NET-10001/inventory_snapshot/current';

    await assertSucceeds(getDoc(doc(adminDb, snapshotPath)));
    await assertFails(setDoc(doc(adminDb, 'networks/NET-10001/inventory_snapshot/client-write'), { totalAvailableCards: 1 }));
    await assertFails(getDoc(doc(ownerDb, snapshotPath)));
    await assertFails(setDoc(doc(ownerDb, 'networks/NET-10001/inventory_snapshot/client-write'), { totalAvailableCards: 1 }));
    await assertFails(getDoc(doc(otherDb, snapshotPath)));
  });

  test('sync tombstones are admin-readable and server-write-only', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const userDb = testEnv.authenticatedContext('user-1').firestore();
    const adminTombstone = doc(adminDb, 'sync_tombstones/tombstone-1');

    await assertSucceeds(getDoc(adminTombstone));
    await assertFails(setDoc(doc(adminDb, 'sync_tombstones/client-write'), { collection: 'sales' }));
    await assertFails(getDoc(doc(userDb, 'sync_tombstones/tombstone-1')));
    await assertFails(setDoc(doc(userDb, 'sync_tombstones/client-write'), { collection: 'sales' }));
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

  test('phone registration index is not accessible to clients', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore();
    const phoneIndex = doc(db, 'network_registration_phone_index/opaque-hash');
    await assertFails(getDoc(phoneIndex));
    await assertFails(setDoc(phoneIndex, { uid: 'user-1' }));
  });

  test('retired WhatsApp server collections stay closed by default deny', async () => {
    const clients = [
      testEnv.authenticatedContext('admin-1').firestore(),
      testEnv.authenticatedContext('user-1').firestore(),
      testEnv.authenticatedContext('user-2').firestore(),
    ];
    for (const db of clients) {
      const tokenRef = doc(db, 'whatsapp_network_secrets/NET-10001');
      const requestRef = doc(db, 'whatsapp_message_requests/request-1');
      await assertFails(getDoc(tokenRef));
      await assertFails(setDoc(doc(db, 'whatsapp_network_secrets/client-write'), { value: 'ciphertext' }));
      await assertFails(getDoc(requestRef));
      await assertFails(setDoc(doc(db, 'whatsapp_message_requests/client-write'), { status: 'sent' }));
      await assertFails(updateDoc(requestRef, { status: 'delivered' }));
      await assertFails(deleteDoc(requestRef));
    }
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
      app_version_code: 15,
    }));
    await assertFails(updateDoc(doc(db, 'users/user-1'), { app_version_code: '15' }));
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
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { account_features: { sms_auto_parser: true } }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { account_features_version: 1 }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { account_features_updated_at_ms: Date.now() }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { account_features_updated_by: 'admin-1' }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { account_features_source: 'admin_api' }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { entitlementInstallationId: 'attacker-device' }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { entitlementVersion: 99 }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { entitlementReboundBy: 'admin-1' }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { networkId: 'NET-99999' }));
    await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { network_id: 'NET-99999' }));
    for (const field of ['entitlementPendingTransfer', 'entitlementInstallationHistory', 'entitlementAutoTransfersMs',
      'entitlementLastTransferAtMs', 'entitlementLastTransferBy', 'accessUpdatedAtMs']) {
      await assertFails(updateDoc(doc(adminDb, 'users/user-1'), { [field]: null }), field);
    }
    await assertSucceeds(updateDoc(doc(adminDb, 'users/user-1'), { network_name: 'Renamed' }));

    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    await assertFails(updateDoc(doc(ownerDb, 'users/user-1'), { account_features: { sms_auto_parser: true } }));
  });

  test('template ACK and account feature audit subcollections are server-write-only', async () => {
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const ackPath = 'users/user-1/template_acks/device-12345678';
    const auditPath = 'users/user-1/account_feature_audit/audit-1';

    await assertSucceeds(getDoc(doc(adminDb, ackPath)));
    await assertSucceeds(getDoc(doc(adminDb, auditPath)));
    await assertFails(setDoc(doc(adminDb, 'users/user-1/template_acks/device-87654321'), { writer: 'client' }));
    await assertFails(setDoc(doc(adminDb, 'users/user-1/account_feature_audit/audit-2'), { actor_uid: 'admin-1' }));
    await assertFails(setDoc(doc(adminDb, 'users/user-1/account_features/current'), { hotspot_template_editor: true }));
    await assertFails(setDoc(doc(adminDb, 'users/user-1/feature_entitlements/current'), { hotspot_template_editor: true }));
    await assertFails(updateDoc(doc(adminDb, ackPath), { outcome: 'applied' }));
    await assertFails(updateDoc(doc(adminDb, auditPath), { action: 'tampered' }));

    await assertFails(getDoc(doc(ownerDb, ackPath)));
    await assertFails(getDoc(doc(ownerDb, auditPath)));
    await assertFails(setDoc(doc(ownerDb, 'users/user-1/template_acks/device-owner'), { writer: 'client' }));
    await assertFails(setDoc(doc(ownerDb, 'users/user-1/account_feature_audit/audit-owner'), { actor_uid: 'user-1' }));
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

  test('sales are server-written only: owners and admins cannot write them directly', async () => {
    const sale = {
      saleId: 'sale-1',
      amountMinor: 10000,
      currencyCode: 'YER',
      status: 'COMPLETED',
      source: 'krotak_app',
      createdAt: Timestamp.now(),
    };
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    await assertFails(setDoc(doc(ownerDb, 'networks/user-1/sales/sale-1'), sale));
    await assertFails(setDoc(doc(adminDb, 'networks/user-1/sales/sale-2'), { ...sale, saleId: 'sale-2' }));
  });

  test('WhatsApp inbox is owner-readable, server-created, and processing-only for the owner', async () => {
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const otherDb = testEnv.authenticatedContext('user-2').firestore();
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const ownerRef = doc(ownerDb, 'networks/NET-10001/wa_inbox/message-1');
    const adminRef = doc(adminDb, 'networks/NET-10001/wa_inbox/message-1');

    await assertSucceeds(getDoc(ownerRef));
    await assertSucceeds(getDoc(adminRef));
    await assertFails(getDoc(doc(otherDb, 'networks/NET-10001/wa_inbox/message-1')));
    await assertFails(setDoc(doc(ownerDb, 'networks/NET-10001/wa_inbox/client-created'), {
      networkId: 'NET-10001', messageId: 'client-created', text: 'forged', status: 'pending',
    }));
    await assertFails(deleteDoc(ownerRef));
    await assertFails(deleteDoc(adminRef));

    await assertSucceeds(updateDoc(ownerRef, {
      status: 'processing',
      processedAt: Timestamp.now(),
      processedBy: 'user-1',
    }));
    await assertFails(updateDoc(ownerRef, { text: 'tampered message' }));
    await assertFails(updateDoc(ownerRef, { status: 'delivered' }));
  });

  test('WhatsApp delivery operations are owner/admin-readable and server-written only', async () => {
    const ownerDb = testEnv.authenticatedContext('user-1').firestore();
    const otherDb = testEnv.authenticatedContext('user-2').firestore();
    const adminDb = testEnv.authenticatedContext('admin-1').firestore();
    const path = 'networks/NET-10001/wa_deliveries/dlv-sale-1-card-1';

    await assertSucceeds(getDoc(doc(ownerDb, path)));
    await assertSucceeds(getDoc(doc(adminDb, path)));
    await assertFails(getDoc(doc(otherDb, path)));
    // Neither the owner nor an admin client may forge or alter a delivery outcome (Admin SDK only).
    await assertFails(updateDoc(doc(ownerDb, path), { state: 'sms_fallback_sent' }));
    await assertFails(updateDoc(doc(adminDb, path), { finalOutcome: 'sms' }));
    await assertFails(setDoc(doc(ownerDb, 'networks/NET-10001/wa_deliveries/dlv-forged-0001'), {
      deliveryOperationId: 'dlv-forged-0001', state: 'delivered',
    }));
    await assertFails(deleteDoc(doc(ownerDb, path)));
    await assertFails(deleteDoc(doc(adminDb, path)));
  });
}
