import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saleOutstanding,
  outstandingBalance,
  allocateFifo,
} from '../api/_lib/settlementLedger.js';

const sale = (id, commissionMinor, paidMinor = 0) => ({ id, commissionMinor, paidMinor });

test('outstanding balance accounts for partial payments', () => {
  assert.equal(saleOutstanding(sale('a', 100, 40)), 60);
  assert.equal(saleOutstanding(sale('a', 100, 100)), 0);
  assert.equal(saleOutstanding(sale('a', 100, 150)), 0);
  assert.equal(outstandingBalance([sale('a', 100, 40), sale('b', 50)]), 110);
});

test('V2 settlement reads whole-Riyal balance and preserves minor-unit paid value', () => {
  const currentSale = {
    id: 'v2', moneyPolicyVersion: 2, commissionMinor: 25, commissionRiyal: 25,
    paidMinor: 10, paidRiyal: 10,
  };
  assert.equal(saleOutstanding(currentSale), 15);
  const allocation = allocateFifo([{
    id: 'v2', moneyPolicyVersion: 2, commissionMinor: 25, commissionRiyal: 25,
    paidMinor: 0, paidRiyal: 0,
  }], 10);
  assert.equal(allocation.allocations[0].paidAfterRiyal, 10);
  assert.equal(allocation.allocations[0].paidAfterMinor, 10);
});

test('FIFO settles the oldest sales first', () => {
  const sales = [sale('old', 50), sale('mid', 50), sale('new', 50)];
  const result = allocateFifo(sales, 120);
  assert.deepEqual(result.allocations.map((a) => [a.id, a.appliedMinor, a.fullySettled]), [
    ['old', 50, true],
    ['mid', 50, true],
    ['new', 20, false],
  ]);
  assert.equal(result.remainingMinor, 0);
});

test('FIFO carries partial settlement and reports unallocated remainder', () => {
  const sales = [sale('old', 30, 10), sale('mid', 30)];
  const result = allocateFifo(sales, 100);
  assert.deepEqual(result.allocations.map((a) => [a.id, a.appliedMinor, a.paidAfterMinor]), [
    ['old', 20, 30],
    ['mid', 30, 30],
  ]);
  assert.equal(result.remainingMinor, 50);
});

test('FIFO ignores zero-outstanding sales and empty input', () => {
  assert.deepEqual(allocateFifo([], 100), { allocations: [], remainingMinor: 100 });
  const result = allocateFifo([sale('settled', 40, 40), sale('due', 40)], 40);
  assert.deepEqual(result.allocations.map((a) => a.id), ['due']);
});
