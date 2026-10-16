import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchPublicOtpRoute } from '../api/manage-user-auth.js';

const vercelConfig = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);

test('Vercel rewrites both OTP URLs to the existing auth function', () => {
  assert.deepEqual(
    vercelConfig.rewrites.find((entry) => entry.source === '/api/request-otp'),
    {
      source: '/api/request-otp',
      destination: '/api/manage-user-auth?__apiRoute=request-otp',
    },
  );
  assert.deepEqual(
    vercelConfig.rewrites.find((entry) => entry.source === '/api/verify-otp'),
    {
      source: '/api/verify-otp',
      destination: '/api/manage-user-auth?__apiRoute=verify-otp',
    },
  );
});

test('public OTP URLs dispatch before the admin auth handler', async () => {
  for (const [route, expected] of [
    ['request-otp', 'request'],
    ['verify-otp', 'verify'],
  ]) {
    const req = { query: { __apiRoute: route } };
    const res = { marker: true };
    let called = null;
    const handled = await dispatchPublicOtpRoute(req, res, {
      requestOtp: async (actualReq, actualRes) => {
        called = ['request', actualReq, actualRes];
      },
      verifyOtp: async (actualReq, actualRes) => {
        called = ['verify', actualReq, actualRes];
      },
    });
    assert.equal(handled, true);
    assert.equal(called[0], expected);
    assert.strictEqual(called[1], req);
    assert.strictEqual(called[2], res);
  }

  assert.equal(
    await dispatchPublicOtpRoute({ query: { __apiRoute: 'other' } }, {}, {
      requestOtp: async () => assert.fail('unexpected OTP request'),
      verifyOtp: async () => assert.fail('unexpected OTP verification'),
    }),
    false,
  );
});

test('Vercel skips only a commit explicitly marked no-deploy', () => {
  const { ignoreCommand } = vercelConfig;
  assert.equal(typeof ignoreCommand, 'string');
  const repository = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  const git = (args) => execFileSync('git', args, { cwd: repository, stdio: 'ignore' });
  const runIgnoreCommand = () => spawnSync('/bin/sh', ['-c', ignoreCommand], {
    cwd: repository,
    encoding: 'utf8',
  });

  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'OTP deployment test']);
    git(['config', 'user.email', 'otp-deploy-test@example.invalid']);
    writeFileSync(join(repository, 'marker.txt'), 'first');
    git(['add', 'marker.txt']);
    git(['commit', '-m', 'stage OTP [otp-no-deploy]']);
    assert.equal(runIgnoreCommand().status, 0);

    writeFileSync(join(repository, 'marker.txt'), 'second');
    git(['add', 'marker.txt']);
    git(['commit', '-m', 'ordinary follow-up']);
    assert.equal(runIgnoreCommand().status, 1);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
