import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ingestSale,
} from '../server/apiHandlers/sales-ingest.js';
import { isAdminUid } from '../server/_lib/firebaseAdmin.js';
import {
  computePayloadHash,
  createInternalReceipt,
  verifyInternalReceipt,
  isSaleAllowedForAccount,
} from '../server/apiHandlers/sales-ingest.js';
import {
  generateNetworkSecret,
  encryptNetworkSecret,
  decryptNetworkSecret,
} from '../server/_lib/networkSecret.js';
import {
  validateTemplatePayload,
  simulateInboundTemplates,
  previewOutboundTemplate,
  getTemplateCenterCatalog,
} from '../server/_lib/templateCenter.js';
import { cloneBundledPack } from '../src/lib/bundledTemplatePack.js';

const MASTER_SECRET = 'test-master-hmac-secret-32-bytes-minimum-length-012345';

test('CONTRACT: End-to-end secret provisioning, HMAC signing, and sales ingest validation', () => {
  // 1. Secret generation and encrypted storage
  const networkSecret = generateNetworkSecret();
  assert.match(networkSecret, /^[A-Za-z0-9_-]{43}$/);
  const encryptedEnvelope = encryptNetworkSecret(networkSecret, MASTER_SECRET);
  assert.equal(decryptNetworkSecret(encryptedEnvelope, MASTER_SECRET), networkSecret);

  // 2. Client sale payload (exact format per contract)
  const clientSale = {
    saleId: 'sale-test-uuid-001',
    uid: 'client-user-123',
    amountMinor: 250000,
    amountRiyal: 2500,
    currencyCode: 'YER',
    customerId: 'cust-456',
    cardId: 'card-789',
    createdMs: 1_700_000_000_000,
  };

  // 3. Client signs sale with networkSecret
  const receiptTimestamp = 1_700_000_000_000;
  const signatureReceipt = createInternalReceipt({
    payload: clientSale,
    timestamp: receiptTimestamp,
    secret: networkSecret,
  });

  // 4. Server verifies HMAC receipt
  const verification = verifyInternalReceipt({
    token: signatureReceipt,
    payload: clientSale,
    secret: networkSecret,
    now: receiptTimestamp + 5000, // 5 seconds later
  });
  assert.equal(verification.ok, true);

  // 5. Tampered payload is rejected
  const tamperedPayload = { ...clientSale, amountMinor: 260000, amountRiyal: 2600 };
  const tamperedCheck = verifyInternalReceipt({
    token: signatureReceipt,
    payload: tamperedPayload,
    secret: networkSecret,
    now: receiptTimestamp + 5000,
  });
  assert.equal(tamperedCheck.ok, false);
  assert.equal(tamperedCheck.error, 'hmac_invalid');
});

test('CONTRACT: Expiry enforcement respects offline outbox sync policy', () => {
  const expiryTimestamp = 1_700_000_000_000; // when subscription expired
  const now = expiryTimestamp + 86_400_000; // 1 day after expiry

  const expiredAccount = {
    accessStatus: 'LOCKED_EXPIRED',
    subscriptionEndsAt: expiryTimestamp,
    is_active: false,
  };

  // Scenario A: Sale made when account was still active, but synced after expiry (Outbox backlog)
  const saleBeforeExpiry = expiryTimestamp - 3600_000; // 1 hour before expiry
  const resultA = isSaleAllowedForAccount(expiredAccount, saleBeforeExpiry, now);
  assert.equal(resultA.ok, true, 'Old sale created before expiry must be permitted to ingest');

  // Scenario B: Sale made after account was expired (unauthorized commercial activity)
  const saleAfterExpiry = expiryTimestamp + 3600_000; // 1 hour after expiry
  const resultB = isSaleAllowedForAccount(expiredAccount, saleAfterExpiry, now);
  assert.equal(resultB.ok, false);
  assert.equal(resultB.status, 403);
  assert.equal(resultB.error, 'subscription_expired_new_sales_locked');
  assert.equal(resultB.subscriptionEndsAtMs, expiryTimestamp);
});

test('CONTRACT: Template center read-active contract and catalog compatibility', () => {
  const catalog = getTemplateCenterCatalog();
  assert.ok(catalog.identifierKinds.includes('phone'));
  assert.ok(catalog.inboundPlaceholders.includes('amount'));

  // Real canonical pack extracted from the official Android seeders — the ids
  // here are the ones Android actually seeds, so publishing maps onto the same
  // rows instead of creating duplicates.
  const canonicalPack = cloneBundledPack('2026-10-21T00:00:00.000Z');
  const validation = validateTemplatePayload(canonicalPack, { allowDrafts: false });
  assert.equal(validation.ok, true, `canonical Android catalog must be publishable: ${(validation.errors || []).join(', ')}`);

  // Every inbound template id matches the Android formula, and each links a wallet.
  const walletIds = new Set(canonicalPack.wallets.map((wallet) => wallet.id));
  for (const template of canonicalPack.transferTemplates) {
    assert.match(template.id, /^tpl-default-[a-z0-9-]+$/);
    assert.ok(walletIds.has(template.walletId), `${template.id} must link a canonical wallet`);
  }

  // Verify inbound simulation on the canonical Jawali received sample (sender
  // is the official Sender ID, as Android matches it exactly).
  const jawali = canonicalPack.transferTemplates.find((template) => template.id === 'tpl-default-jawali-ar-received');
  const sim = simulateInboundTemplates(canonicalPack, { body: jawali.sampleBody, sender: 'Jawali' });
  assert.equal(sim.matched, true);
  assert.equal(sim.templateId, 'tpl-default-jawali-ar-received');
  assert.equal(sim.financialSideEffect, false);

  // Verify outbound preview renders the canonical body.
  const debt = canonicalPack.outboundTemplates.find((template) => template.key === 'customer_debt_payment_template');
  const preview = previewOutboundTemplate(debt, {
    amount: '1000', paid: '500', surplus: '500', balance: '5000', CURRENCY: 'ر.ي',
  });
  assert.equal(preview.ok, true);
  assert.match(preview.preview, /تم استلام إيداع بمبلغ 1000/);
});

class FakeDocumentReference {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new FakeCollectionReference(this.db, `${this.path}/${name}`); }
}
class FakeCollectionReference {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new FakeDocumentReference(this.db, `${this.path}/${id}`); }
}
class FakeFirestore {
  constructor() { this.docs = new Map(); }
  collection(name) { return new FakeCollectionReference(this, name); }
  async runTransaction(callback) {
    const writes = []; let firstWrite = false;
    const tx = {
      get: async (ref) => {
        if (firstWrite) throw new Error('Firestore read after write');
        const v = this.docs.get(ref.path);
        return { exists: v !== undefined, data: () => v };
      },
      set: (ref, value, options = {}) => {
        firstWrite = true;
        writes.push({ ref, value, options });
      },
    };
    const result = await callback(tx);
    for (const { ref, value, options } of writes) {
      const old = this.docs.get(ref.path) || {};
      this.docs.set(ref.path, options.merge ? { ...old, ...value } : value);
    }
    return result;
  }
}

test('CONTRACT: Replay idempotency does not double-count commission or sales totals', async () => {
  const db = new FakeFirestore();
  db.docs.set('networks/NET-100', {
    totalSalesAmount: 1000,
    totalCommissionDue: 50,
    totalPaidAmount: 0,
    outstandingBalance: 50,
  });

  const payload = {
    saleId: 'sale-replay-test',
    saleUuid: 'sale-replay-test',
    amountMinor: 200000,
    amountRiyal: 2000,
    currencyCode: 'YER',
    createdMs: 1_700_000_000_000,
  };
  const payloadHash = computePayloadHash({ ...payload, uid: 'user-replay' });

  // 1. Initial Ingest
  const first = await ingestSale({
    db,
    uid: 'user-replay',
    networkId: 'NET-100',
    payload,
    payloadHash,
    receipt: 'valid-receipt',
    commissionRateBps: 500, // 5%
  });
  assert.equal(first.status, 'created');
  assert.equal(first.commissionRiyal, 100);

  // Network totals incremented
  const netAfterFirst = db.docs.get('networks/NET-100');
  assert.equal(netAfterFirst.totalSalesAmount, 3000);
  assert.equal(netAfterFirst.totalCommissionDue, 150);
  assert.equal(netAfterFirst.outstandingBalance, 150);

  // 2. Exact Replay of the same sale
  const replay = await ingestSale({
    db,
    uid: 'user-replay',
    networkId: 'NET-100',
    payload,
    payloadHash,
    receipt: 'valid-receipt',
    commissionRateBps: 500,
  });
  assert.equal(replay.status, 'ALREADY_EXISTS_ACKED');
  assert.equal(replay.samePayload, true);

  // Totals must NOT change on replay
  const netAfterReplay = db.docs.get('networks/NET-100');
  assert.equal(netAfterReplay.totalSalesAmount, 3000);
  assert.equal(netAfterReplay.totalCommissionDue, 150);
  assert.equal(netAfterReplay.outstandingBalance, 150);
});

test('CONTRACT: Sale UUID conflict with altered payload is rejected and recorded', async () => {
  const db = new FakeFirestore();
  db.docs.set('networks/NET-100', {
    totalSalesAmount: 1000,
    totalCommissionDue: 50,
    totalPaidAmount: 0,
    outstandingBalance: 50,
  });

  const payload = {
    saleId: 'sale-conflict-test',
    saleUuid: 'sale-conflict-test',
    amountMinor: 100000,
    amountRiyal: 1000,
    currencyCode: 'YER',
    createdMs: 1_700_000_000_000,
  };
  const payloadHashOriginal = computePayloadHash({ ...payload, uid: 'user-c' });

  await ingestSale({
    db,
    uid: 'user-c',
    networkId: 'NET-100',
    payload,
    payloadHash: payloadHashOriginal,
    receipt: 'valid-receipt',
    commissionRateBps: 500,
  });

  // Attempt to reuse same saleUuid with altered amount
  const alteredPayload = { ...payload, amountMinor: 200000, amountRiyal: 2000 };
  const payloadHashAltered = computePayloadHash({ ...alteredPayload, uid: 'user-c' });

  const conflictResult = await ingestSale({
    db,
    uid: 'user-c',
    networkId: 'NET-100',
    payload: alteredPayload,
    payloadHash: payloadHashAltered,
    receipt: 'valid-receipt',
    commissionRateBps: 500,
  });

  assert.equal(conflictResult.status, 'conflict');
  assert.equal(conflictResult.error, 'payload_conflict');

  // Conflict is audited in registry
  const registryEntry = db.docs.get('sale_ingest_registry/user-c_sale-conflict-test');
  assert.ok(registryEntry);
  assert.equal(registryEntry.reason, 'payload_conflict');
  assert.equal(registryEntry.previousHash, payloadHashOriginal);
  assert.equal(registryEntry.incomingHash, payloadHashAltered);
});

test('CONTRACT: Admin accounts are rejected from client-only endpoints', async () => {
  // Mock Firestore getter
  const fakeDb = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => ({
          exists: col === 'Admins' && id === 'admin-123',
          data: () => (col === 'Admins' && id === 'admin-123' ? { uid: 'admin-123', role: 'admin' } : null),
        }),
      }),
    }),
  };

  const isAdmin = await isAdminUid('admin-123', () => fakeDb);
  assert.equal(isAdmin, true);

  const isClient = await isAdminUid('client-456', () => fakeDb);
  assert.equal(isClient, false);
});
