/**
 * WhatsApp data retention policy and purge helpers.
 *
 * Policy (owner-approved):
 *   - Message text: max 72 hours → clear text fields only
 *   - Event record (non-sensitive): 90 days → delete document
 *   - Raw webhook body: never stored
 *
 * Periodic execution requires Cloud Scheduler (or equivalent) calling the
 * retention purge endpoint with DISPATCH_SERVICE_SECRET. This module does NOT
 * claim that scheduling is active until that infrastructure is wired.
 *
 * Firestore TTL: optional future optimization on eventExpiresAtMs — not enabled
 * here; purge is explicit Admin SDK deletes/updates so text can be cleared
 * without deleting the parent event early.
 */

export const TEXT_RETENTION_MS = 72 * 60 * 60 * 1000;
export const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const INBOUND_EVENTS_COLLECTION = 'whatsapp_inbound_events';

export function computeTextRetentionUntilMs(now = Date.now()) {
  return now + TEXT_RETENTION_MS;
}

export function computeEventExpiresAtMs(now = Date.now()) {
  return now + EVENT_RETENTION_MS;
}

/** Whether message text must be cleared (event document kept). */
export function shouldPurgeText(event, now = Date.now()) {
  if (!event || event.text == null) return false;
  const until = event.textRetentionUntilMs;
  if (!Number.isSafeInteger(until)) return false;
  return now >= until;
}

/** Whether the entire event document should be deleted. */
export function shouldDeleteEvent(event, now = Date.now()) {
  if (!event) return false;
  const expires = event.eventExpiresAtMs;
  if (Number.isSafeInteger(expires)) return now >= expires;
  // Fallback for older docs without eventExpiresAtMs: receivedAtMs + 90d
  if (Number.isSafeInteger(event.receivedAtMs)) {
    return now >= event.receivedAtMs + EVENT_RETENTION_MS;
  }
  return false;
}

/**
 * Apply retention to one event document.
 * Order: delete whole event if expired; else clear text if text expired.
 * Never deletes the event solely because text expired.
 *
 * @returns {Promise<{ action: 'deleted' | 'text_purged' | 'noop', docId: string }>}
 */
export async function applyRetentionToEvent(db, docId, event, now = Date.now()) {
  const ref = db.collection(INBOUND_EVENTS_COLLECTION).doc(docId);

  if (shouldDeleteEvent(event, now)) {
    await ref.delete();
    return { action: 'deleted', docId };
  }

  if (shouldPurgeText(event, now)) {
    await ref.set({
      ...event,
      text: null,
      textRetentionUntilMs: null,
      textPurgedAtMs: now,
      updatedAtMs: now,
    }, { merge: false });
    return { action: 'text_purged', docId };
  }

  return { action: 'noop', docId };
}

/**
 * Scan candidates from an in-memory store or provided list and apply retention.
 * Production path should query by textRetentionUntilMs / eventExpiresAtMs indexes.
 */
export async function runRetentionPass(db, { now = Date.now(), limit = 100 } = {}) {
  const candidates = [];

  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith(`${INBOUND_EVENTS_COLLECTION}/`)) {
        candidates.push({
          docId: path.slice(INBOUND_EVENTS_COLLECTION.length + 1),
          data,
        });
      }
    }
  }

  let deleted = 0;
  let textPurged = 0;
  let noop = 0;
  let processed = 0;

  for (const item of candidates.slice(0, limit)) {
    processed += 1;
    const result = await applyRetentionToEvent(db, item.docId, item.data, now);
    if (result.action === 'deleted') deleted += 1;
    else if (result.action === 'text_purged') textPurged += 1;
    else noop += 1;
  }

  return {
    processed,
    deleted,
    textPurged,
    noop,
    schedulingActive: false,
    note: 'Purge logic only — Cloud Scheduler not wired; periodic deletion is not active in production until approved',
  };
}

export function retentionPolicySummary() {
  return {
    textRetentionHours: 72,
    eventRetentionDays: 90,
    rawWebhookBody: 'never_stored',
    textPurge: 'clears text + textRetentionUntilMs; keeps event document',
    eventDelete: 'deletes document after eventExpiresAtMs',
    firestoreTtl: 'not_enabled — explicit purge preferred so text can expire independently',
    schedulerRequired: 'Cloud Scheduler → POST /api/whatsapp/retention/purge with service secret',
    schedulerStatus: 'not_wired',
  };
}
