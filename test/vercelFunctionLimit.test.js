import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function countApiFunctions(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return countApiFunctions(fullPath);
    return /\.(js|mjs|cjs)$/.test(entry.name) ? 1 : 0;
  }));
  return nested.reduce((sum, count) => sum + count, 0);
}

test('Vercel Hobby deployment stays at or below 12 API functions', async () => {
  assert.ok((await countApiFunctions(path.join(root, 'api'))) <= 12);
});

test('device heartbeat endpoints reuse the existing networks API function', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/api/device-heartbeat'
    && rule.destination === '/api/networks?__apiRoute=device-heartbeat'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/api/device-heartbeats'
    && rule.destination === '/api/networks?__apiRoute=device-heartbeats'));
  assert.equal(await readFile(path.join(root, 'api', 'device-heartbeat.js')).then(() => true, () => false), false);
  assert.equal(await readFile(path.join(root, 'api', 'device-heartbeats.js')).then(() => true, () => false), false);
});

test('template-center keeps its public API URL through the shared settings function', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/api/template-center'
    && rule.destination === '/api/settings?__apiRoute=template-center'));
  assert.equal(await readFile(path.join(root, 'api', 'template-center.js')).then(() => true, () => false), false);
});

test('account-features reuses the shared settings function without a new API file', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/api/admin/account-features'
    && rule.destination === '/api/settings?__apiRoute=account-features'));
  assert.equal(await readFile(path.join(root, 'api', 'admin', 'account-features.js')).then(() => true, () => false), false);
});
