import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMonthlyBreakdown,
  createEmptyMonthBucket,
  paymentMonthKey,
} from '../src/lib/users/monthlyBreakdown.js';
import {
  formatAppVersion,
  formatMonthArabic,
  hasCustomCommission,
} from '../src/lib/users/profileHelpers.js';

const verifiedSale = (overrides = {}) => ({
  id: 'verified-sale',
  status: 'COMPLETED',
  createdAt: new Date('2026-10-12T12:00:00.000Z'),
  faceValue: 100,
  commissionRiyal: 10,
  paidRiyal: 3,
  source: 'admin_api',
  verified: true,
  payloadHash: 'a'.repeat(64),
  verificationReceipt: '1720000000000.abcdef12',
  payloadPolicyVersion: 2,
  ...overrides,
});

test('profile helpers format month labels and preserve zero values', () => {
  assert.equal(formatMonthArabic('2026-10'), 'أكتوبر 2026');
  assert.equal(formatMonthArabic('invalid'), 'invalid');
  assert.equal(formatAppVersion(0), '0');
  assert.equal(formatAppVersion(null), 'غير مُبلّغ');
  assert.equal(hasCustomCommission({ commission_rate: 0 }), true);
  assert.equal(hasCustomCommission({ commission_rate: '' }), false);
});

test('paymentMonthKey prefers a valid explicit month and safely falls back to its date', () => {
  assert.equal(
    paymentMonthKey({ month: '2026-10', timestamp: new Date('2026-09-03T00:00:00Z') }),
    '2026-10',
  );
  assert.equal(paymentMonthKey({ timestamp: new Date('2026-09-03T00:00:00Z') }), '2026-09');
  assert.equal(paymentMonthKey({ timestamp: 'not-a-date' }), null);
});

test('monthly breakdown keeps verified outstanding separate from the total payment ledger', () => {
  const sales = [
    verifiedSale(),
    {
      id: 'legacy-sale',
      status: 'COMPLETED',
      createdAt: new Date('2026-10-13T12:00:00.000Z'),
      faceValue: 50,
      commissionRiyal: 5,
    },
    verifiedSale({
      id: 'settled-sale',
      createdAt: new Date('2026-09-12T12:00:00.000Z'),
      faceValue: 20,
      commissionRiyal: 2,
      paidRiyal: 2,
    }),
  ];
  const payments = [
    { id: 'payment-1', month: '2026-10', amount: 50, timestamp: new Date('2026-10-18T00:00:00Z') },
  ];

  const months = buildMonthlyBreakdown(sales, payments, ['all', '2026-10', '2026-09']);
  const october = months.find((month) => month.month === '2026-10');
  const september = months.find((month) => month.month === '2026-09');

  assert.ok(october);
  assert.equal(october.sales.length, 2);
  assert.equal(october.totalSales, 150);
  assert.equal(october.verifiedCount, 1);
  assert.equal(october.legacyCount, 1);
  assert.equal(october.commissionDue, 10);
  assert.equal(october.legacyEstimatedCommission, 5);
  assert.equal(october.totalPaid, 50);
  assert.equal(october.verifiedOutstanding, 7);
  assert.equal(october.outstanding, 7);
  assert.equal(september.verifiedOutstanding, 0);
  assert.equal(months.some((month) => month.month === 'all'), false);
});

test('empty monthly bucket initializes all financial fields to zero', () => {
  const bucket = createEmptyMonthBucket('2026-10');
  assert.equal(bucket.month, '2026-10');
  assert.deepEqual(bucket.sales, []);
  assert.deepEqual(bucket.payments, []);
  assert.equal(bucket.commissionDue, 0);
  assert.equal(bucket.totalPaid, 0);
  assert.equal(bucket.outstanding, 0);
});
