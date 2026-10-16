import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_PREFS,
  getNotificationPreferences,
  saveNotificationPreferences,
  dispatchPhoneNotification,
} from '../src/lib/phoneNotifications.js';

test('phone notification preferences defaults are all enabled', () => {
  assert.equal(DEFAULT_NOTIFICATION_PREFS.enabled, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.salesAlerts, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.userAlerts, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.sound, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.vibrate, true);
});

test('save and read notification preferences with mock storage', () => {
  const store = {};
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  globalThis.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
  };

  const initial = getNotificationPreferences();
  assert.equal(initial.enabled, true);

  // Disable master
  saveNotificationPreferences({ enabled: false });
  assert.equal(getNotificationPreferences().enabled, false);
  assert.equal(getNotificationPreferences().salesAlerts, true); // remains true

  // Disable salesAlerts specifically
  saveNotificationPreferences({ enabled: true, salesAlerts: false });
  assert.equal(getNotificationPreferences().enabled, true);
  assert.equal(getNotificationPreferences().salesAlerts, false);
  assert.equal(getNotificationPreferences().userAlerts, true);

  // Clean up
  delete globalThis.window;
  delete globalThis.localStorage;
});

test('dispatchPhoneNotification respects enabled and category toggles', async () => {
  const store = {};
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  globalThis.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
  };

  // Disabled globally
  saveNotificationPreferences({ enabled: false });
  const resultDisabled = await dispatchPhoneNotification({
    title: 'بيع جديد',
    body: 'مبلغ 100 ر.ي',
    type: 'sale',
  });
  assert.equal(resultDisabled, false);

  // Enabled globally, but sales disabled
  saveNotificationPreferences({ enabled: true, salesAlerts: false, userAlerts: true });
  const resultSaleDisabled = await dispatchPhoneNotification({
    title: 'بيع جديد',
    body: 'مبلغ 100 ر.ي',
    type: 'sale',
  });
  assert.equal(resultSaleDisabled, false);

  // Enabled globally, but user alert disabled
  saveNotificationPreferences({ enabled: true, salesAlerts: true, userAlerts: false });
  const resultUserDisabled = await dispatchPhoneNotification({
    title: 'مستخدم جديد',
    body: 'انضمام شبكة',
    type: 'user',
  });
  assert.equal(resultUserDisabled, false);

  // Clean up
  delete globalThis.window;
  delete globalThis.localStorage;
});
