import test from 'node:test';
import assert from 'node:assert/strict';

test('admin catalog includes the five Krotak Pro keys and keeps admin extras', async () => {
  const {
    ACCOUNT_FEATURE_CATALOG,
    KROTAK_PRO_REQUIRED_FEATURE_KEYS,
  } = await import('../server/_lib/accountFeatures.js');
  const keys = ACCOUNT_FEATURE_CATALOG.map((feature) => feature.key).sort();
  assert.deepEqual(keys, [
    'advanced_analytics',
    'hotspot_phone_recharge',
    'hotspot_template_editor',
    'mikrotik_card_generator',
    'smart_delivery_routing',
    'sms_auto_parser',
    'whatsapp_card_delivery',
  ]);
  for (const key of KROTAK_PRO_REQUIRED_FEATURE_KEYS) {
    assert.ok(keys.includes(key), `missing ${key}`);
  }
  assert.equal(KROTAK_PRO_REQUIRED_FEATURE_KEYS.length, 5);
  assert.ok(ACCOUNT_FEATURE_CATALOG.every((feature) => feature.default === false));
});
