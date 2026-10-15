import test from 'node:test';
import assert from 'node:assert/strict';
import { saleCommission, sumCommission, hasUnverifiedCommission, saleOutstanding, sumOutstanding } from '../src/lib/commission.js';

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
