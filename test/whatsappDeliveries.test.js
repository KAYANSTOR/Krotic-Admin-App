// Acceptance tests for the server side of phase 3 (contract contracts/whatsapp-delivery-v1.md) and the
// plan §12 delivery rows:
//   - two delivery ticks within 10 s       => WhatsApp delivered, no SMS
//   - one tick then the deadline           => SMS with the same card
//   - receipt during the fallback          => atomic, no double outcome (late delivery)
//   - SMS failure                          => reported, recoverable (pending-fallback), retried with the same card
// The Railway gateway is replaced by a model with the same view/seq semantics (RailwayModel below).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import whatsappGatewayHandler from '../server/apiHandlers/whatsapp-gateway.js';
import deliveryEventsRouter from '../server/apiHandlers/whatsapp-delivery-events.js';
import { applyViewTx, reconcile } from '../server/_lib/whatsappDeliveryApi.js';
import {
  QUEUED_STALE_MS, SILENT_GRACE_MS, STATE,
  applyRailwayView, applySmsResult, finalOutcomeOf, parseSendBody, parseSmsResult, resolveSilent,
} from '../server/_lib/whatsappDeliveries.js';
import { createFakeFirestore, createRes } from './helpers/fakeFirestore.js';

const NET = 'NET-10016';
const T0 = 1_800_000_000_000;
const SECRET = 'whatsapp-inbound-test-secret-0123456789-abcdef';
const DOC = (id) => `networks/${NET}/wa_deliveries/${id}`;

/** Minimal model of the Railway DeliveryEngine output (RailwayDeliveryView + seq). */
class RailwayModel {
  constructor() { this.ops = new Map(); this.calls = []; this.mode = 'ok'; }
  view(id) { return structuredClone(this.ops.get(id)); }
  bump(id, patch) { const v = this.ops.get(id); Object.assign(v, patch, { seq: v.seq + 1 }); return this.view(id); }
  async call(opts) {
    this.calls.push(structuredClone(opts));
    if (this.mode === 'down') return { ok: false, status: 502, error: 'whatsapp_gateway_unreachable' };
    if (opts.path === '/messages/send') {
      const b = opts.body;
      const id = b.deliveryOperationId || b.operationId;
      if (this.ops.has(id)) return { ok: true, status: 200, payload: { messageId: this.ops.get(id).messageId, duplicate: true, delivery: this.view(id) } };
      const at = this.clock();
      this.ops.set(id, {
        deliveryOperationId: id, networkId: b.networkId, messageId: null, state: 'queued', whatsappStatus: 'pending',
        smsFallback: b.smsFallback === true, receiptTimeoutMs: b.receiptTimeoutMs ?? 10_000, createdAt: at, acceptedAt: null,
        receiptDeadlineAt: null, serverAckAt: null, deliveredAt: null, readAt: null, resolvedAt: null, fallbackReason: null,
        lateDelivery: null, lastError: null, seq: 1, refs: b.refs || {}, to: b.to.replace(/\D/g, ''), attempts: 0, legacy: !b.deliveryOperationId,
      });
      if (this.mode === 'not_connected') {
        const v = this.bump(id, {
          state: b.smsFallback ? 'sms_fallback_requested' : 'failed', resolvedAt: at, whatsappStatus: 'error',
          fallbackReason: b.smsFallback ? 'whatsapp_send_failed:not_connected' : null, lastError: 'whatsapp_send_failed:not_connected',
        });
        return { ok: false, status: 409, error: 'not_connected', payload: { error: 'not_connected', delivery: v } };
      }
      const v = this.bump(id, {
        messageId: `3EB0${id.length}${this.ops.size}`, attempts: 1, state: 'waiting_whatsapp_receipt', whatsappStatus: 'sent',
        acceptedAt: at, receiptDeadlineAt: at + 10_000,
      });
      return { ok: true, status: 200, payload: { messageId: v.messageId, duplicate: false, delivery: v } };
    }
    if (opts.path === '/messages/deliveries') {
      if (this.mode === 'forgot') {
        return { ok: true, status: 200, payload: { deliveries: opts.query.ids.split(',').map((id) => ({ deliveryOperationId: id, state: 'unknown' })) } };
      }
      return { ok: true, status: 200, payload: { deliveries: opts.query.ids.split(',').map((id) => this.view(id) || { deliveryOperationId: id, state: 'unknown' }) } };
    }
    return { ok: false, status: 404, error: 'not_found' };
  }
  serverAck(id) { return this.bump(id, { whatsappStatus: 'server_ack', serverAckAt: this.clock() }); }
  delivered(id) {
    const v = this.ops.get(id);
    const at = this.clock();
    if (v.state === 'waiting_whatsapp_receipt') return this.bump(id, { state: 'delivered', whatsappStatus: 'delivered', deliveredAt: at, resolvedAt: at, serverAckAt: v.serverAckAt || at });
    return this.bump(id, { whatsappStatus: 'delivered', deliveredAt: at, lateDelivery: { at, whatsappStatus: 'delivered' } });
  }
  deadline(id) {
    const v = this.ops.get(id);
    if (v.state !== 'waiting_whatsapp_receipt') return this.view(id);
    return this.bump(id, { state: v.smsFallback ? 'sms_fallback_requested' : 'delivery_timeout', resolvedAt: this.clock(), fallbackReason: v.smsFallback ? 'delivery_timeout' : null });
  }
}

function harness({ features = true, strict = true, seed = {} } = {}) {
  let now = T0;
  const db = createFakeFirestore({
    'users/user-1': { uid: 'user-1', networkId: NET, account_features: { whatsapp_card_delivery: features } },
    [`networks/${NET}`]: { networkId: NET, owner_uid: 'user-1' },
    'Admins/admin-1': { uid: 'admin-1' },
    ...seed,
  }, { strictTransactions: strict });
  const railway = new RailwayModel();
  railway.clock = () => now;
  const deps = {
    ensureFirebaseAdmin: () => ({ ok: true }),
    getAuth: () => ({ verifyIdToken: async (token) => ({ uid: token === 'admin' ? 'admin-1' : token === 'other' ? 'user-2' : 'user-1' }) }),
    getFirestore: () => db,
    isAdminUid: async (uid) => uid === 'admin-1',
    callGateway: (opts) => railway.call(opts),
    gatewayConfigured: () => true,
    now: () => now,
    inboundSecret: SECRET,
  };
  const owner = async (route, { method = route === 'deliveries-status' || route === 'pending-fallback' ? 'GET' : 'POST', body, query = {}, token = 'owner' } = {}) => {
    const res = createRes();
    await whatsappGatewayHandler({ method, query: { __apiRoute: route, ...query }, headers: { authorization: `Bearer ${token}` }, body }, res, deps);
    return res;
  };
  const event = async (delivery, { secret = SECRET, type = 'delivery.updated', tamper = false } = {}) => {
    const text = JSON.stringify({ type, delivery });
    const ts = String(now);
    const signature = createHmac('sha256', secret).update(`${ts}.${text}`).digest('hex');
    const res = createRes();
    await deliveryEventsRouter({
      method: 'POST', query: { __apiRoute: 'events' },
      headers: { 'x-gateway-timestamp': ts, 'x-gateway-signature': signature },
      body: JSON.parse(text), rawBody: tamper ? `${text} ` : text,
    }, res, deps);
    return res;
  };
  const admin = async (query = {}, token = 'admin') => {
    const res = createRes();
    await deliveryEventsRouter({ method: 'GET', query: { __apiRoute: 'admin', ...query }, headers: { authorization: `Bearer ${token}` } }, res, deps);
    return res;
  };
  return {
    db, railway, deps, owner, event, admin,
    advance: (ms) => { now += ms; },
    now: () => now,
    stored: (id) => db._store.get(DOC(id)),
  };
}

const CARD_SEND = (id = 'dlv:sale-123:card-9:967771234567') => ({
  to: '+967 771 234 567', text: 'كرتك: 1234 / الرمز 9999', deliveryOperationId: id, operationId: id,
  saleRef: 'sale-123', cardRef: 'card-9', orderRef: 'A-77', customerRef: 'cust-5', templateKey: 'card_delivery_cash_template', smsFallback: true,
});

// ------------------------------------------------------------------ §12: two ticks within 10 s
test('§12 two delivery ticks within 10 s => delivered via WhatsApp, no SMS command', async () => {
  const h = harness();
  const id = 'dlv:sale-123:card-9:967771234567';
  const sent = await h.owner('send', { body: { ...CARD_SEND(id), networkId: 'ATTACKER' } });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.deliveryOperationId, id);
  assert.equal(sent.body.delivery.state, STATE.WAITING);
  assert.equal(sent.body.delivery.receiptDeadlineAtMs, T0 + 10_000);
  // Railway got the owned network, the v1 fields and the fixed 10 s window.
  const gw = h.railway.calls[0].body;
  assert.equal(gw.networkId, NET);
  assert.equal(gw.deliveryOperationId, id);
  assert.equal(gw.receiptTimeoutMs, 10_000);
  assert.equal(gw.smsFallback, true);
  assert.deepEqual(gw.refs, { saleRef: 'sale-123', cardRef: 'card-9', orderRef: 'A-77', customerRef: 'cust-5', templateKey: 'card_delivery_cash_template' });

  h.advance(1_200);
  assert.equal((await h.event(h.railway.serverAck(id))).statusCode, 200);
  assert.equal(h.stored(id).state, STATE.WAITING, 'server_ack (one tick) is not a delivery');
  assert.equal(h.stored(id).whatsappStatus, 'server_ack');
  h.advance(2_000);
  await h.event(h.railway.delivered(id));
  h.advance(30_000);
  await h.event(h.railway.deadline(id)); // the timer already lost: Railway re-announces delivered (no change)

  const status = await h.owner('deliveries-status', { query: { ids: id } });
  const view = status.body.deliveries[0];
  assert.equal(view.state, STATE.DELIVERED);
  assert.equal(view.finalOutcome, 'whatsapp');
  assert.equal(view.fallback, null);
  assert.equal(view.sms.status, 'none');
  assert.equal(view.deliveredAtMs, T0 + 3_200);
  assert.equal(view.serverAckAtMs, T0 + 1_200);
  const pending = await h.owner('pending-fallback');
  assert.deepEqual(pending.body.deliveries, []);
  // The message text (card secret) is never stored in Firestore.
  assert.ok(!JSON.stringify(h.stored(id)).includes('9999'));
  assert.equal('text' in h.stored(id), false);
});

// ------------------------------------------------------------------ §12: one tick then deadline
test('§12 one tick then the 10 s deadline => SMS command with the same card, then sms_fallback_sent', async () => {
  const h = harness();
  const id = 'dlv:sale-123:card-9:967771234567';
  await h.owner('send', { body: CARD_SEND(id) });
  h.advance(800);
  await h.event(h.railway.serverAck(id));
  h.advance(9_300);
  await h.event(h.railway.deadline(id));

  const pending = await h.owner('pending-fallback');
  assert.equal(pending.body.deliveries.length, 1);
  const cmd = pending.body.deliveries[0];
  assert.equal(cmd.state, STATE.FALLBACK);
  assert.equal(cmd.cardRef, 'card-9');
  assert.equal(cmd.saleRef, 'sale-123');
  assert.equal(cmd.whatsappStatus, 'server_ack');
  assert.deepEqual(cmd.fallback, { commandId: `${id}:sms`, reason: 'delivery_timeout', decidedBy: 'gateway', requestedAtMs: T0 + 10_100 });
  assert.equal(cmd.sms.status, 'pending');

  // Fallback with another card is refused.
  const wrong = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'sent', at: h.now(), cardRef: 'card-10', saleRef: 'sale-123' } });
  assert.equal(wrong.statusCode, 409);
  assert.equal(wrong.body.error, 'card_mismatch');

  h.advance(1_500);
  const ok = await h.owner('sms-result', { body: {
    deliveryOperationId: id, commandId: `${id}:sms`, attempt: 1, outcome: 'sent', at: h.now(), reason: 'delivery_timeout',
    saleRef: 'sale-123', cardRef: 'card-9', to: '967771234567',
  } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.duplicate, false);
  assert.equal(ok.body.delivery.state, STATE.SMS_SENT);
  assert.equal(ok.body.delivery.finalOutcome, 'sms');
  assert.equal(ok.body.delivery.sms.status, 'sent');
  assert.equal(ok.body.delivery.sms.attempts, 1);
  assert.equal('smsReports' in ok.body.delivery, false);

  const again = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'sent', at: h.now(), saleRef: 'sale-123', cardRef: 'card-9' } });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.duplicate, true, 'idempotent on (deliveryOperationId, attempt)');
  assert.deepEqual((await h.owner('pending-fallback')).body.deliveries, []);
});

// ------------------------------------------------------------------ §12: receipt during fallback
test('§12 receipt arriving while the fallback is executed => one outcome, late delivery recorded, no re-send', async () => {
  const h = harness();
  const id = 'dlv:sale-555:card-1:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-555', cardRef: 'card-1' } });
  h.advance(10_050);
  await h.event(h.railway.deadline(id));           // fallback decided by the Railway timer
  h.advance(400);
  const late = h.railway.delivered(id);              // receipt lands while the app sends the SMS
  const [evt, sms] = await Promise.all([
    h.event(late),
    h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'sent', at: h.now(), saleRef: 'sale-555', cardRef: 'card-1' } }),
  ]);
  assert.equal(evt.statusCode, 200);
  assert.equal(sms.statusCode, 200);
  const doc = h.stored(id);
  assert.equal(doc.state, STATE.SMS_SENT, 'the late receipt never turns the operation into delivered');
  assert.equal(doc.finalOutcome, 'sms');
  assert.equal(doc.whatsappStatus, 'delivered');
  assert.deepEqual(doc.lateDelivery, { atMs: T0 + 10_450, whatsappStatus: 'delivered' });
  assert.equal(doc.sms.attempts, 1);
  const sends = h.railway.calls.filter((c) => c.path === '/messages/send');
  assert.equal(sends.length, 1, 'nothing is re-sent on any channel');
  // A retry of the same send never relays again.
  const retry = await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-555', cardRef: 'card-1' } });
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.delivery.state, STATE.SMS_SENT);
  assert.equal(h.railway.calls.filter((c) => c.path === '/messages/send').length, 1);
});

test('race: server backup decision and a delivered event interleave in Firestore => exactly one wins (CAS)', async () => {
  // Railway answered `waiting` then went silent; its delivered event and the §6.3 backup decision race.
  const h = harness();
  const id = 'dlv:sale-777:card-2:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-777', cardRef: 'card-2' } });
  h.advance(10_000 + SILENT_GRACE_MS + 1);
  h.railway.mode = 'down';
  const delivered = h.railway.delivered(id); // Railway accepted the receipt before it went unreachable
  // Force a real interleaving: the first transaction to start is held after its reads until the other
  // one has committed, so its commit must detect the conflict and retry on fresh data.
  const original = h.db.runTransaction.bind(h.db);
  let first = true;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  h.db.runTransaction = async (callback) => {
    if (first) {
      first = false;
      return original(async (tx) => { const out = await callback(tx); await gate; return out; });
    }
    try { return await original(callback); } finally { release(); }
  };
  const [, evt] = await Promise.all([
    h.owner('deliveries-status', { query: { ids: id } }),
    h.event(delivered),
  ]);
  assert.equal(evt.statusCode, 200);
  const doc = h.stored(id);
  // Whichever committed first is final; the other became information only. Never both outcomes.
  if (doc.state === STATE.DELIVERED) {
    assert.equal(doc.fallback, null);
    assert.equal(doc.finalOutcome, 'whatsapp');
  } else {
    assert.equal(doc.state, STATE.FALLBACK);
    assert.equal(doc.fallback.decidedBy, 'server');
    assert.equal(doc.fallback.reason, 'gateway_silent_after_deadline');
    assert.equal(doc.lateDelivery.whatsappStatus, 'delivered');
  }
  assert.equal(h.db.transactionRetries, 1, 'the held transaction saw the conflict and re-ran');
});

test('race (deterministic): a delivered view applied after the backup fallback is only lateDelivery', () => {
  const base = applyRailwayView(null, {
    deliveryOperationId: 'dlv-race-0001', networkId: NET, state: 'waiting_whatsapp_receipt', whatsappStatus: 'sent',
    smsFallback: true, createdAt: T0, acceptedAt: T0, receiptDeadlineAt: T0 + 10_000, seq: 2, messageId: 'M1', refs: { cardRef: 'c' }, to: '967771234567',
  }, T0, { networkId: NET }).doc;
  const fb = resolveSilent(base, T0 + 25_001);
  assert.equal(fb.state, STATE.FALLBACK);
  const after = applyRailwayView(fb, {
    deliveryOperationId: 'dlv-race-0001', state: 'delivered', whatsappStatus: 'delivered', deliveredAt: T0 + 9_000, resolvedAt: T0 + 9_000, seq: 3,
  }, T0 + 26_000).doc;
  assert.equal(after.state, STATE.FALLBACK);
  assert.equal(after.finalOutcome, 'pending');
  assert.equal(after.deliveredAtMs, T0 + 9_000);
  assert.deepEqual(after.lateDelivery, { atMs: T0 + 9_000, whatsappStatus: 'delivered' });
  // And the reverse order: delivered first => the backup has nothing to decide.
  const del = applyRailwayView(base, { deliveryOperationId: 'dlv-race-0001', state: 'delivered', whatsappStatus: 'delivered', deliveredAt: T0 + 9_000, resolvedAt: T0 + 9_000, seq: 3 }, T0 + 9_100).doc;
  assert.equal(resolveSilent(del, T0 + 60_000), null);
});

// ------------------------------------------------------------------ §12: SMS failure
test('§12 SMS failure => reported, stays in pending-fallback, retried with the same card, abandon => failed', async () => {
  const h = harness();
  const id = 'dlv:sale-9:card-3:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-9', cardRef: 'card-3' } });
  h.advance(10_001);
  await h.event(h.railway.deadline(id));
  const fail1 = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'failed', at: h.now(), error: 'RESULT_ERROR_NO_SERVICE\nline2', saleRef: 'sale-9', cardRef: 'card-3' } });
  assert.equal(fail1.statusCode, 200);
  assert.equal(fail1.body.delivery.state, STATE.SMS_FAILED);
  assert.equal(fail1.body.delivery.sms.status, 'failed');
  assert.equal(fail1.body.delivery.sms.lastError, 'RESULT_ERROR_NO_SERVICE line2');
  assert.equal(fail1.body.delivery.finalOutcome, 'pending');

  const pending = await h.owner('pending-fallback');
  assert.deepEqual(pending.body.deliveries.map((d) => [d.deliveryOperationId, d.state, d.cardRef]), [[id, STATE.SMS_FAILED, 'card-3']]);

  const conflict = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'sent', at: h.now(), saleRef: 'sale-9', cardRef: 'card-3' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error, 'sms_attempt_conflict');

  const fail2 = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 2, outcome: 'failed', at: h.now() + 1, saleRef: 'sale-9', cardRef: 'card-3' } });
  assert.equal(fail2.body.delivery.state, STATE.SMS_FAILED);
  assert.equal(fail2.body.delivery.sms.attempts, 2);
  const sent3 = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 3, outcome: 'sent', at: h.now() + 2, saleRef: 'sale-9', cardRef: 'card-3' } });
  assert.equal(sent3.body.delivery.state, STATE.SMS_SENT);
  assert.equal(sent3.body.delivery.sms.lastError, null);

  // Abandon path on another operation.
  const id2 = 'dlv:sale-10:card-4:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id2), saleRef: 'sale-10', cardRef: 'card-4' } });
  h.advance(10_001);
  await h.event(h.railway.deadline(id2));
  await h.owner('sms-result', { body: { deliveryOperationId: id2, attempt: 1, outcome: 'failed', at: h.now(), saleRef: 'sale-10', cardRef: 'card-4' } });
  const ab = await h.owner('sms-result', { body: { deliveryOperationId: id2, attempt: 2, outcome: 'abandoned', at: h.now(), saleRef: 'sale-10', cardRef: 'card-4' } });
  assert.equal(ab.body.delivery.state, STATE.FAILED);
  assert.equal(ab.body.delivery.finalOutcome, 'none');
  assert.equal(ab.body.delivery.sms.status, 'failed');
});

// ------------------------------------------------------------------ §6.3 backup resolution
test('§6.3 Railway silent after deadline+15 s: unreachable => server decides gateway_silent_after_deadline', async () => {
  const h = harness();
  const id = 'dlv:sale-1:card-1:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-1', cardRef: 'card-1' } });
  h.advance(10_000 + SILENT_GRACE_MS); // exactly at the grace bound: not yet
  h.railway.mode = 'down';
  let s = await h.owner('deliveries-status', { query: { ids: id } });
  assert.equal(s.body.deliveries[0].state, STATE.WAITING);
  h.advance(1);
  s = await h.owner('deliveries-status', { query: { ids: `${id},dlv-missing-001` } });
  assert.equal(s.body.deliveries[0].state, STATE.FALLBACK);
  assert.equal(s.body.deliveries[0].fallback.reason, 'gateway_silent_after_deadline');
  assert.equal(s.body.deliveries[0].fallback.decidedBy, 'server');
  assert.deepEqual(s.body.deliveries[1], { deliveryOperationId: 'dlv-missing-001', state: 'unknown' });
});

test('§6.3 Railway answers: its state is applied; `unknown` => server fallback', async () => {
  const h = harness({ strict: false });
  const a = 'dlv:sale-a:card-a:967771234567';
  const b = 'dlv:sale-b:card-b:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(a), saleRef: 'sale-a', cardRef: 'card-a' } });
  await h.owner('send', { body: { ...CARD_SEND(b), saleRef: 'sale-b', cardRef: 'card-b' } });
  h.advance(30_000);
  h.railway.deadline(a); // decided on Railway, event lost
  let s = await h.owner('deliveries-status', { query: { ids: a } });
  assert.equal(s.body.deliveries[0].state, STATE.FALLBACK);
  assert.equal(s.body.deliveries[0].fallback.decidedBy, 'gateway');
  assert.equal(s.body.deliveries[0].fallback.reason, 'delivery_timeout');
  h.railway.mode = 'forgot';
  s = await h.owner('deliveries-status', { query: { ids: b } });
  assert.equal(s.body.deliveries[0].fallback.decidedBy, 'server');
});

test('pending-fallback also resolves overdue open operations so a restarted app recovers them', async () => {
  const h = harness();
  const id = 'dlv:sale-r:card-r:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-r', cardRef: 'card-r' } });
  h.advance(60_000);
  h.railway.mode = 'down';
  const p = await h.owner('pending-fallback');
  assert.deepEqual(p.body.deliveries.map((d) => [d.deliveryOperationId, d.state]), [[id, STATE.FALLBACK]]);
});

test('queued forever (Railway call timed out, never registered) => resolved after QUEUED_STALE_MS', () => {
  const doc = applyRailwayView(null, { deliveryOperationId: 'dlv-queued-01', state: 'queued', smsFallback: true, createdAt: T0, seq: 1 }, T0, { networkId: NET }).doc;
  assert.equal(resolveSilent(doc, T0 + QUEUED_STALE_MS), null);
  const r = resolveSilent(doc, T0 + QUEUED_STALE_MS + 1);
  assert.equal(r.state, STATE.FALLBACK);
  const legacy = resolveSilent({ ...doc, smsFallback: false }, T0 + QUEUED_STALE_MS + 1);
  assert.equal(legacy.state, STATE.FAILED);
  assert.equal(legacy.fallback, null);
});

// ------------------------------------------------------------------ send contract
test('send: pre-acceptance failure returns the fallback command immediately (app sends SMS now)', async () => {
  const h = harness();
  h.railway.mode = 'not_connected';
  const id = 'dlv:sale-x:card-x:967771234567';
  const r = await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-x', cardRef: 'card-x' } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'not_connected');
  assert.equal(r.body.delivery.state, STATE.FALLBACK);
  assert.equal(r.body.delivery.fallback.reason, 'whatsapp_send_failed:not_connected');
  assert.equal(r.body.delivery.fallback.commandId, `${id}:sms`);
});

test('send: ambiguous gateway failure keeps the record queued and returns no delivery', async () => {
  const h = harness();
  h.railway.mode = 'down';
  const id = 'dlv:sale-y:card-y:967771234567';
  const r = await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-y', cardRef: 'card-y' } });
  assert.equal(r.statusCode, 502);
  assert.equal(r.body.error, 'whatsapp_gateway_unreachable');
  assert.equal('delivery' in r.body, false);
  assert.equal(h.stored(id).state, STATE.QUEUED);
  h.railway.mode = 'ok';
  const retry = await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-y', cardRef: 'card-y' } });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.delivery.state, STATE.WAITING);
});

test('send: same id for another card/sale/recipient => 409 delivery_operation_conflict; validation', async () => {
  const h = harness();
  const id = 'dlv:sale-z:card-z:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-z', cardRef: 'card-z' } });
  for (const patch of [{ cardRef: 'card-other' }, { saleRef: 'sale-other' }, { to: '967700000000' }]) {
    const r = await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-z', cardRef: 'card-z', ...patch } });
    assert.equal(r.statusCode, 409, JSON.stringify(patch));
    assert.equal(r.body.error, 'delivery_operation_conflict');
  }
  const bad = [
    [{ operationId: 'different-id-123' }, 'operation_id_mismatch'],
    [{ deliveryOperationId: 'bad id with spaces', operationId: undefined }, 'invalid_delivery_operation_id'],
    [{ cardRef: 'x'.repeat(129) }, 'invalid_cardRef'],
    [{ templateKey: 'k'.repeat(65) }, 'invalid_templateKey'],
    [{ smsFallback: 'yes' }, 'invalid_sms_fallback'],
    [{ to: '12' }, 'invalid_recipient'],
    [{ deliveryOperationId: '__reserved__', operationId: undefined }, 'invalid_delivery_operation_id'],
  ];
  for (const [patch, error] of bad) {
    const r = await h.owner('send', { body: { ...CARD_SEND('dlv-valid-0001'), ...patch } });
    assert.equal(r.statusCode, 400, error);
    assert.equal(r.body.error, error);
  }
});

test('send: legacy body (operationId only) is unchanged for Railway and tracked with smsFallback:false', async () => {
  const h = harness();
  const r = await h.owner('send', { body: { to: '967771234567', text: 'hello', operationId: 'legacy-op-0001' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.success, true);
  assert.equal(typeof r.body.messageId, 'string');
  assert.equal(r.body.duplicate, false);
  assert.deepEqual(h.railway.calls[0].body, { networkId: NET, to: '967771234567', text: 'hello', operationId: 'legacy-op-0001' });
  const doc = h.stored('legacy-op-0001');
  assert.equal(doc.smsFallback, false);
  assert.equal(doc.legacy, true);
  h.advance(10_001);
  await h.event(h.railway.deadline('legacy-op-0001'));
  assert.equal(h.stored('legacy-op-0001').state, STATE.TIMEOUT);
  assert.equal(h.stored('legacy-op-0001').finalOutcome, 'none');
});

test('non-card message: no cardRef, sms-result without cardRef accepted; cardRef on a card record is mandatory', async () => {
  const h = harness();
  const id = 'msg:7f3a9c0d11';
  const r = await h.owner('send', { body: { to: '967771234567', text: 'ملخص يومي', deliveryOperationId: id, templateKey: 'daily_pos_summary_template', smsFallback: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.delivery.cardRef, null);
  h.advance(10_001);
  await h.event(h.railway.deadline(id));
  const ok = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'sent', at: h.now() } });
  assert.equal(ok.body.delivery.state, STATE.SMS_SENT);

  const card = 'dlv:sale-c:card-c:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(card), saleRef: 'sale-c', cardRef: 'card-c' } });
  const missing = await h.owner('sms-result', { body: { deliveryOperationId: card, attempt: 1, outcome: 'sent', at: h.now(), saleRef: 'sale-c' } });
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.body.error, 'card_mismatch');
});

// ------------------------------------------------------------------ sms-result edge cases
test('sms-result: app decided offline while waiting (app_offline_deadline), record unknown to server, after delivered', async () => {
  const h = harness();
  const id = 'dlv:sale-o:card-o:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-o', cardRef: 'card-o' } });
  h.advance(61_000);
  const off = await h.owner('sms-result', { body: { deliveryOperationId: id, attempt: 1, outcome: 'sent', at: h.now(), reason: 'app_offline_deadline', saleRef: 'sale-o', cardRef: 'card-o' } });
  assert.equal(off.body.delivery.state, STATE.SMS_SENT);
  assert.equal(off.body.delivery.fallback.decidedBy, 'app');
  assert.equal(off.body.delivery.fallback.reason, 'app_offline_deadline');

  // The app never reached the server (no internet), sent SMS locally and reports when back online.
  const unknown = 'dlv:sale-u:card-u:967771234567';
  const created = await h.owner('sms-result', { body: { deliveryOperationId: unknown, attempt: 1, outcome: 'sent', at: h.now() - 3_600_000, reason: 'whatsapp_unreachable', saleRef: 'sale-u', cardRef: 'card-u', to: '967771234567' } });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.delivery.state, STATE.SMS_SENT);
  assert.equal(created.body.delivery.fallback.reason, 'whatsapp_unreachable');
  assert.equal(created.body.delivery.createdAtMs, h.now() - 3_600_000);

  const d = 'dlv:sale-d:card-d:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(d), saleRef: 'sale-d', cardRef: 'card-d' } });
  await h.event(h.railway.delivered(d));
  const after = await h.owner('sms-result', { body: { deliveryOperationId: d, attempt: 1, outcome: 'sent', at: h.now(), saleRef: 'sale-d', cardRef: 'card-d' } });
  assert.equal(after.body.delivery.state, STATE.DELIVERED);
  assert.equal(after.body.applied, false);
  assert.deepEqual(after.body.delivery.smsAfterDelivered, { atMs: h.now(), attempt: 1, outcome: 'sent' });

  const invalid = await h.owner('sms-result', { body: { deliveryOperationId: d, attempt: 0, outcome: 'sent', at: h.now() } });
  assert.equal(invalid.body.error, 'invalid_attempt');
  assert.equal(parseSmsResult({ deliveryOperationId: d, attempt: 1, outcome: 'sent', at: h.now() + 600_000 }, h.now()).error, 'invalid_at');
  assert.equal(parseSmsResult({ deliveryOperationId: d, attempt: 1, outcome: 'maybe', at: h.now() }, h.now()).error, 'invalid_outcome');
  assert.equal(parseSmsResult({ deliveryOperationId: d, commandId: 'x:sms', attempt: 1, outcome: 'sent', at: h.now() }, h.now()).error, 'invalid_command_id');
  assert.equal(parseSmsResult({ deliveryOperationId: d, attempt: 1, outcome: 'sent', at: h.now(), reason: 'made_up' }, h.now()).error, 'invalid_reason');
});

// ------------------------------------------------------------------ auth / feature gate
test('auth: delivery bookkeeping works without the paid feature; send and other networks do not', async () => {
  const h = harness({ features: false });
  const send = await h.owner('send', { body: CARD_SEND() });
  assert.equal(send.statusCode, 403);
  assert.equal(send.body.error, 'whatsapp_card_delivery_required');
  const sms = await h.owner('sms-result', { body: { deliveryOperationId: 'dlv-nofeature-1', attempt: 1, outcome: 'sent', at: h.now(), cardRef: 'c1', saleRef: 's1' } });
  assert.equal(sms.statusCode, 200);
  assert.equal((await h.owner('pending-fallback')).statusCode, 200);
  assert.equal((await h.owner('deliveries-status', { query: { ids: 'dlv-nofeature-1' } })).statusCode, 200);
  assert.equal((await h.owner('sms-result', { method: 'GET' })).statusCode, 405);
  assert.equal((await h.owner('deliveries-status', { query: {} })).body.error, 'missing_ids');
  const many = Array.from({ length: 51 }, (_, i) => `dlv-many-${String(i).padStart(4, '0')}`).join(',');
  assert.equal((await h.owner('deliveries-status', { query: { ids: many } })).body.error, 'too_many_ids');
  // A user without a network cannot read anything.
  assert.notEqual((await h.owner('pending-fallback', { token: 'other' })).statusCode, 200);
});

// ------------------------------------------------------------------ Railway events
test('events: HMAC required, seq-ordered (replay and reorder ignored), unknown types acknowledged', async () => {
  const h = harness();
  const id = 'dlv:sale-e:card-e:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-e', cardRef: 'card-e' } });
  const ack = h.railway.serverAck(id);
  const del = h.railway.delivered(id);
  assert.equal((await h.event(del, { secret: 'x'.repeat(40) })).statusCode, 401);
  assert.equal((await h.event(del, { tamper: true })).statusCode, 401);
  assert.equal((await h.event(del)).statusCode, 200);
  const older = await h.event(ack); // arrives after the newer one
  assert.equal(older.statusCode, 200);
  assert.equal(h.stored(id).state, STATE.DELIVERED);
  assert.equal(h.stored(id).railwaySeq, del.seq);
  assert.equal((await h.event(del)).statusCode, 200); // replay
  assert.equal(h.stored(id).railwaySeq, del.seq);
  const other = await h.event(del, { type: 'session.updated' });
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.ignored, true);
  assert.equal((await h.event({ ...del, networkId: '../x' })).statusCode, 400);
});

test('events for an operation the server never recorded are adopted (no text, refs kept)', async () => {
  const h = harness();
  const view = {
    deliveryOperationId: 'dlv-direct-0001', networkId: NET, messageId: 'M9', state: 'waiting_whatsapp_receipt', whatsappStatus: 'sent',
    smsFallback: true, createdAt: T0, acceptedAt: T0, receiptDeadlineAt: T0 + 10_000, seq: 2, refs: { saleRef: 's', cardRef: 'c' }, to: '967771234567',
  };
  await h.event(view);
  const doc = h.stored('dlv-direct-0001');
  assert.equal(doc.state, STATE.WAITING);
  assert.equal(doc.cardRef, 'c');
  assert.equal(doc.to, '967771234567');
});

// ------------------------------------------------------------------ admin report §4.4
test('admin report: admin only; filters; summary; §4.4 fields present', async () => {
  const h = harness();
  const ids = ['dlv:sale-1:card-1:967771234567', 'dlv:sale-2:card-2:967771234567', 'dlv:sale-3:card-3:967771234567'];
  for (const [i, id] of ids.entries()) await h.owner('send', { body: { ...CARD_SEND(id), saleRef: `sale-${i + 1}`, cardRef: `card-${i + 1}` } });
  await h.event(h.railway.delivered(ids[0]));
  h.advance(10_001);
  await h.event(h.railway.deadline(ids[1]));
  await h.event(h.railway.deadline(ids[2]));
  await h.owner('sms-result', { body: { deliveryOperationId: ids[1], attempt: 1, outcome: 'sent', at: h.now(), saleRef: 'sale-2', cardRef: 'card-2' } });
  await h.owner('sms-result', { body: { deliveryOperationId: ids[2], attempt: 1, outcome: 'failed', at: h.now(), error: 'no_service', saleRef: 'sale-3', cardRef: 'card-3' } });

  assert.equal((await h.admin({}, 'owner')).statusCode, 403);
  const all = await h.admin();
  assert.equal(all.statusCode, 200);
  assert.equal(all.body.summary.total, 3);
  assert.deepEqual(all.body.summary.byOutcome, { whatsapp: 1, sms: 1, none: 0, pending: 1 });
  assert.equal(all.body.summary.byState[STATE.SMS_FAILED], 1);
  const row = all.body.deliveries.find((d) => d.deliveryOperationId === ids[1]);
  for (const field of ['saleRef', 'orderRef', 'customerRef', 'to', 'cardRef', 'firstChannel', 'acceptedAtMs', 'serverAckAtMs', 'deliveredAtMs', 'readAtMs',
    'receiptDeadlineAtMs', 'fallback', 'sms', 'attempts', 'lastError', 'messageId', 'finalOutcome', 'whatsappStatus']) {
    assert.ok(field in row, `report row must expose ${field}`);
  }
  const failed = await h.admin({ state: STATE.SMS_FAILED, networkId: NET });
  assert.deepEqual(failed.body.deliveries.map((d) => d.deliveryOperationId), [ids[2]]);
  assert.equal((await h.admin({ state: 'nope' })).body.error, 'invalid_state');
  assert.equal((await h.admin({ from: '2030-01-02', to: '2030-01-01' })).body.error, 'invalid_date_range');
  const none = await h.admin({ to: '2020-01-01' });
  assert.equal(none.body.summary.total, 0);
});

test('state helpers: finalOutcome mapping and whatsappStatus never regresses', () => {
  assert.equal(finalOutcomeOf(STATE.DELIVERED), 'whatsapp');
  assert.equal(finalOutcomeOf(STATE.SMS_SENT), 'sms');
  assert.equal(finalOutcomeOf(STATE.TIMEOUT), 'none');
  assert.equal(finalOutcomeOf(STATE.SMS_FAILED), 'pending');
  const d = applyRailwayView(null, { deliveryOperationId: 'dlv-rank-0001', state: 'delivered', whatsappStatus: 'read', seq: 5 }, T0, { networkId: NET }).doc;
  const e = applyRailwayView(d, { deliveryOperationId: 'dlv-rank-0001', state: 'delivered', whatsappStatus: 'error', lastError: 'x', seq: 6 }, T0).doc;
  assert.equal(e.whatsappStatus, 'read');
  assert.equal(parseSendBody({ to: '967771234567', text: 't', deliveryOperationId: 'dlv-ok-00001' }).value.smsFallback, true);
  const r = applySmsResult(null, { id: 'dlv-none-0001', attempt: 1, outcome: 'sent', at: T0, refs: {}, to: null, reason: null, error: null }, T0, { networkId: NET });
  assert.equal(r.status, 404);
});

test('reconcile is a no-op for records that are not overdue (no Railway call)', async () => {
  const h = harness();
  const id = 'dlv:sale-n:card-n:967771234567';
  await h.owner('send', { body: { ...CARD_SEND(id), saleRef: 'sale-n', cardRef: 'card-n' } });
  const before = h.railway.calls.length;
  const out = await reconcile(h.db, NET, [h.stored(id)], h.deps);
  assert.equal(out.size, 0);
  assert.equal(h.railway.calls.length, before);
  const doc = await applyViewTx(h.db, NET, h.railway.view(id), h.now());
  assert.equal(doc.state, STATE.WAITING);
});
