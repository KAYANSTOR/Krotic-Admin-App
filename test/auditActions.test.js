import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AUDIT_ACTIONS, AUDIT_ACTION_META, auditActionLabel, auditActionTone, normalizeAuditAction,
} from '../src/lib/auditActions.js';

test('every audit action constant is its own string key', () => {
  for (const [key, value] of Object.entries(AUDIT_ACTIONS)) assert.equal(value, key);
  assert.deepEqual(Object.keys(AUDIT_ACTIONS), Object.keys(AUDIT_ACTION_META));
});

test('legacy records stored as {label, tone} objects render as text, never as an object', () => {
  const legacy = { label: AUDIT_ACTION_META.USER_RENEW.label, tone: 'brand' };
  assert.equal(normalizeAuditAction(legacy), 'USER_RENEW');
  assert.equal(auditActionLabel(legacy), AUDIT_ACTION_META.USER_RENEW.label);
  assert.equal(auditActionTone(legacy), 'brand');
  assert.equal(typeof auditActionLabel({ label: 'إجراء محذوف', tone: 'x' }), 'string');
  assert.equal(auditActionLabel(null), 'إجراء غير معروف');
  assert.equal(auditActionLabel('NETWORK_ACCESS_UPDATE'), AUDIT_ACTION_META.NETWORK_ACCESS_UPDATE.label);
});

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('dashboard code references only defined audit actions, and every server audit key has a label', async () => {
  const used = new Set();
  for (const file of await walk('src')) {
    for (const m of (await readFile(file, 'utf8')).matchAll(/AUDIT_ACTIONS\.([A-Z_]+)/g)) used.add(m[1]);
  }
  for (const key of used) assert.ok(Object.hasOwn(AUDIT_ACTION_META, key), `undefined audit action ${key}`);
  const serverKeys = new Set();
  for (const file of await walk('server')) {
    const src = await readFile(file, 'utf8');
    if (!/audit/i.test(src)) continue;
    for (const m of src.matchAll(/action:\s*'([A-Z_]+)'/g)) serverKeys.add(m[1]);
  }
  serverKeys.delete('FLUTTER_NOTIFICATION_CLICK');
  for (const key of serverKeys) assert.ok(Object.hasOwn(AUDIT_ACTION_META, key), `server audit action without label ${key}`);
});
