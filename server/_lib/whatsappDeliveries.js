// ============================================================
// WhatsApp delivery operations on the Krotak server (contract: contracts/whatsapp-delivery-v1.md).
//
// Firestore: networks/{networkId}/wa_deliveries/{deliveryOperationId}  (Admin SDK writes only).
// Railway owns the 10-second receipt timer and the WhatsApp-side state; this module mirrors it
// (ordered by Railway `seq`), adds the SMS-fallback outcome reported by the app, and performs the
// backup resolution when Railway stays silent after the deadline (§6.3).
//
// Every state change is a pure function `(stored, input, now) -> { doc, ... }` applied inside a
// Firestore transaction (compare-and-set): a late receipt and a fallback decision can never both win.
// Message text and card secrets are never stored here.
// ============================================================

export const DELIVERY_COLLECTION = 'wa_deliveries';

export const STATE = Object.freeze({
  QUEUED: 'queued',
  WAITING: 'waiting_whatsapp_receipt',
  DELIVERED: 'delivered',
  FALLBACK: 'sms_fallback_requested',
  SMS_SENT: 'sms_fallback_sent',
  SMS_FAILED: 'sms_fallback_failed',
  FAILED: 'failed',
  TIMEOUT: 'delivery_timeout',
});
export const DELIVERY_STATES = Object.freeze(Object.values(STATE));
const OPEN = new Set([STATE.QUEUED, STATE.WAITING]);
/** States reached after the WhatsApp attempt lost (fallback decided / no channel). */
const AFTER_WHATSAPP = new Set([STATE.FALLBACK, STATE.SMS_SENT, STATE.SMS_FAILED, STATE.FAILED, STATE.TIMEOUT]);

const WA_RANK = Object.freeze({ pending: 0, sent: 1, server_ack: 2, error: 2, delivered: 3, read: 4 });
export const WHATSAPP_STATUSES = Object.freeze(Object.keys(WA_RANK));

export const FALLBACK_REASONS = Object.freeze([
  'delivery_timeout', 'delivery_timeout_after_restart', 'whatsapp_ack_error', 'whatsapp_send_interrupted',
  'gateway_silent_after_deadline', 'whatsapp_unreachable', 'app_offline_deadline',
]);
const FALLBACK_REASON_SET = new Set(FALLBACK_REASONS);
const SEND_FAILED_REASON = /^whatsapp_send_failed:[a-z0-9_]{1,64}$/;

/** Same id grammar as Railway; Firestore reserves `__*__` ids. */
export const DELIVERY_ID_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const REF_KEYS = Object.freeze(['saleRef', 'cardRef', 'orderRef', 'customerRef']);
const MAX_REF = 128;
const MAX_TEMPLATE_KEY = 64;
const MAX_ERROR = 200;

/** Backup resolution (§6.3): Railway silent this long after receiptDeadlineAt. */
export const SILENT_GRACE_MS = 15_000;
/**
 * A record that never left `queued` (Vercel wrote it, the Railway call timed out and no event ever came).
 * Railway relays within seconds, so after this window an operation Railway does not know was never sent.
 */
export const QUEUED_STALE_MS = 120_000;
/** sms-result `at` may not be in the future beyond this clock skew. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export function isValidDeliveryId(id) {
  return typeof id === 'string' && DELIVERY_ID_RE.test(id) && !/^__.*__$/.test(id);
}

export function isValidFallbackReason(reason) {
  return typeof reason === 'string' && (FALLBACK_REASON_SET.has(reason) || SEND_FAILED_REASON.test(reason));
}

/** Same rule as Railway `toJid` (digits only, no leading 00, 8–15 digits). */
export function normalizeRecipient(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '').replace(/^00/, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function deliveryRef(db, networkId, id) {
  return db.collection('networks').doc(networkId).collection(DELIVERY_COLLECTION).doc(id);
}

function optionalRef(value, max, code) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) return { ok: false, error: code };
  return { ok: true, value: value.trim() };
}

function finiteMs(value) {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function cleanError(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, MAX_ERROR);
}

/** Parses refs shared by send and sms-result. */
export function parseRefs(body) {
  const refs = {};
  for (const key of REF_KEYS) {
    const r = optionalRef(body?.[key], MAX_REF, `invalid_${key}`);
    if (!r.ok) return r;
    refs[key] = r.value;
  }
  const t = optionalRef(body?.templateKey, MAX_TEMPLATE_KEY, 'invalid_templateKey');
  if (!t.ok) return t;
  refs.templateKey = t.value;
  return { ok: true, value: refs };
}

/**
 * POST /api/whatsapp/messages/send body (§6.1). Legacy bodies (operationId only) stay valid and are
 * tracked with smsFallback:false (§8).
 */
export function parseSendBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'missing_send_fields' };
  const rawTo = typeof body.to === 'string' ? body.to.trim() : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
  const deliveryOperationId = typeof body.deliveryOperationId === 'string' ? body.deliveryOperationId.trim() : '';
  const legacy = !deliveryOperationId;
  if (!rawTo || !text || (!operationId && !deliveryOperationId)) return { ok: false, status: 400, error: 'missing_send_fields' };
  if (text.length > 4096) return { ok: false, status: 400, error: 'text_too_long' };
  if (operationId && !isValidDeliveryId(operationId)) return { ok: false, status: 400, error: 'invalid_operation_id' };
  if (!legacy && !isValidDeliveryId(deliveryOperationId)) return { ok: false, status: 400, error: 'invalid_delivery_operation_id' };
  if (!legacy && operationId && operationId !== deliveryOperationId) return { ok: false, status: 400, error: 'operation_id_mismatch' };
  const to = normalizeRecipient(rawTo);
  if (!to) return { ok: false, status: 400, error: 'invalid_recipient' };
  if (body.smsFallback !== undefined && typeof body.smsFallback !== 'boolean') return { ok: false, status: 400, error: 'invalid_sms_fallback' };
  const refs = legacy ? { saleRef: null, cardRef: null, orderRef: null, customerRef: null, templateKey: null } : parseRefs(body);
  if (!legacy && !refs.ok) return { ok: false, status: 400, error: refs.error };
  return {
    ok: true,
    value: {
      id: legacy ? operationId : deliveryOperationId,
      legacy,
      to,
      rawTo,
      text,
      smsFallback: legacy ? false : body.smsFallback !== false,
      refs: legacy ? refs : refs.value,
    },
  };
}

export function finalOutcomeOf(state) {
  if (state === STATE.DELIVERED) return 'whatsapp';
  if (state === STATE.SMS_SENT) return 'sms';
  if (state === STATE.FAILED || state === STATE.TIMEOUT) return 'none';
  return 'pending';
}

function smsStatusOf(doc) {
  if (doc.state === STATE.SMS_SENT || doc.sms?.sentAtMs) return 'sent';
  if (doc.state === STATE.SMS_FAILED || (doc.state === STATE.FAILED && doc.sms?.attempts > 0)) return 'failed';
  if (doc.state === STATE.FALLBACK) return 'pending';
  return doc.sms?.attempts > 0 ? (doc.sms.lastError ? 'failed' : 'sent') : 'none';
}

function finish(doc, now) {
  doc.finalOutcome = finalOutcomeOf(doc.state);
  doc.sms = { ...doc.sms, status: smsStatusOf(doc) };
  doc.updatedAtMs = now;
  return doc;
}

/** New Firestore record (state queued) — never contains message text. */
export function newDeliveryDoc({ networkId, id, to, refs = {}, smsFallback, legacy = false, now }) {
  return finish({
    deliveryOperationId: id,
    networkId,
    saleRef: refs.saleRef ?? null,
    cardRef: refs.cardRef ?? null,
    orderRef: refs.orderRef ?? null,
    customerRef: refs.customerRef ?? null,
    templateKey: refs.templateKey ?? null,
    to: to ?? null,
    firstChannel: 'whatsapp',
    legacy: Boolean(legacy),
    state: STATE.QUEUED,
    whatsappStatus: 'pending',
    messageId: null,
    smsFallback: Boolean(smsFallback),
    createdAtMs: now,
    acceptedAtMs: null,
    receiptDeadlineAtMs: null,
    serverAckAtMs: null,
    deliveredAtMs: null,
    readAtMs: null,
    resolvedAtMs: null,
    fallback: null,
    sms: { status: 'none', attempts: 0, lastAttemptAtMs: null, sentAtMs: null, lastError: null },
    smsReports: {},
    lateDelivery: null,
    smsAfterDelivered: null,
    attempts: 0,
    lastError: null,
    finalOutcome: 'pending',
    railwaySeq: 0,
    updatedAtMs: now,
  }, now);
}

/** Same operation id reused for another sale/card/recipient ⇒ 409 delivery_operation_conflict. */
export function sendConflicts(stored, { to, refs }) {
  if (!stored) return false;
  if ((stored.saleRef ?? null) !== (refs.saleRef ?? null)) return true;
  if ((stored.cardRef ?? null) !== (refs.cardRef ?? null)) return true;
  if (stored.to && to && stored.to !== to) return true;
  return false;
}

function fallbackDecision(id, reason, decidedBy, at) {
  return { commandId: `${id}:sms`, reason, decidedBy, requestedAtMs: at };
}

/**
 * Applies a RailwayDeliveryView (send response, GET /messages/deliveries, signed event) to the stored
 * record. Ordered by `seq`: a view whose seq is not newer than railwaySeq is ignored (replay / reorder).
 * Railway is the authority while the operation is open; once the record is resolved here (fallback,
 * SMS outcome, server backup decision) a WhatsApp receipt only becomes `lateDelivery` (§3).
 * @returns {{ doc: object, changed: boolean, stale?: boolean }}
 */
export function applyRailwayView(stored, view, now, { networkId } = {}) {
  if (!view || typeof view !== 'object' || !isValidDeliveryId(view.deliveryOperationId)) {
    return { doc: stored, changed: false, invalid: true };
  }
  const seq = Number.isSafeInteger(view.seq) ? view.seq : 0;
  let doc = stored ? structuredClone(stored) : null;
  if (!doc) {
    // Event for an operation this server never recorded (e.g. sent directly to Railway): adopt it.
    const refs = view.refs && typeof view.refs === 'object' ? view.refs : {};
    const parsed = parseRefs(refs);
    doc = newDeliveryDoc({
      networkId: networkId || view.networkId,
      id: view.deliveryOperationId,
      to: normalizeRecipient(view.to),
      refs: parsed.ok ? parsed.value : {},
      smsFallback: view.smsFallback === true,
      legacy: view.legacy === true,
      now: finiteMs(view.createdAt) || now,
    });
  } else if (seq <= (doc.railwaySeq || 0)) {
    return { doc: stored, changed: false, stale: true };
  }

  const ms = (k) => finiteMs(view[k]);
  // Receipt facts are monotonic: keep the first time each was observed.
  if (typeof view.messageId === 'string' && view.messageId) doc.messageId = view.messageId.slice(0, 200);
  for (const [from, to] of [['acceptedAt', 'acceptedAtMs'], ['receiptDeadlineAt', 'receiptDeadlineAtMs'],
    ['serverAckAt', 'serverAckAtMs'], ['deliveredAt', 'deliveredAtMs'], ['readAt', 'readAtMs']]) {
    if (ms(from) && !doc[to]) doc[to] = ms(from);
  }
  if (typeof view.whatsappStatus === 'string' && (WA_RANK[view.whatsappStatus] ?? -1) > (WA_RANK[doc.whatsappStatus] ?? -1)) {
    // error never overrides delivered/read (same rank rule as Railway)
    doc.whatsappStatus = view.whatsappStatus;
  }
  if (Number.isSafeInteger(view.attempts) && view.attempts > (doc.attempts || 0)) doc.attempts = view.attempts;
  if (view.lastError) doc.lastError = cleanError(view.lastError);
  if (typeof view.smsFallback === 'boolean' && doc.state === STATE.QUEUED) doc.smsFallback = view.smsFallback;
  doc.railwaySeq = Math.max(doc.railwaySeq || 0, seq);

  const resolvedAt = ms('resolvedAt') || now;
  const receiptSeen = view.state === STATE.DELIVERED || view.whatsappStatus === 'delivered' || view.whatsappStatus === 'read';

  if (OPEN.has(doc.state)) {
    switch (view.state) {
      case STATE.WAITING:
        doc.state = STATE.WAITING;
        break;
      case STATE.DELIVERED:
        doc.state = STATE.DELIVERED;
        doc.resolvedAtMs = resolvedAt;
        break;
      case STATE.FALLBACK: {
        const reason = isValidFallbackReason(view.fallbackReason) ? view.fallbackReason : 'delivery_timeout';
        doc.state = STATE.FALLBACK;
        doc.resolvedAtMs = resolvedAt;
        doc.fallback = fallbackDecision(doc.deliveryOperationId, reason, 'gateway', resolvedAt);
        break;
      }
      case STATE.FAILED:
      case STATE.TIMEOUT:
        doc.state = view.state;
        doc.resolvedAtMs = resolvedAt;
        break;
      default:
        break; // queued: nothing decided yet
    }
    if (AFTER_WHATSAPP.has(doc.state) && view.lateDelivery) {
      doc.lateDelivery = { atMs: finiteMs(view.lateDelivery.at) || now, whatsappStatus: view.lateDelivery.whatsappStatus || doc.whatsappStatus };
    }
  } else if (AFTER_WHATSAPP.has(doc.state) && receiptSeen) {
    // Resolved here first (fallback by gateway/server/app, SMS outcome): WhatsApp arrived late. No re-send.
    doc.lateDelivery = {
      atMs: doc.lateDelivery?.atMs || finiteMs(view.lateDelivery?.at) || ms('deliveredAt') || now,
      whatsappStatus: doc.whatsappStatus,
    };
  }
  return { doc: finish(doc, now), changed: true };
}

/**
 * Backup resolution (§6.3) for an operation Railway did not resolve in time.
 * Call only after Railway was asked and answered `unknown` or did not answer.
 * @returns {object|null} new doc, or null when nothing is due.
 */
export function resolveSilent(stored, now) {
  if (!stored) return null;
  const doc = structuredClone(stored);
  if (doc.state === STATE.WAITING) {
    const deadline = doc.receiptDeadlineAtMs || ((doc.acceptedAtMs || doc.createdAtMs) + 10_000);
    if (now <= deadline + SILENT_GRACE_MS) return null;
  } else if (doc.state === STATE.QUEUED) {
    if (now <= doc.createdAtMs + QUEUED_STALE_MS) return null;
  } else {
    return null;
  }
  if (doc.smsFallback) {
    doc.state = STATE.FALLBACK;
    doc.fallback = fallbackDecision(doc.deliveryOperationId, 'gateway_silent_after_deadline', 'server', now);
  } else {
    doc.state = doc.acceptedAtMs ? STATE.TIMEOUT : STATE.FAILED;
    doc.lastError = doc.lastError || 'gateway_silent_after_deadline';
  }
  doc.resolvedAtMs = now;
  return finish(doc, now);
}

/** True when the record needs the §6.3 check (ask Railway, then resolveSilent). */
export function needsReconcile(doc, now) {
  if (!doc) return false;
  if (doc.state === STATE.WAITING) {
    const deadline = doc.receiptDeadlineAtMs || ((doc.acceptedAtMs || doc.createdAtMs) + 10_000);
    return now > deadline + SILENT_GRACE_MS;
  }
  return doc.state === STATE.QUEUED && now > doc.createdAtMs + QUEUED_STALE_MS;
}

/** POST /api/whatsapp/deliveries/sms-result body (§6.4). */
export function parseSmsResult(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' };
  const id = typeof body.deliveryOperationId === 'string' ? body.deliveryOperationId.trim() : '';
  if (!isValidDeliveryId(id)) return { ok: false, error: 'invalid_delivery_operation_id' };
  if (body.commandId !== undefined && body.commandId !== null && body.commandId !== `${id}:sms`) {
    return { ok: false, error: 'invalid_command_id' };
  }
  if (!Number.isSafeInteger(body.attempt) || body.attempt < 1 || body.attempt > 1000) return { ok: false, error: 'invalid_attempt' };
  if (!['sent', 'failed', 'abandoned'].includes(body.outcome)) return { ok: false, error: 'invalid_outcome' };
  const at = finiteMs(body.at);
  if (!at || at > now + MAX_FUTURE_SKEW_MS) return { ok: false, error: 'invalid_at' };
  if (body.reason !== undefined && body.reason !== null && !isValidFallbackReason(body.reason)) {
    return { ok: false, error: 'invalid_reason' };
  }
  if (body.error !== undefined && body.error !== null && typeof body.error !== 'string') return { ok: false, error: 'invalid_error' };
  const refs = parseRefs(body);
  if (!refs.ok) return refs;
  let to = null;
  if (body.to !== undefined && body.to !== null && body.to !== '') {
    to = normalizeRecipient(body.to);
    if (!to) return { ok: false, error: 'invalid_recipient' };
  }
  return {
    ok: true,
    value: {
      id,
      attempt: body.attempt,
      outcome: body.outcome,
      at,
      error: body.outcome === 'sent' ? null : cleanError(body.error),
      reason: body.reason ?? null,
      refs: refs.value,
      to,
    },
  };
}

/**
 * Applies an app SMS report. Idempotent on (deliveryOperationId, attempt).
 * @returns {{ ok: true, doc, duplicate: boolean, applied: boolean } | { ok: false, status, error }}
 */
export function applySmsResult(stored, report, now, { networkId } = {}) {
  let doc;
  if (!stored) {
    if (!report.refs.cardRef && !report.refs.saleRef && !report.to) return { ok: false, status: 404, error: 'delivery_not_found' };
    doc = newDeliveryDoc({ networkId, id: report.id, to: report.to, refs: report.refs, smsFallback: true, now: Math.min(report.at, now) });
    doc.state = STATE.FALLBACK;
    doc.resolvedAtMs = Math.min(report.at, now);
    doc.fallback = fallbackDecision(report.id, report.reason || 'whatsapp_unreachable', 'app', doc.resolvedAtMs);
  } else {
    doc = structuredClone(stored);
  }

  // Same card or nothing: fallback with another card is refused (§6.4).
  if ((doc.cardRef ?? null) !== (report.refs.cardRef ?? null)) return { ok: false, status: 409, error: 'card_mismatch' };

  const key = String(report.attempt);
  const previous = doc.smsReports?.[key];
  if (previous) {
    if (previous.outcome !== report.outcome) return { ok: false, status: 409, error: 'sms_attempt_conflict' };
    return { ok: true, doc: stored, duplicate: true, applied: false };
  }
  doc.smsReports = { ...(doc.smsReports || {}), [key]: { outcome: report.outcome, atMs: report.at, error: report.error, receivedAtMs: now } };
  const sms = { ...doc.sms };
  if (report.outcome !== 'abandoned') {
    sms.attempts = Math.max(sms.attempts || 0, report.attempt);
    sms.lastAttemptAtMs = Math.max(sms.lastAttemptAtMs || 0, report.at);
    if (report.outcome === 'sent') { sms.sentAtMs = sms.sentAtMs || report.at; sms.lastError = null; }
    else sms.lastError = report.error || 'sms_failed';
  }
  doc.sms = sms;

  let applied = true;
  if (doc.state === STATE.DELIVERED) {
    // WhatsApp already confirmed: record, never hide, never change the state.
    doc.smsAfterDelivered = doc.smsAfterDelivered || { atMs: report.at, attempt: report.attempt, outcome: report.outcome };
    applied = false;
  } else {
    if (OPEN.has(doc.state)) {
      // App decided offline (§6.4/§7.7): one transaction waiting -> requested -> sent|failed.
      doc.state = STATE.FALLBACK;
      doc.resolvedAtMs = doc.resolvedAtMs || report.at;
      doc.fallback = fallbackDecision(doc.deliveryOperationId, report.reason || 'app_offline_deadline', 'app', report.at);
    }
    if (doc.state === STATE.FALLBACK || doc.state === STATE.SMS_FAILED) {
      if (report.outcome === 'sent') doc.state = STATE.SMS_SENT;
      else if (report.outcome === 'failed') doc.state = STATE.SMS_FAILED;
      else doc.state = STATE.FAILED;
    } else {
      // sms_fallback_sent | failed | delivery_timeout are final: keep as information (§3).
      applied = false;
    }
  }
  return { ok: true, doc: finish(doc, now), duplicate: false, applied };
}

/** Public DeliveryView (§6.5): internal bookkeeping (smsReports) is not exposed. */
export function toDeliveryView(doc) {
  if (!doc) return null;
  const { smsReports: _reports, legacy: _legacy, ...view } = doc;
  return view;
}
