import test from 'node:test';
import assert from 'node:assert/strict';
import { saleCommission, sumCommission, hasUnverifiedCommission, saleOutstanding, sumOutstanding, summarizeCompletedSales, isServerVerifiedSale, sumVerifiedCommission, sumVerifiedOutstanding, summarizeSalesWithVerification } from '../src/lib/commission.js';

test('panel commission is read from server fields only', () => {
  assert.equal(saleCommission({ commissionMinor: 50 }), 50);
  assert.equal(saleCommission({ commissionAmount: 30 }), 30);
  assert.equal(saleCommission({ commission: 20 }), 20);
  assert.equal(saleCommission({ commissionMinor: 0 }), 0);
  assert.equal(saleCommission({ faceValue: 1000 }), null);
  assert.equal(saleCommission({ commissionMinor: null }), null);
  assert.equal(saleCommission({ commissionMinor: 'x' }), null);
});

test('V2 commission reads whole Riyal fields before legacy minor-unit aliases', () => {
  assert.equal(saleCommission({ commissionRiyal: 25, commissionMinor: 2500, commission: 25 }), 25);
  assert.equal(saleOutstanding({
    moneyPolicyVersion: 2, commissionRiyal: 25, commissionMinor: 2500,
    paidRiyal: 10, paidMinor: 1000,
  }), 15);
});

test('summing and unverified detection never invent a local commission', () => {
  assert.equal(sumCommission([{ commissionMinor: 50 }, { commission: 30 }]), 80);
  assert.equal(sumCommission([{ faceValue: 100 }]), 0);
  assert.equal(hasUnverifiedCommission([{ commissionMinor: 1 }, { faceValue: 2 }]), true);
  assert.equal(hasUnverifiedCommission([{ commissionMinor: 1 }]), false);
  assert.equal(hasUnverifiedCommission([]), false);
});

test('outstanding commission excludes settled amounts (only unsettled shows to admin)', () => {
  assert.equal(saleOutstanding({ commissionMinor: 100, paidMinor: 0 }), 100);
  assert.equal(saleOutstanding({ commissionMinor: 100, paidMinor: 40 }), 60);
  assert.equal(saleOutstanding({ commissionMinor: 100, paidMinor: 100 }), 0);
  assert.equal(saleOutstanding({ commissionMinor: 100, paidMinor: 150 }), 0);
  assert.equal(saleOutstanding({ faceValue: 100 }), 0); // غير متحقق -> لا شيء

  assert.equal(sumOutstanding([
    { commissionMinor: 100, paidMinor: 100 }, // مسوّاة بالكامل
    { commissionMinor: 100, paidMinor: 40 },  // جزئية
    { commissionMinor: 50, paidMinor: 0 },    // غير مسوّاة
  ]), 110);
});

test('shared financial summary excludes rolled-back and pending sales', () => {
  const summary = summarizeCompletedSales([
    { status: 'COMPLETED', faceValue: 100, commissionRiyal: 10, paidRiyal: 4 },
    { status: 'COMPLETED', faceValue: 200, commissionRiyal: 20, paidRiyal: 0 },
    { status: 'ROLLED_BACK', faceValue: 900, commissionRiyal: 90, paidRiyal: 0 },
    { status: 'SMS_PENDING', faceValue: 700, commissionRiyal: 70, paidRiyal: 0 },
  ]);
  assert.deepEqual(summary, {
    reportedSalesValue: 300,
    reportedTransactions: 2,
    commissionDue: 30,
    outstandingCommission: 26,
    recordedPayments: 4,
  });
});

test('legacy sales totals include amount aliases and status-less records', () => {
  const summary = summarizeCompletedSales([
    { amount: 1500, commissionRiyal: 75 },
    { amountRiyal: 250, status: 'COMPLETED', commissionRiyal: 12 },
    { amountMinor: 12500, moneyPolicyVersion: 2, status: 'COMPLETED', commissionRiyal: 6 },
    { faceValue: 900, status: 'SMS_PENDING', commissionRiyal: 10 },
    { faceValue: 500, status: 'ROLLED_BACK', commissionRiyal: 5 },
  ]);
  assert.equal(summary.reportedSalesValue, 1875);
  assert.equal(summary.reportedTransactions, 3);
});

test('isServerVerifiedSale accurately distinguishes cryptographically verified Ingest sales from legacy client sales', () => {
  const verifiedSale = {
    source: 'admin_api',
    verified: true,
    payloadHash: 'a'.repeat(64),
    verificationReceipt: '1700000000000.abcdef1234567890',
    payloadPolicyVersion: 2,
    moneyPolicyVersion: 2,
    commissionRiyal: 50,
    faceValue: 1000,
  };

  assert.equal(isServerVerifiedSale(verifiedSale), true);

  // Client directly wrote to Firestore (legacy app)
  const legacySale1 = {
    source: 'krotak_app',
    status: 'COMPLETED',
    faceValue: 1000,
    commission: 0,
  };
  assert.equal(isServerVerifiedSale(legacySale1), false);

  // Forged verified: true without server receipt or hash
  const forgedSale = {
    verified: true,
    source: 'admin_api',
    faceValue: 1000,
    commissionRiyal: 50,
  };
  assert.equal(isServerVerifiedSale(forgedSale), false);

  // Wrong hash length or invalid receipt
  const badHashSale = {
    ...verifiedSale,
    payloadHash: 'short-hash',
  };
  assert.equal(isServerVerifiedSale(badHashSale), false);
});

test('summarizeSalesWithVerification provides separated metrics for verified and unverified legacy sales', () => {
  const verifiedSale = {
    status: 'COMPLETED',
    source: 'admin_api',
    verified: true,
    payloadHash: 'f'.repeat(64),
    verificationReceipt: '1700000000000.abcdef',
    payloadPolicyVersion: 2,
    moneyPolicyVersion: 2,
    commissionRiyal: 50,
    paidRiyal: 0,
    faceValue: 1000,
  };

  const legacySale = {
    status: 'COMPLETED',
    source: 'krotak_app',
    faceValue: 2000,
    commission: 0,
    paidRiyal: 0,
  };

  const summary = summarizeSalesWithVerification([verifiedSale, legacySale]);
  assert.equal(summary.reportedTransactions, 2);
  assert.equal(summary.verifiedTransactions, 1);
  assert.equal(summary.legacyTransactions, 1);
  assert.equal(summary.verifiedCommissionDue, 50);
  assert.equal(summary.verifiedOutstandingCommission, 50);
  assert.equal(summary.legacySalesValue, 2000);
  assert.equal(summary.verifiedSalesValue, 1000);
  assert.equal(summary.legacyEstimatedCommission, 0);
});
