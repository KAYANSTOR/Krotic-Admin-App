import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_DEFAULT_INBOUND_TEMPLATES,
  ANDROID_DEFAULT_INBOUND_TEMPLATE_IDS,
  ANDROID_DEFAULT_OUTBOUND_KEYS,
  ANDROID_DEFAULT_OUTBOUND_TEMPLATES,
  ANDROID_DEFAULT_WALLET_IDS,
  ANDROID_DEFAULT_WALLETS,
  ANDROID_OUTBOUND_KEYS_REQUIRING_SERVER_REGISTRATION,
  WALLET_ID_CONTRACT,
  inboundTemplateId,
  walletIdFromKey,
} from '../src/lib/androidSeedCatalog.js';
import { BUNDLED_TEMPLATE_PACK, cloneBundledPack } from '../src/lib/bundledTemplatePack.js';
import { getTemplateCenterCatalog, validateTemplatePayload } from '../server/_lib/templateCenter.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

test('wallet ids use the Android stable wallet-default-* catalog identity', () => {
  for (const wallet of ANDROID_DEFAULT_WALLETS) {
    assert.equal(wallet.id, walletIdFromKey(wallet.key));
    assert.ok(SAFE_ID.test(wallet.id), `wallet id ${wallet.id} must be SAFE_ID-safe`);
    assert.ok(wallet.id.startsWith('wallet-default-'));
  }
  // 'ONE Cash' يحافظ على صيغة Android الثابتة مع تطبيع المسافة إلى شرطة.
  assert.equal(walletIdFromKey('ONE Cash'), 'wallet-default-one-cash');
});

test('wallet ids are unique and match the six approved Android wallets', () => {
  assert.equal(ANDROID_DEFAULT_WALLETS.length, 6);
  assert.equal(new Set(ANDROID_DEFAULT_WALLET_IDS).size, 6);
  assert.deepEqual([...ANDROID_DEFAULT_WALLET_IDS], [
    'wallet-default-jaib', 'wallet-default-jawali', 'wallet-default-mfloos',
    'wallet-default-floosak', 'wallet-default-kuraimilmb', 'wallet-default-one-cash',
  ]);
  // ترتيب وقيم Sender ID الرسمية كما يعرّفها Android.
  assert.deepEqual(ANDROID_DEFAULT_WALLETS.map((wallet) => wallet.senderId), [
    'Jaib', 'Jawali', 'MFloos', 'Floosak', 'KuraimiLMB', 'ONE Cash',
  ]);
});

test('the wallet id contract is resolved to the Android catalog identity', () => {
  assert.equal(WALLET_ID_CONTRACT.status, 'resolved');
  assert.match(WALLET_ID_CONTRACT.androidRowId, /wallet-default-/);
  assert.match(WALLET_ID_CONTRACT.adminId, /same WalletSpec\.catalogId/);
  // هوية الكتالوج محسومة، لكن ترحيل صفوف التثبيتات القديمة لا يُدّعى إنجازه من هنا.
  assert.equal(WALLET_ID_CONTRACT.legacyRowMigration, 'unverified_from_admin_repo');
});

test('inbound template ids use the exact Android formula and stay unique', () => {
  for (const template of ANDROID_DEFAULT_INBOUND_TEMPLATES) {
    assert.ok(SAFE_ID.test(template.id), `template id ${template.id} must be SAFE_ID-safe`);
    assert.ok(template.id.startsWith('tpl-default-'), 'inbound ids must be tpl-default-*');
  }
  assert.equal(new Set(ANDROID_DEFAULT_INBOUND_TEMPLATE_IDS).size, ANDROID_DEFAULT_INBOUND_TEMPLATE_IDS.length);
  assert.equal(inboundTemplateId('ONE Cash', 'ar-received'), 'tpl-default-one-cash-ar-received');
  // معرّفات حقيقية من Android يجب أن تظهر حرفيًا (لتفادي تكرار النسخ).
  for (const expected of ['tpl-default-jaib-ar-shared', 'tpl-default-jawali-ar-received', 'tpl-default-one-cash-ar-received', 'tpl-default-kuraimilmb-ar-deposit']) {
    assert.ok(ANDROID_DEFAULT_INBOUND_TEMPLATE_IDS.includes(expected), `missing ${expected}`);
  }
});

test('every inbound template links to one of the canonical wallet ids', () => {
  const walletIds = new Set(ANDROID_DEFAULT_WALLET_IDS);
  for (const template of ANDROID_DEFAULT_INBOUND_TEMPLATES) {
    assert.ok(walletIds.has(template.walletId), `${template.id} must link a canonical wallet`);
    assert.ok(template.senderCode.trim().length > 0);
  }
});

test('outbound keys are unique and the Android-only keys exist in the server catalog', () => {
  assert.equal(new Set(ANDROID_DEFAULT_OUTBOUND_KEYS).size, ANDROID_DEFAULT_OUTBOUND_KEYS.length);
  const catalogKeys = new Set(getTemplateCenterCatalog().outboundTemplates.map((item) => item.key));
  for (const key of ANDROID_DEFAULT_OUTBOUND_KEYS) {
    assert.ok(catalogKeys.has(key), `outbound key ${key} must exist in the server catalog`);
  }
  for (const key of ANDROID_OUTBOUND_KEYS_REQUIRING_SERVER_REGISTRATION) {
    assert.ok(catalogKeys.has(key), `Android-seeded key ${key} must stay registered on the server`);
  }
});

test('the canonical Android catalog is publishable (not only a draft)', () => {
  const result = validateTemplatePayload(cloneBundledPack(), { allowDrafts: false });
  assert.equal(result.ok, true, `canonical pack must pass publish validation: ${(result.errors || []).join(', ')}`);
});

test('repeating the same variable name is allowed but mixing synonyms is rejected', () => {
  // Android's real bodies repeat {CURRENCY} — must be accepted.
  const repeated = validateTemplatePayload({
    outboundTemplates: [{ key: 'customer_debt_payment_template', body: '{amount} {CURRENCY} {paid} {surplus} {balance} {CURRENCY}' }],
  }, { allowDrafts: false });
  assert.equal(repeated.ok, true, `repeated name should pass: ${(repeated.errors || []).join(', ')}`);

  // Two different names for the same canonical key is a collision.
  const collision = validateTemplatePayload({
    outboundTemplates: [{ key: 'voucher_delivery_sms_template', body: '{secret} و{code}' }],
  }, { allowDrafts: false });
  assert.equal(collision.ok, false);
  assert.ok(collision.errors.includes('outboundTemplates[0]_variable_duplicate'));
});

test('bundled pack mirrors the canonical catalog and carries no financial fields', () => {
  assert.deepEqual(BUNDLED_TEMPLATE_PACK.wallets.map((wallet) => wallet.id), [...ANDROID_DEFAULT_WALLET_IDS]);
  assert.deepEqual(BUNDLED_TEMPLATE_PACK.transferTemplates.map((template) => template.id), [...ANDROID_DEFAULT_INBOUND_TEMPLATE_IDS]);
  for (const wallet of BUNDLED_TEMPLATE_PACK.wallets) {
    for (const forbidden of ['balance', 'amount', 'amountMinor', 'credit', 'debt']) {
      assert.equal(forbidden in wallet, false, `wallet ${wallet.id} must not have ${forbidden}`);
    }
  }
});

test('cloning the pack yields a mutable copy with fresh wallet timestamps', () => {
  const clone = cloneBundledPack('2026-10-21T00:00:00.000Z');
  clone.wallets[0].name = 'معدّل';
  assert.notEqual(clone.wallets[0].name, BUNDLED_TEMPLATE_PACK.wallets[0].name);
  assert.equal(clone.wallets[0].createdAt, '2026-10-21T00:00:00.000Z');
  assert.equal('createdAt' in BUNDLED_TEMPLATE_PACK.wallets[0], false);
});
