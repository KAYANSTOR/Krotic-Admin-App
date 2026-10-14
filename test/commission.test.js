import test from 'node:test';
import assert from 'node:assert/strict';
import { saleCommission, sumCommission, hasUnverifiedCommission } from '../src/lib/commission.js';

test('panel commission is read from server fields only', () => {
  assert.equal(saleCommission({ commissionMinor: 50 }), 50);
  assert.equal(saleCommission({ commissionAmount: 30 }), 30);
  assert.equal(saleCommission({ commission: 20 }), 20);
  assert.equal(saleCommission({ commissionMinor: 0 }), 0);
  assert.equal(saleCommission({ faceValue: 1000 }), null);
  assert.equal(saleCommission({ commissionMinor: null }), null);
  assert.equal(saleCommission({ commissionMinor: 'x' }), null);
});

test('summing and unverified detection never invent a local commission', () => {
  assert.equal(sumCommission([{ commissionMinor: 50 }, { commission: 30 }]), 80);
  assert.equal(sumCommission([{ faceValue: 100 }]), 0);
  assert.equal(hasUnverifiedCommission([{ commissionMinor: 1 }, { faceValue: 2 }]), true);
  assert.equal(hasUnverifiedCommission([{ commissionMinor: 1 }]), false);
  assert.equal(hasUnverifiedCommission([]), false);
});
