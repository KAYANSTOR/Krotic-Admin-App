// ============================================================
// WhatsApp delivery endpoints (contract §6, §5.3, §9). Routed through api/router.js:
//   POST /api/whatsapp/messages/send               -> sendDelivery        (owner + whatsapp_card_delivery)
//   GET  /api/whatsapp/deliveries/status?ids=       -> deliveriesStatus    (owner)
//   POST /api/whatsapp/deliveries/sms-result        -> smsResult           (owner)
//   GET  /api/whatsapp/deliveries/pending-fallback  -> pendingFallback     (owner)
//   POST /api/whatsapp/delivery-events              -> deliveryEventsHandler (Railway, HMAC)
//   GET  /api/admin/whatsapp-deliveries             -> adminDeliveriesHandler (admin)
// Status, sms-result and pending-fallback deliberately do not require the paid feature: an SMS
// fallback that is already owed must still be executed and recorded if the feature is removed.
// ============================================================

import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from './firebaseAdmin.js';
import { callGateway as defaultCallGateway, gatewayConfigured as defaultGatewayConfigured } from './whatsappGatewayClient.js';
import { verifyInboundSignature, inboundSecret } from './whatsappInbound.js';
import {
  DELIVERY_COLLECTION, DELIVERY_STATES, STATE,
  applyRailwayView, applySmsResult, deliveryRef, isValidDeliveryId, needsReconcile, newDeliveryDoc,
  parseSendBody, parseSmsResult, resolveSilent, sendConflicts, toDeliveryView,
} from './whatsappDeliveries.js';

export const RECEIPT_TIMEOUT_MS = 10_000;
const MAX_IDS = 50;
const NETWORK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// Railway answers /messages/send right after relayMessage (well under this); 25 s matches the client default.
const SEND_TIMEOUT_MS = 25_000;
const LOOKUP_TIMEOUT_MS = 8_000;

function deps(dependencies) {
  return {
    now: () => (typeof dependencies.now === 'function' ? dependencies.now() : dependencies.now ?? Date.now()),
    callGateway: dependencies.callGateway || defaultCallGateway,
    gatewayConfigured: dependencies.gatewayConfigured || defaultGatewayConfigured,
  };
}

function queryValue(req, name) {
  const v = req.query?.[name];
  if (v != null) return Array.isArray(v) ? v[0] : String(v);
  try { return new URL(req.url || '/', 'https://krotak.invalid').searchParams.get(name); } catch { return null; }
}

function parseIds(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'missing_ids' };
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: 'missing_ids' };
  if (ids.length > MAX_IDS) return { ok: false, error: 'too_many_ids' };
  if (!ids.every(isValidDeliveryId)) return { ok: false, error: 'invalid_delivery_operation_id' };
  return { ok: true, ids };
}

function firestoreFailure(res, error, label) {
  console.error(`whatsapp/deliveries ${label} failed`, { code: error?.code, message: error?.message });
  const quota = error?.code === 8 || error?.code === 'RESOURCE_EXHAUSTED';
  return res.status(quota ? 503 : 500).json({ success: false, error: quota ? 'firestore_quota_exceeded' : 'delivery_store_failed' });
}

/** Transactionally applies a Railway view (seq-ordered). Returns the stored doc after the update. */
export async function applyViewTx(db, networkId, view, now) {
  const ref = deliveryRef(db, networkId, view.deliveryOperationId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data() : null;
    const { doc, changed } = applyRailwayView(stored, view, now, { networkId });
    if (changed) tx.set(ref, doc);
    return doc;
  });
}

// ---------------------------------------------------------------- send (§6.1)
export async function sendDelivery(req, res, { networkId, db, body }, dependencies = {}) {
  const d = deps(dependencies);
  const parsed = parseSendBody(body);
  if (!parsed.ok) return res.status(parsed.status).json({ success: false, error: parsed.error });
  if (!d.gatewayConfigured()) return res.status(503).json({ success: false, error: 'whatsapp_gateway_not_configured' });
  const p = parsed.value;
  const ref = deliveryRef(db, networkId, p.id);

  let record;
  try {
    record = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const stored = snap.data();
        if (sendConflicts(stored, p)) return { conflict: true };
        return { doc: stored };
      }
      const doc = newDeliveryDoc({ networkId, id: p.id, to: p.to, refs: p.refs, smsFallback: p.smsFallback, legacy: p.legacy, now: d.now() });
      tx.set(ref, doc);
      return { doc };
    });
  } catch (error) {
    return firestoreFailure(res, error, 'send');
  }
  if (record.conflict) return res.status(409).json({ success: false, error: 'delivery_operation_conflict' });
  if (![STATE.QUEUED, STATE.WAITING].includes(record.doc.state)) {
    // Already resolved here (delivered, SMS fallback decided by gateway/server/app, failed): a retry of the
    // same operation must never relay a new WhatsApp message (Railway may not even know it, e.g. a record
    // created by sms-result). Same operation => same answer.
    return res.status(200).json({
      success: true,
      deliveryOperationId: p.id,
      messageId: record.doc.messageId ?? null,
      duplicate: true,
      delivery: toDeliveryView(record.doc),
    });
  }

  const gatewayBody = p.legacy
    ? { networkId, to: p.rawTo, text: p.text, operationId: p.id }
    : {
      networkId, to: p.rawTo, text: p.text, operationId: p.id, deliveryOperationId: p.id,
      receiptTimeoutMs: RECEIPT_TIMEOUT_MS, smsFallback: p.smsFallback, refs: p.refs,
    };
  const result = await d.callGateway({ method: 'POST', path: '/messages/send', body: gatewayBody, timeoutMs: SEND_TIMEOUT_MS });
  const view = result.payload?.delivery;
  let stored = record.doc;
  if (view && typeof view === 'object' && view.deliveryOperationId === p.id) {
    try {
      stored = await applyViewTx(db, networkId, view, d.now());
    } catch (error) {
      // The send itself succeeded/failed on Railway; Railway's signed event will re-deliver this state.
      console.error('whatsapp/deliveries send: mirror failed', { code: error?.code, message: error?.message });
    }
  }
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      error: result.error,
      deliveryOperationId: p.id,
      ...(view ? { delivery: toDeliveryView(stored) } : {}),
      ...(result.payload && typeof result.payload === 'object' && !view ? { gateway: result.payload } : {}),
    });
  }
  return res.status(200).json({
    success: true,
    deliveryOperationId: p.id,
    messageId: result.payload?.messageId ?? stored?.messageId ?? null,
    duplicate: result.payload?.duplicate === true,
    delivery: toDeliveryView(stored),
  });
}

// ---------------------------------------------------------------- reconcile (§6.3)
/**
 * For records Railway should have resolved already: ask Railway; apply its answer; if it does not
 * answer or does not know the operation, resolve atomically on the server (gateway_silent_after_deadline).
 * @returns {Promise<Map<string, object>>} updated docs by id
 */
export async function reconcile(db, networkId, docs, dependencies = {}) {
  const d = deps(dependencies);
  const now = d.now();
  const due = docs.filter((doc) => needsReconcile(doc, now));
  const updated = new Map();
  if (due.length === 0) return updated;

  let views = null; // null = Railway unavailable
  if (d.gatewayConfigured()) {
    const r = await d.callGateway({
      method: 'GET', path: '/messages/deliveries', query: { networkId, ids: due.map((x) => x.deliveryOperationId).join(',') },
      timeoutMs: LOOKUP_TIMEOUT_MS,
    });
    if (r.ok && Array.isArray(r.payload?.deliveries)) {
      views = new Map(r.payload.deliveries.filter((v) => v && typeof v === 'object').map((v) => [v.deliveryOperationId, v]));
    }
  }
  for (const doc of due) {
    const id = doc.deliveryOperationId;
    const view = views?.get(id);
    const ref = deliveryRef(db, networkId, id);
    const known = view && view.state && view.state !== 'unknown';
    const next = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      let current = snap.data();
      if (known) {
        const r = applyRailwayView(current, view, now, { networkId });
        if (r.changed) current = r.doc;
        // Railway knows it and is still deciding (its timer fires at the deadline): it stays the authority.
        if (r.changed) tx.set(ref, current);
        return current;
      }
      const resolved = resolveSilent(current, now); // CAS: only if still queued/waiting and overdue
      if (!resolved) return current;
      tx.set(ref, resolved);
      return resolved;
    });
    if (next) updated.set(id, next);
  }
  return updated;
}

// ---------------------------------------------------------------- status (§6.2)
export async function deliveriesStatus(req, res, { networkId, db }, dependencies = {}) {
  const parsed = parseIds(queryValue(req, 'ids'));
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
  try {
    const snaps = await Promise.all(parsed.ids.map((id) => deliveryRef(db, networkId, id).get()));
    const docs = snaps.filter((s) => s.exists).map((s) => s.data());
    const updated = await reconcile(db, networkId, docs, dependencies);
    const byId = new Map(docs.map((doc) => [doc.deliveryOperationId, updated.get(doc.deliveryOperationId) || doc]));
    return res.status(200).json({
      success: true,
      deliveries: parsed.ids.map((id) => (byId.has(id) ? toDeliveryView(byId.get(id)) : { deliveryOperationId: id, state: 'unknown' })),
    });
  } catch (error) {
    return firestoreFailure(res, error, 'status');
  }
}

// ---------------------------------------------------------------- sms-result (§6.4)
export async function smsResult(req, res, { networkId, db, body }, dependencies = {}) {
  const d = deps(dependencies);
  const now = d.now();
  const parsed = parseSmsResult(body, now);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
  const report = parsed.value;
  const ref = deliveryRef(db, networkId, report.id);
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const r = applySmsResult(snap.exists ? snap.data() : null, report, now, { networkId });
      if (r.ok && !r.duplicate) tx.set(ref, r.doc);
      return r;
    });
    if (!out.ok) return res.status(out.status).json({ success: false, error: out.error });
    return res.status(200).json({ success: true, duplicate: out.duplicate, applied: out.applied, delivery: toDeliveryView(out.doc) });
  } catch (error) {
    return firestoreFailure(res, error, 'sms-result');
  }
}

// ---------------------------------------------------------------- pending-fallback (§6.5)
export async function pendingFallback(req, res, { networkId, db }, dependencies = {}) {
  const raw = Number.parseInt(queryValue(req, 'limit') ?? '50', 10);
  const limit = Number.isSafeInteger(raw) ? Math.min(MAX_IDS, Math.max(1, raw)) : 50;
  const col = db.collection('networks').doc(networkId).collection(DELIVERY_COLLECTION);
  try {
    // Records Railway never resolved (event lost, Railway down) are resolved first so they are returned too.
    const openSnap = await col.where('state', 'in', [STATE.QUEUED, STATE.WAITING]).limit(200).get();
    const open = openSnap.docs.map((s) => s.data()).filter((doc) => doc && [STATE.QUEUED, STATE.WAITING].includes(doc.state));
    await reconcile(db, networkId, open, dependencies);

    const snap = await col.where('state', 'in', [STATE.FALLBACK, STATE.SMS_FAILED]).limit(500).get();
    const deliveries = snap.docs.map((s) => s.data())
      .filter((doc) => doc && (doc.state === STATE.FALLBACK || doc.state === STATE.SMS_FAILED))
      .sort((a, b) => (a.fallback?.requestedAtMs ?? a.createdAtMs ?? 0) - (b.fallback?.requestedAtMs ?? b.createdAtMs ?? 0))
      .slice(0, limit)
      .map(toDeliveryView);
    return res.status(200).json({ success: true, limit, deliveries });
  } catch (error) {
    return firestoreFailure(res, error, 'pending-fallback');
  }
}

// ---------------------------------------------------------------- Railway events (§5.3)
function rawBodyText(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
}

export async function deliveryEventsHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const init = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error || 'server_not_configured' });

  const d = deps(dependencies);
  const secret = dependencies.inboundSecret ?? inboundSecret();
  const signature = String(req.headers?.['x-gateway-signature'] || '').trim();
  const timestampHeader = String(req.headers?.['x-gateway-timestamp'] || '').trim();
  const now = d.now();
  let sig = verifyInboundSignature({ signature, timestampHeader, bodyText: rawBodyText(req), secret, now });
  if (!sig.ok && sig.error === 'signature_mismatch' && req.body && typeof req.body === 'object' && req.rawBody == null) {
    sig = verifyInboundSignature({ signature, timestampHeader, bodyText: JSON.stringify(req.body), secret, now });
  }
  if (!sig.ok) return res.status(401).json({ success: false, error: sig.error });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ success: false, error: 'invalid_json' });
  // Unknown event types are acknowledged (2xx) so the Railway outbox does not retry them for 24 h.
  if (body.type !== 'delivery.updated') return res.status(200).json({ success: true, ignored: true });
  const view = body.delivery;
  const networkId = typeof view?.networkId === 'string' ? view.networkId : '';
  if (!NETWORK_ID_RE.test(networkId)) return res.status(400).json({ success: false, error: 'invalid_network_id' });
  if (!isValidDeliveryId(view?.deliveryOperationId)) return res.status(400).json({ success: false, error: 'invalid_delivery_operation_id' });

  const db = (dependencies.getFirestore || getFirestore)();
  try {
    const doc = await applyViewTx(db, networkId, view, now);
    return res.status(200).json({ success: true, state: doc?.state ?? null, railwaySeq: doc?.railwaySeq ?? null });
  } catch (error) {
    return firestoreFailure(res, error, 'event'); // 5xx => Railway retries
  }
}

// ---------------------------------------------------------------- admin report (§4.4, §9)
const ADMIN_DEFAULT_LIMIT = 100;
const ADMIN_MAX_LIMIT = 500;

export function summarize(deliveries) {
  const byState = Object.fromEntries(DELIVERY_STATES.map((s) => [s, 0]));
  const byOutcome = { whatsapp: 0, sms: 0, none: 0, pending: 0 };
  let lateDelivery = 0;
  let smsAfterDelivered = 0;
  for (const doc of deliveries) {
    if (doc.state in byState) byState[doc.state] += 1;
    if (doc.finalOutcome in byOutcome) byOutcome[doc.finalOutcome] += 1;
    if (doc.lateDelivery) lateDelivery += 1;
    if (doc.smsAfterDelivered) smsAfterDelivered += 1;
  }
  return { total: deliveries.length, byState, byOutcome, lateDelivery, smsAfterDelivered };
}

function parseDayMs(value, endOfDay) {
  if (value == null || value === '') return null;
  if (/^\d{13}$/.test(value)) return Number(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(t) ? t + (endOfDay ? 86_400_000 - 1 : 0) : NaN;
}

export async function adminDeliveriesHandler(req, res, dependencies = {}) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const init = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error || 'server_not_configured' });
  const getDb = dependencies.getFirestore || getFirestore;
  const admin = await (dependencies.authenticateAdmin || authenticateAdmin)(req, {
    getAuth: dependencies.getAuth || getAuth,
    getFirestore: getDb,
  });
  if (!admin.ok) return res.status(admin.status).json({ success: false, error: admin.error });

  const networkId = queryValue(req, 'networkId') || null;
  const state = queryValue(req, 'state') || null;
  const from = parseDayMs(queryValue(req, 'from'), false);
  const to = parseDayMs(queryValue(req, 'to'), true);
  const rawLimit = Number.parseInt(queryValue(req, 'limit') ?? String(ADMIN_DEFAULT_LIMIT), 10);
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(ADMIN_MAX_LIMIT, Math.max(1, rawLimit)) : ADMIN_DEFAULT_LIMIT;
  if (networkId && !NETWORK_ID_RE.test(networkId)) return res.status(400).json({ success: false, error: 'invalid_network_id' });
  if (state && !DELIVERY_STATES.includes(state)) return res.status(400).json({ success: false, error: 'invalid_state' });
  if (Number.isNaN(from) || Number.isNaN(to) || (from != null && to != null && from > to)) {
    return res.status(400).json({ success: false, error: 'invalid_date_range' });
  }

  const db = getDb();
  try {
    // Indexes: firestore.indexes.json (wa_deliveries.createdAtMs single-field, COLLECTION + COLLECTION_GROUP;
    // composite state+createdAtMs for both scopes).
    let query = networkId
      ? db.collection('networks').doc(networkId).collection(DELIVERY_COLLECTION)
      : db.collectionGroup(DELIVERY_COLLECTION);
    if (state) query = query.where('state', '==', state);
    if (from != null) query = query.where('createdAtMs', '>=', from);
    if (to != null) query = query.where('createdAtMs', '<=', to);
    const snap = await query.orderBy('createdAtMs', 'desc').limit(limit).get();
    const deliveries = snap.docs.map((s) => s.data())
      .filter((doc) => doc && (!networkId || doc.networkId === networkId) && (!state || doc.state === state)
        && (from == null || doc.createdAtMs >= from) && (to == null || doc.createdAtMs <= to))
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .slice(0, limit)
      .map(toDeliveryView);
    return res.status(200).json({
      success: true,
      filters: { networkId, state, from, to, limit },
      truncated: snap.docs.length >= limit,
      summary: summarize(deliveries),
      deliveries,
    });
  } catch (error) {
    const indexMissing = error?.code === 9 || error?.code === 'FAILED_PRECONDITION';
    if (indexMissing) {
      console.error('admin/whatsapp-deliveries index missing', { message: error?.message });
      return res.status(503).json({ success: false, error: 'delivery_index_missing' });
    }
    return firestoreFailure(res, error, 'admin');
  }
}
