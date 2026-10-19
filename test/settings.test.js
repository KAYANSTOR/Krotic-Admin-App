import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettingsInput, SETTINGS_BOUNDS } from '../api/settings.js';

test('settings accept valid bounded fields', () => {
  const result = validateSettingsInput({
    default_trial_days: 30,
    default_commission_rate: 5,
    warning_days_before_expiry: 3,
    is_app_active: true,
    maintenance_message: 'صيانة',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    default_trial_days: 30,
    default_commission_rate: 5,
    warning_days_before_expiry: 3,
    is_app_active: true,
    maintenance_message: 'صيانة',
  });
});

test('settings enforce the owner bounds (0-30 trial, 0-20 commission, 1-7 warning)', () => {
  assert.equal(SETTINGS_BOUNDS.default_trial_days.max, 30);
  assert.equal(SETTINGS_BOUNDS.default_commission_rate.max, 20);
  assert.equal(SETTINGS_BOUNDS.warning_days_before_expiry.min, 1);

  assert.equal(validateSettingsInput({ default_trial_days: 31 }).error, 'default_trial_days_out_of_range');
  assert.equal(validateSettingsInput({ default_trial_days: 2.5 }).error, 'default_trial_days_invalid');
  assert.equal(validateSettingsInput({ default_commission_rate: 21 }).error, 'default_commission_rate_out_of_range');
  assert.equal(validateSettingsInput({ warning_days_before_expiry: 0 }).error, 'warning_days_before_expiry_out_of_range');
  assert.equal(validateSettingsInput({ warning_days_before_expiry: 8 }).error, 'warning_days_before_expiry_out_of_range');
});

test('settings reject unknown fields, wrong types, empty and oversized payloads', () => {
  assert.equal(validateSettingsInput({}).error, 'no_fields');
  assert.equal(validateSettingsInput({ is_active: true }).error, 'unknown_field:is_active');
  assert.equal(validateSettingsInput({ is_app_active: 'yes' }).error, 'is_app_active_invalid');
  assert.equal(validateSettingsInput({ maintenance_message: 'x'.repeat(501) }).error, 'maintenance_message_too_long');
  assert.equal(validateSettingsInput({ maintenance_message: 5 }).error, 'maintenance_message_invalid');
});

test('published app version fields are bounded and validated', () => {
  assert.deepEqual(validateSettingsInput({
    app_latest_version: '1.0.16',
    app_latest_version_code: 16,
  }), { ok: true, value: { app_latest_version: '1.0.16', app_latest_version_code: 16 } });
  assert.equal(validateSettingsInput({ app_latest_version: 'latest' }).error, 'app_latest_version_invalid');
  assert.equal(validateSettingsInput({ app_latest_version_code: 1.5 }).error, 'app_latest_version_code_invalid');
});
