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

test('template-center keeps its public API URL through the shared settings function', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/api/template-center'
    && rule.destination === '/api/settings?__apiRoute=template-center'));
  assert.equal(await readFile(path.join(root, 'api', 'template-center.js')).then(() => true, () => false), false);
});

test('paid-features reuses the shared settings function without a new API file', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.rewrites.some((rule) => rule.source === '/api/paid-features'
    && rule.destination === '/api/settings?__apiRoute=paid-features'));
  assert.equal(await readFile(path.join(root, 'api', 'paid-features.js')).then(() => true, () => false), false);
});
