import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAppVersions, getAppUpdateStatus } from '../src/lib/appVersion.js';

test('compares numeric segments rather than lexicographic strings', () => {
  assert.equal(compareAppVersions('1.0.9', '1.0.15'), -1);
  assert.equal(compareAppVersions('1.0.15+15', '1.0.15'), 0);
  assert.equal(compareAppVersions('1.2', '1.2.0'), 0);
});

test('uses versionCode when both sides report it and preserves unknown state', () => {
  assert.equal(getAppUpdateStatus({ app_version: '1.0.15', app_version_code: 14 }, {
    app_latest_version: '1.0.14', app_latest_version_code: 15,
  }), 'outdated');
  assert.equal(getAppUpdateStatus({}, { app_latest_version: '1.0.15' }), 'unknown');
  assert.equal(getAppUpdateStatus({ app_version: '1.0.15' }, { app_latest_version: '1.0.15' }), 'current');
});
