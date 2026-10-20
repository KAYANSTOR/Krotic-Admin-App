import test from 'node:test';
import assert from 'node:assert/strict';
import { listGlobalNotifications, serializeGlobalNotification } from '../server/_lib/accountNotifications.js';

test('serializes an admin broadcast into the Android notification contract', () => {
  const notification = serializeGlobalNotification('delivery-1', {
    title: 'تحديث',
    body: 'نسخة جديدة متاحة',
    createdAt: { toMillis: () => 1_798_000_000_000 },
  });

  assert.deepEqual(notification, {
    id: 'delivery-1',
    title: 'تحديث',
    message: 'نسخة جديدة متاحة',
    timestamp: 1_798_000_000_000,
    is_read: false,
    is_global: true,
  });
});

test('supports legacy timestamp fields and skips empty delivery documents', () => {
  assert.equal(serializeGlobalNotification('empty', { timestamp: 10 }), null);
  assert.equal(serializeGlobalNotification('legacy', {
    message: 'رسالة قديمة',
    created_at: '2026-10-20T12:00:00.000Z',
  }).timestamp, Date.parse('2026-10-20T12:00:00.000Z'));
});

test('queries only global history, sorts newest-first, and bounds the returned list', async () => {
  const queryCalls = [];
  const documents = [
    { id: 'old', data: () => ({ title: 'قديم', timestamp: 10 }) },
    { id: 'global', data: () => ({ title: 'عام', timestamp: 50 }) },
    { id: 'new', data: () => ({ title: 'أحدث', timestamp: 70 }) },
    { id: 'invalid', data: () => ({ title: '', message: '' }) },
  ];
  const query = {
    where(field, operator, value) {
      queryCalls.push(['where', field, operator, value]);
      return this;
    },
    async get() { return { docs: documents }; },
  };
  const db = { collection(name) {
    assert.equal(name, 'notification_deliveries');
    return query;
  } };

  const notifications = await listGlobalNotifications(db, 2);

  assert.deepEqual(queryCalls, [
    ['where', 'audienceType', '==', 'global'],
  ]);
  assert.deepEqual(notifications.map((item) => item.id), ['new', 'global']);
});
