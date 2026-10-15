import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchLegacyPaymentRoute } from '../api/settlement.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const apiRoot = join(projectRoot, 'api');

function listVercelFunctionFiles(directory = apiRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      // Vercel ignores underscore-prefixed directories used for shared modules.
      if (entry.name.startsWith('_')) return [];
      return listVercelFunctionFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.js')
      ? [relative(apiRoot, fullPath).replaceAll('\\', '/')]
      : [];
  });
}

test('Vercel API functions stay within Hobby limit and preserve record-payment URL', () => {
  const functions = listVercelFunctionFiles();
  assert.ok(functions.length <= 12, `Expected at most 12 Vercel functions, found ${functions.length}`);
  assert.ok(functions.includes('settlement.js'));
  assert.ok(!functions.includes('record-payment.js'));

  const config = JSON.parse(readFileSync(join(projectRoot, 'vercel.json'), 'utf8'));
  const rewrite = config.rewrites.find((entry) => entry.source === '/api/record-payment');
  assert.deepEqual(rewrite, {
    source: '/api/record-payment',
    destination: '/api/settlement?__apiRoute=record-payment',
  });
});

test('legacy payment route dispatches the unchanged request and response to its handler', async () => {
  const req = {
    method: 'POST',
    url: '/api/settlement?__apiRoute=record-payment',
    query: { __apiRoute: 'record-payment' },
    body: { uid: 'user-1', amount: 5000, month: '2026-10', idempotencyKey: 'key_abcdef12' },
  };
  const res = { marker: true };
  let callCount = 0;

  const handled = await dispatchLegacyPaymentRoute(req, res, async (actualReq, actualRes) => {
    callCount += 1;
    assert.strictEqual(actualReq, req);
    assert.strictEqual(actualRes, res);
  });

  assert.equal(handled, true);
  assert.equal(callCount, 1);
});

test('normal settlement request does not enter the legacy payment handler', async () => {
  const req = { method: 'POST', query: {} };
  let callCount = 0;

  const handled = await dispatchLegacyPaymentRoute(req, {}, async () => {
    callCount += 1;
  });

  assert.equal(handled, false);
  assert.equal(callCount, 0);
});
