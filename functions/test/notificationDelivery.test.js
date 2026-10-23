const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../index');

test('scheduled notification delivery records carry updatedAtMs for the admin sync', () => {
  const delivery = __test.buildDeliveryRecord({
    requestId: 'request-1',
    title: 'عنوان',
    body: 'نص الرسالة',
    target: 'user:uid-1',
    audienceType: 'user',
    targetUid: 'uid-1',
    sent: 1,
    failed: 0,
    now: 1_800_000_000_123,
  });

  assert.equal(delivery.updatedAtMs, 1_800_000_000_123);
  assert.equal(delivery.createdAtMs, 1_800_000_000_123);
  assert.equal(delivery.timestamp, 1_800_000_000_123);
  assert.equal(delivery.targetUid, 'uid-1');
  assert.equal(delivery.message, 'نص الرسالة');
  assert.equal(delivery.status, 'sent');
  assert.ok(delivery.createdAt);
});

test('global scheduled notifications omit targetUid and record failures explicitly', () => {
  const delivery = __test.buildDeliveryRecord({
    requestId: 'request-2',
    title: 'عنوان',
    body: 'نص',
    target: 'topic:krotak_all_users',
    audienceType: 'global',
    sent: 0,
    failed: 1,
    now: 1_800_000_000_456,
  });

  assert.equal(delivery.updatedAtMs, 1_800_000_000_456);
  assert.equal(delivery.targetUid, undefined);
  assert.equal(delivery.status, 'failed');
});
