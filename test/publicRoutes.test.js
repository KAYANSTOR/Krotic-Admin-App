import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dispatchPublicRoute } from '../server/apiHandlers/manage-user-auth.js';

const vercelConfig = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('account notifications is the only public route served before admin auth', async () => {
  assert.deepEqual(
    vercelConfig.rewrites.find((entry) => entry.source === '/api/account-notifications'),
    {
      source: '/api/account-notifications',
      destination: '/api/router?__router=manage-user-auth&__apiRoute=account-notifications',
    },
  );
  let called = 0;
  const handled = await dispatchPublicRoute({ query: { __apiRoute: 'account-notifications' } }, {}, {
    accountNotifications: async () => { called += 1; },
  });
  assert.equal(handled, true);
  assert.equal(called, 1);
});

test('removed OTP routes are gone and fall through to the admin handler', async () => {
  for (const source of ['/api/request-otp', '/api/verify-otp']) {
    assert.equal(vercelConfig.rewrites.some((entry) => entry.source === source), false, source);
  }
  for (const route of ['request-otp', 'verify-otp', 'other']) {
    const handled = await dispatchPublicRoute({ query: { __apiRoute: route } }, {}, {
      accountNotifications: async () => assert.fail('unexpected'),
    });
    assert.equal(handled, false, route);
  }
});

test('every commit on main deploys; there is no skip-deploy marker', () => {
  assert.equal(Object.hasOwn(vercelConfig, 'ignoreCommand'), false);
});
