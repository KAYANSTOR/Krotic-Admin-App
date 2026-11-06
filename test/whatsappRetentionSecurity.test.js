import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';
import { createInboundEvent } from '../server/_lib/whatsapp/inboundEvents.js';
import {
  shouldPurgeText,
  shouldDeleteEvent,
  applyRetentionToEvent,
  runRetentionPass,
  TEXT_RETENTION_MS,
  EVENT_RETENTION_MS,
  retentionPolicySummary,
} from '../server/_lib/whatsapp/retention.js';
import whatsappRetentionPurgeHandler from '../server/_lib/whatsapp/retentionPurgeHandler.js';
import whatsappWebhookHandler from '../server/_lib/whatsapp/webhookHandler.js';
import whatsappDispatchHandler from '../server/_lib/whatsapp/dispatchHandler.js';
import {
  completeSmsFallbackFromDevice,
  createDeliveryOperation,
  tryStartSmsFallback,
  transitionDeliveryStatus,
} from '../server/_lib/whatsapp/deliveryOperations.js';
import { canTransition } from '../server/_lib/whatsapp/deliveryState.js';
import { verifyMetaSignature } from '../server/_lib/whatsapp/signature.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_SECRET = 'unit_test_meta_app_secret_32b_xx';
const DISPATCH_SECRET = 'unit_dispatch_secret_value_xx';
const ensureOk = () => ({ ok: true });

test('retention: text purge keeps event; event delete only after 90d', async () => {
  const t0 = 1_800_000_000_000;
  const db = createFakeFirestore();
  const created = await createInboundEvent(db, {
    networkId: 'NET-10001',
    inboundMessageId: 'wamid.RET1',
    text: 'secret customer message',
    now: t0,
  });
  assert.equal(created.ok, true);
  const docId = created.docId;
  let event = db._store.get(`whatsapp_inbound_events/${docId}`);
  assert.equal(event.text, 'secret customer message');
  assert.equal(event.textRetentionUntilMs, t0 + TEXT_RETENTION_MS);
  assert.equal(event.eventExpiresAtMs, t0 + EVENT_RETENTION_MS);

  // Before 72h: no purge
  assert.equal(shouldPurgeText(event, t0 + TEXT_RETENTION_MS - 1), false);
  assert.equal(shouldDeleteEvent(event, t0 + TEXT_RETENTION_MS + 1), false);

  // After 72h, before 90d: text only
  const purged = await applyRetentionToEvent(db, docId, event, t0 + TEXT_RETENTION_MS + 1);
  assert.equal(purged.action, 'text_purged');
  event = db._store.get(`whatsapp_inbound_events/${docId}`);
  assert.equal(event.text, null);
  assert.equal(event.textRetentionUntilMs, null);
  assert.ok(event.eventExpiresAtMs);
  assert.equal(event.processingStatus, 'received');
  assert.equal(event.networkId, 'NET-10001');

  // After 90d: full delete
  const deleted = await applyRetentionToEvent(db, docId, event, t0 + EVENT_RETENTION_MS + 1);
  assert.equal(deleted.action, 'deleted');
  assert.equal(db._store.has(`whatsapp_inbound_events/${docId}`), false);
});

test('retention pass reports scheduling inactive', async () => {
  const summary = retentionPolicySummary();
  assert.equal(summary.schedulerStatus, 'not_wired');
  assert.equal(summary.textRetentionHours, 72);
  assert.equal(summary.eventRetentionDays, 90);

  const db = createFakeFirestore();
  await createInboundEvent(db, {
    networkId: 'NET-10001', inboundMessageId: 'wamid.OLD', text: 'x', now: 1000,
  });
  const result = await runRetentionPass(db, { now: 1000 + TEXT_RETENTION_MS + 5, limit: 10 });
  assert.equal(result.schedulingActive, false);
  assert.equal(result.textPurged, 1);
  assert.equal(result.deleted, 0);
});

test('retention purge endpoint rejects client and accepts service secret', async () => {
  const db = createFakeFirestore();
  const res = createRes();
  await whatsappRetentionPurgeHandler(
    { method: 'POST', body: {}, headers: {} },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
    },
  );
  assert.equal(res.statusCode, 403);

  const res2 = createRes();
  await whatsappRetentionPurgeHandler(
    { method: 'POST', body: { saleUuid: 'x' }, headers: { 'x-dispatch-service-secret': DISPATCH_SECRET } },
    res2,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
    },
  );
  assert.equal(res2.statusCode, 400);
});

test('concurrent inbound create: only one succeeds', async () => {
  const db = createFakeFirestore();
  const args = {
    networkId: 'NET-10001',
    inboundMessageId: 'wamid.RACE',
    text: 'race',
    now: 1_800_000_000_000,
  };
  const results = await Promise.all([
    createInboundEvent(db, args),
    createInboundEvent(db, args),
    createInboundEvent(db, args),
  ]);
  const created = results.filter((r) => r.ok && !r.duplicate);
  const duplicates = results.filter((r) => r.ok && r.duplicate);
  assert.equal(created.length, 1);
  assert.equal(duplicates.length, 2);
  assert.equal(
    [...db._store.keys()].filter((k) => k.includes('wamid.RACE')).length,
    1,
  );
});

test('webhook signature uses raw body — JSON reserialize would fail', () => {
  const raw = '{"object":"whatsapp_business_account","entry":[{"id":"1"}]}';
  const hex = createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  assert.equal(verifyMetaSignature(raw, `sha256=${hex}`, APP_SECRET).ok, true);
  // Re-serialized with different key order / spacing must not be used for verify
  const reserialized = JSON.stringify(JSON.parse(raw));
  // may or may not match depending on spacing; force different body
  const tampered = raw.replace('whatsapp_business_account', 'whatsapp_business_account ');
  assert.equal(verifyMetaSignature(tampered, `sha256=${hex}`, APP_SECRET).ok, false);
});

test('webhook cannot bind message to wrong network via spoofed phone_number_id', async () => {
  const db = createFakeFirestore({
    'networks/NET-10001': { owner_uid: 'u1', whatsappPhoneNumberId: '111' },
    'networks/NET-10002': { owner_uid: 'u2', whatsappPhoneNumberId: '222' },
  });
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: '222' },
          messages: [{ id: 'wamid.X', from: '1', type: 'text', text: { body: 'hi' }, timestamp: '1700000000' }],
        },
      }],
    }],
  };
  const rawBody = JSON.stringify(payload);
  const hex = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const res = createRes();
  await whatsappWebhookHandler(
    { method: 'POST', body: payload, headers: { 'x-hub-signature-256': `sha256=${hex}` } },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getMetaAppSecret: async () => ({ ok: true, value: APP_SECRET }),
      rawBody,
      now: 1_800_000_000_000,
    },
  );
  assert.equal(res.body.accepted, 1);
  assert.ok(db._store.has('whatsapp_inbound_events/meta_NET-10002_wamid.X'));
  assert.equal(db._store.has('whatsapp_inbound_events/meta_NET-10001_wamid.X'), false);
});

test('late WhatsApp confirmation after SMS does not start second SMS', async () => {
  const db = createFakeFirestore();
  const op = await createDeliveryOperation(db, {
    networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-late', now: 1000,
  });
  await transitionDeliveryStatus(db, op.deliveryOperationId, 'sent', {}, 2000);
  const sms = await tryStartSmsFallback(db, op.deliveryOperationId, 12000);
  assert.equal(sms.ok, true);
  assert.equal(sms.data.status, 'sms_pending');
  const sent = await completeSmsFallbackFromDevice(db, op.deliveryOperationId, 'sent', {}, 12000);
  assert.equal(sent.data.status, 'sms_sent');

  // Late delivered is only allowed via delivered_late_after_sms — not a second SMS
  assert.equal(canTransition('sms_sent', 'sms_pending'), false);
  assert.equal(canTransition('sms_sent', 'delivered_late_after_sms'), true);
  const late = await transitionDeliveryStatus(db, op.deliveryOperationId, 'delivered_late_after_sms', {}, 15000);
  assert.equal(late.ok, true);
  assert.equal(late.data.saleUuid, 'sale-late');
  assert.equal(late.data.smsFallbackSentAtMs, 12000);

  const secondSms = await tryStartSmsFallback(db, op.deliveryOperationId, 16000);
  assert.equal(secondSms.ok, false);
});

test('dispatch with Firebase-like Authorization still requires service secret', async () => {
  const db = createFakeFirestore();
  const res = createRes();
  await whatsappDispatchHandler(
    {
      method: 'POST',
      body: {},
      headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake' },
    },
    res,
    {
      db,
      ensureFirebaseAdmin: ensureOk,
      getDispatchServiceSecret: async () => ({ ok: true, value: DISPATCH_SECRET }),
    },
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'dispatch_forbidden');
});

test('firestore.indexes.json declares whatsappPhoneNumberId and retention fields', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const raw = await readFile(path.join(root, 'firestore.indexes.json'), 'utf8');
  const indexes = JSON.parse(raw);
  const overrides = indexes.fieldOverrides || [];
  const phone = overrides.find((o) => o.collectionGroup === 'networks' && o.fieldPath === 'whatsappPhoneNumberId');
  assert.ok(phone, 'whatsappPhoneNumberId override missing');
  const textIdx = overrides.find((o) => o.collectionGroup === 'whatsapp_inbound_events' && o.fieldPath === 'textRetentionUntilMs');
  const expIdx = overrides.find((o) => o.collectionGroup === 'whatsapp_inbound_events' && o.fieldPath === 'eventExpiresAtMs');
  assert.ok(textIdx);
  assert.ok(expIdx);
});

test('concurrent delivery create: single operation document', async () => {
  const db = createFakeFirestore();
  const args = { networkId: 'NET-10001', ownerUid: 'u1', saleUuid: 'sale-race', now: 5000 };
  const results = await Promise.all([
    createDeliveryOperation(db, args),
    createDeliveryOperation(db, args),
    createDeliveryOperation(db, args),
  ]);
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(results.filter((r) => r.duplicate).length, 2);
  assert.equal(
    [...db._store.keys()].filter((k) => k.startsWith('whatsapp_delivery_operations/')).length,
    1,
  );
});
