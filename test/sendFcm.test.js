import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTokensInBatches } from '../api/send-fcm.js';

function successfulResult(tokens) {
  return {
    successCount: tokens.length,
    failureCount: 0,
    responses: tokens.map(() => ({ success: true })),
  };
}

test('sends all device tokens in FCM-safe batches of at most 500', async () => {
  const tokens = Array.from({ length: 1001 }, (_, index) => `token-${index}`);
  const batchSizes = [];
  const result = await sendTokensInBatches({
    tokens,
    tokenDocIds: new Map(),
    message: { notification: { title: 'title', body: 'body' } },
    sendEachForMulticast: async ({ tokens: batch }) => {
      batchSizes.push(batch.length);
      return successfulResult(batch);
    },
    sleep: async () => {},
  });

  assert.deepEqual(batchSizes, [500, 500, 1]);
  assert.deepEqual(result, { sent: 1001, failed: 0, invalidDeviceDocIds: [] });
});

test('retries only transiently failed tokens, not recipients already accepted by FCM', async () => {
  const calls = [];
  const result = await sendTokensInBatches({
    tokens: ['accepted', 'temporary'],
    tokenDocIds: new Map(),
    message: {},
    sleep: async () => {},
    sendEachForMulticast: async ({ tokens }) => {
      calls.push([...tokens]);
      if (calls.length === 1) {
        return {
          successCount: 1,
          failureCount: 1,
          responses: [
            { success: true },
            { success: false, error: { code: 'messaging/server-unavailable' } },
          ],
        };
      }
      return successfulResult(tokens);
    },
  });

  assert.deepEqual(calls, [['accepted', 'temporary'], ['temporary']]);
  assert.deepEqual(result, { sent: 2, failed: 0, invalidDeviceDocIds: [] });
});

test('returns actual device document IDs for permanently invalid tokens', async () => {
  const result = await sendTokensInBatches({
    tokens: ['expired'],
    tokenDocIds: new Map([['expired', ['device-doc-real-id']]]),
    message: {},
    sendEachForMulticast: async () => ({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }],
    }),
  });

  assert.deepEqual(result, { sent: 0, failed: 1, invalidDeviceDocIds: ['device-doc-real-id'] });
});

test('rejects incomplete multicast results as an unresolved delivery', async () => {
  await assert.rejects(
    sendTokensInBatches({
      tokens: ['token'],
      tokenDocIds: new Map(),
      message: {},
      sendEachForMulticast: async () => ({ successCount: 1, failureCount: 0 }),
    }),
    /fcm_malformed_multicast_response/,
  );
});

test('rejects malformed per-token results and inconsistent aggregate counts', async () => {
  for (const malformedResult of [
    { successCount: 0, failureCount: 1, responses: [{}] },
    { successCount: 1, failureCount: 0, responses: [{ success: false, error: { code: 'messaging/internal-error' } }] },
  ]) {
    await assert.rejects(
      sendTokensInBatches({
        tokens: ['token'],
        tokenDocIds: new Map(),
        message: {},
        sendEachForMulticast: async () => malformedResult,
      }),
      /fcm_malformed_multicast_response/,
    );
  }
});
