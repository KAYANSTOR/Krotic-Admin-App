import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORK_ID_START,
  formatNetworkId,
  parseNetworkId,
  isNetworkId,
  nextNetworkSequence,
} from '../server/_lib/networkId.js';

test('network ids are sequential and readable from NET-10001', () => {
  assert.equal(NETWORK_ID_START, 10001);
  assert.equal(formatNetworkId(10001), 'NET-10001');
  assert.equal(formatNetworkId(12345), 'NET-12345');
  assert.throws(() => formatNetworkId(10000), /network_sequence_invalid/);
  assert.throws(() => formatNetworkId('10001'), /network_sequence_invalid/);
});

test('parsing round-trips and rejects malformed ids', () => {
  assert.deepEqual(parseNetworkId('NET-10001'), { networkId: 'NET-10001', sequence: 10001 });
  assert.equal(parseNetworkId('NET-10000'), null);
  assert.equal(parseNetworkId('net-10001'), null);
  assert.equal(parseNetworkId('10001'), null);
  assert.equal(parseNetworkId(''), null);
  assert.equal(isNetworkId('NET-10001'), true);
  assert.equal(isNetworkId('user-uid'), false);
});

test('the next sequence starts at 10001 and increments from the last id', () => {
  assert.equal(nextNetworkSequence(null), 10001);
  assert.equal(nextNetworkSequence('NET-10001'), 10002);
  assert.equal(nextNetworkSequence('NET-10099'), 10100);
});
