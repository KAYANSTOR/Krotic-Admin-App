import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIENCE,
  TABS,
  SEND_ERROR_MESSAGES,
} from '../src/lib/notifications/constants.js';
import {
  formatNotificationDate,
  notificationMillis,
  toLocalDateTimeInput,
  toNotificationMillis,
} from '../src/lib/notifications/timestamps.js';
import {
  isBuiltinTemplate,
  userOptionLabel,
} from '../src/lib/notifications/templates.js';

test('notification timestamps support numbers, Date, Firestore-like timestamps and strings', () => {
  const expected = Date.parse('2026-10-28T10:30:00.000Z');
  assert.equal(toNotificationMillis(expected), expected);
  assert.equal(toNotificationMillis(new Date(expected)), expected);
  assert.equal(toNotificationMillis({ toMillis: () => expected }), expected);
  assert.equal(toNotificationMillis({ toDate: () => new Date(expected) }), expected);
  assert.equal(toNotificationMillis('2026-10-28T10:30:00.000Z'), expected);
  assert.equal(toNotificationMillis({ toMillis: () => { throw new Error('bad timestamp'); } }), null);
  assert.equal(toNotificationMillis('bad date'), null);
});

test('notification timestamp selection prefers display timestamp and formats invalid data safely', () => {
  assert.equal(
    notificationMillis({
      displayTimestamp: 100,
      timestamp: 200,
      createdAt: 300,
    }),
    100,
  );
  assert.equal(notificationMillis({ timestamp: 200 }), 200);
  assert.equal(notificationMillis({}), null);
  assert.equal(formatNotificationDate(null), '—');
  assert.ok(toLocalDateTimeInput(Date.parse('2026-10-28T10:30:00.000Z')).endsWith('T13:30') || toLocalDateTimeInput(Date.parse('2026-10-28T10:30:00.000Z')).includes('T'));
});

test('notification audience, tabs and builtin-template helpers stay consistent', () => {
  assert.equal(AUDIENCE.GLOBAL, 'global');
  assert.equal(AUDIENCE.USER, 'user');
  assert.deepEqual(Object.values(TABS), ['compose', 'history', 'templates']);
  assert.ok(SEND_ERROR_MESSAGES.missing_token);
  assert.equal(isBuiltinTemplate({ id: 'builtin-reminder' }), true);
  assert.equal(isBuiltinTemplate({ id: '123' }), false);
  assert.equal(userOptionLabel({ name: 'شبكة', phone: '777' }), 'شبكة (777)');
  assert.equal(userOptionLabel({ network_name: 'شبكة قديمة', phoneNumber: '123' }), 'شبكة قديمة (123)');
});

test('notification page and send hook have stable guarded flows and do not mislabel ARIA tab widgets', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [page, hook, compose, api, scheduler] = await Promise.all([
    read('src/pages/NotificationsPage.jsx'),
    read('src/hooks/notifications/useNotifications.js'),
    read('src/components/notifications/ComposeTab.jsx'),
    read('src/lib/adminApi.js'),
    read('src/lib/notifications/scheduler.js'),
  ]);

  assert.ok(page.includes('dispatchRanRef.current'));
  assert.ok(page.includes('.catch((error) => console.warn'));
  assert.ok(page.includes('saveSavedTab(activeTab)'));
  assert.ok(page.includes("role=\"group\""));
  assert.ok(!page.includes('role="tablist"'));
  assert.ok(hook.includes('finally {'));
  assert.ok(hook.includes('sendingRef.current = false'));
  assert.ok(hook.includes('sendPushNotification'));
  assert.ok(hook.includes('scheduleNotificationRequest'));
  assert.ok(api.includes('export async function sendPushNotification'));
  assert.ok(api.includes('export async function deleteNotification'));
  assert.ok(scheduler.includes("collection(db, 'notification_requests')"));
  assert.ok(compose.includes('&& !sending'));
  assert.ok(compose.includes('min={scheduledMin}'));
  assert.ok(hook.includes('Date.now() + 5 * 60_000'));
  assert.ok(compose.includes('useDeferredValue'));
  assert.ok(compose.includes('isBuiltinTemplate'));
});
