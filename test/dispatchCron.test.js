import test from 'node:test';
import assert from 'node:assert/strict';
import { isCronSecret } from '../api/dispatch-notifications.js';

test('Cron authorization requires an exact configured secret', () => {
  assert.equal(isCronSecret('cron-secret-1', 'cron-secret-1'), true);
  assert.equal(isCronSecret('cron-secret-2', 'cron-secret-1'), false);
  assert.equal(isCronSecret('', 'cron-secret-1'), false);
  assert.equal(isCronSecret('cron-secret-1', ''), false);
});
