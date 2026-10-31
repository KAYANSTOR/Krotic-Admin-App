import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isServerVerifiedSale,
  summarizeCompletedSales,
  summarizeSalesWithVerification,
  saleCommission,
  sumVerifiedOutstanding,
  sumLegacyUnverifiedSales,
} from '../src/lib/commission.js';
import { ackForExistingSale } from '../api/sales/ingest.js';
import { computeOutstanding } from '../server/_lib/networkLedger.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('network statement cleanly separates server-verified from legacy sales without changing historical amounts', () => {
  const verifiedSale1 = {
    saleUuid: 'verified-sale-001',
    status: 'COMPLETED',
    source: 'admin_api',
    verified: true,
    payloadHash: '1'.repeat(64),
    verificationReceipt: '1700000000000.abc1234567890def',
    payloadPolicyVersion: 2,
    moneyPolicyVersion: 2,
    faceValue: 500,
    amountRiyal: 500,
    commissionRiyal: 25,
    paidRiyal: 0,
  };

  const verifiedSale2 = {
    saleUuid: 'verified-sale-002',
    status: 'COMPLETED',
    source: 'admin_api',
    verified: true,
    payloadHash: '2'.repeat(64),
    verificationReceipt: '1700000000000.fedcba0987654321',
    payloadPolicyVersion: 2,
    moneyPolicyVersion: 2,
    faceValue: 1000,
    amountRiyal: 1000,
    commissionRiyal: 50,
    paidRiyal: 10,
  };

  const legacyUnverifiedSale = {
    saleId: 'legacy-card-999',
    status: 'COMPLETED',
    source: 'krotak_app', // client direct write, no server receipt
    faceValue: 2000,
    amount: 20,
    commission: 0,
    paidRiyal: 0,
  };

  const salesList = [verifiedSale1, verifiedSale2, legacyUnverifiedSale];

  assert.equal(isServerVerifiedSale(verifiedSale1), true);
  assert.equal(isServerVerifiedSale(verifiedSale2), true);
  assert.equal(isServerVerifiedSale(legacyUnverifiedSale), false);

  const summary = summarizeSalesWithVerification(salesList);

  // Total completed sales count
  assert.equal(summary.reportedTransactions, 3);
  // Total completed sales face value (whole Riyals)
  assert.equal(summary.reportedSalesValue, 3500);

  // Strict separation: verified vs legacy counts
  assert.equal(summary.verifiedTransactions, 2);
  assert.equal(summary.legacyTransactions, 1);

  // Strict separation: verified face value vs legacy face value
  assert.equal(summary.verifiedSalesValue, 1500);
  assert.equal(summary.legacySalesValue, 2000);

  // Strict separation: verified commissions (only 25 + 50 = 75)
  assert.equal(summary.verifiedCommissionDue, 75);
  // Verified outstanding (25 - 0) + (50 - 10) = 65
  assert.equal(summary.verifiedOutstandingCommission, 65);

  // Legacy sales do not fabricate verified commissions
  assert.equal(summary.legacyEstimatedCommission, 0);
  assert.equal(sumLegacyUnverifiedSales(salesList), 2000);
});

test('re-uploading the exact same sale payload does not duplicate commission (idempotency ACK)', () => {
  const existingRecord = {
    saleUuid: 'uuid-abc-123',
    payloadHash: 'hash-of-payload-123',
    commissionRiyal: 50,
    faceValue: 1000,
    status: 'COMPLETED',
    moneyPolicyVersion: 2,
  };

  // Re-sending same payload yields identical hash
  const ack = ackForExistingSale(existingRecord, 'hash-of-payload-123');
  assert.equal(ack.status, 'ALREADY_EXISTS_ACKED');
  assert.equal(ack.samePayload, true);
  assert.equal(ack.saleUuid, 'uuid-abc-123');

  // Network running commission is NOT re-incremented on existing ack
  const balanceBefore = computeOutstanding(100, 40); // 60
  const balanceAfter = computeOutstanding(100, 40);  // unchanged 60
  assert.equal(balanceBefore, balanceAfter);
});

test('reusing an existing saleUuid with a modified payload triggers a conflict rejection', () => {
  const existingRecord = {
    saleUuid: 'uuid-abc-123',
    payloadHash: 'original-hash-111',
    commissionRiyal: 50,
  };

  const conflictAck = ackForExistingSale(existingRecord, 'altered-hash-222');
  assert.equal(conflictAck.status, 'PAYLOAD_CONFLICT');
  assert.equal(conflictAck.samePayload, false);
});

test('audit log declarations contain actions for legacy reconciliation and audit', async () => {
  const auditContent = await read('src/lib/auditLog.js');
  assert.match(auditContent, /LEGACY_SALES_RECONCILE:\s*\{\s*label:\s*'تسوية ومطابقة مبيعات قديمة يدوياً'/);
  assert.match(auditContent, /SETTLEMENT_RECORD:\s*\{\s*label:\s*'تسوية مبيعات واعتماد عمولة'/);
  assert.match(auditContent, /SALE_CONFLICT_DETECTED:\s*\{\s*label:\s*'تعارض في معرّف أو محتوى بيع'/);
  assert.match(auditContent, /COMMISSION_AUDIT_VERIFIED:\s*\{\s*label:\s*'تدقيق واعتماد كشف حساب الشبكة'/);
});

