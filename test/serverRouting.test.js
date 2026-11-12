import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildApiRewriteMap } from '../server/apiRewriteMap.js';
import { API_ROUTE_HANDLERS } from '../api/router.js';

const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const routeMap = buildApiRewriteMap(vercelConfig);

test('every Vercel API router rewrite has an Express route and a real handler', () => {
  const expected = (vercelConfig.rewrites || []).filter((rewrite) => (
    rewrite.source?.startsWith('/api/')
    && rewrite.destination?.startsWith('/api/router?')
  ));

  assert.ok(expected.length > 0, 'Vercel API router rewrites should exist');
  assert.equal(routeMap.size, expected.length);

  for (const rewrite of expected) {
    const route = routeMap.get(rewrite.source);
    assert.ok(route, `missing Express route for ${rewrite.source}`);
    assert.ok(
      Object.hasOwn(API_ROUTE_HANDLERS, route.router),
      `missing API_ROUTE_HANDLERS entry "${route.router}" for ${rewrite.source}`,
    );
  }
});

test('Vercel route selectors survive the Express adapter mapping', () => {
  assert.deepEqual(routeMap.get('/api/whatsapp/inbox/claim'), {
    router: 'whatsapp-gateway',
    apiRoute: 'inbox-claim',
  });
  assert.deepEqual(routeMap.get('/api/whatsapp/inbound'), {
    router: 'whatsapp-inbound',
    apiRoute: null,
  });
  assert.deepEqual(routeMap.get('/api/entitlements/activate'), {
    router: 'settings',
    apiRoute: 'entitlement-activate',
  });
  assert.deepEqual(routeMap.get('/api/record-payment'), {
    router: 'settlement',
    apiRoute: 'record-payment',
  });
});

test('non-router rewrites and unknown API paths are not delegated', () => {
  assert.equal(routeMap.has('/((?!api/).*)'), false);
  assert.equal(routeMap.has('/api/not-a-real-route'), false);
});
