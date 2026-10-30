/**
 * SMS provider boundary for WhatsApp fallback.
 *
 * REAL send is NOT wired. This module defines:
 *  - stable idempotency key = deliveryOperationId (networkId + saleUuid)
 *  - crash-phase state machine around external call
 *  - reconciliation when outcome is unknown
 *
 * Provider support:
 *  - If provider accepts Idempotency-Key / client-ref: pass buildSmsIdempotencyKey()
 *  - If provider does NOT support idempotency: after ambiguous outcome we MUST NOT
 *    auto-resend; mark smsOutcomeUnknown and require manual/reconcile path.
 *
 * Guarantees we CANNOT make without provider support:
 *  - Exactly-once delivery at the carrier is impossible if the provider has no
 *    idempotency and the process dies after accept-before-persist.
 *  - At-most-once is what we enforce in our DB (no second outbound attempt when
 *    smsProviderAcceptedAtMs or smsOutcomeUnknown is set).
 */

export const SMS_OUTCOME = Object.freeze({
  NOT_ATTEMPTED: 'not_attempted',
  REQUEST_STARTED: 'request_started',
  PROVIDER_ACCEPTED: 'provider_accepted',
  PROVIDER_REJECTED: 'provider_rejected',
  OUTCOME_UNKNOWN: 'outcome_unknown',
  PERSISTED: 'persisted',
});

/** Fixed external identity for one sale delivery — never random. */
export function buildSmsIdempotencyKey(deliveryOperationId) {
  if (typeof deliveryOperationId !== 'string' || deliveryOperationId.length < 8) {
    return { ok: false, error: 'delivery_id_invalid' };
  }
  // Providers often limit length; keep stable prefix
  const key = `krotak-wa-sms:${deliveryOperationId}`.slice(0, 64);
  return { ok: true, key };
}

/**
 * Decide next action after a crash given persisted fields.
 */
export function reconcileSmsAfterCrash(op) {
  if (!op) return { action: 'abort', reason: 'missing_op' };
  if (op.smsFallbackSentAtMs != null || op.status === 'sms_sent') {
    return { action: 'noop', reason: 'already_persisted' };
  }
  if (op.smsProviderAcceptedAtMs != null) {
    return { action: 'complete_only', reason: 'provider_accepted_unpersisted' };
  }
  if (op.smsOutcomeUnknown === true) {
    return {
      action: 'manual_review',
      reason: 'ambiguous_provider_outcome',
      note: 'Do not auto-resend; provider may have accepted without our record',
    };
  }
  if (op.smsRequestStartedAtMs != null && op.smsProviderAcceptedAtMs == null) {
    // Died during/after request without accept flag
    return {
      action: 'manual_review',
      reason: 'request_started_no_accept',
      note: 'Ambiguous: may or may not have reached provider',
    };
  }
  // Claimed but never called provider
  if (op.smsClaimOwner && op.smsFallbackSentAtMs == null) {
    return { action: 'retry_send', reason: 'claimed_before_request' };
  }
  return { action: 'retry_send', reason: 'not_attempted' };
}

/**
 * Simulated provider adapter for tests. Real HTTP must inject dependencies.sendSms.
 * @param {{ idempotencyKey: string, to?: string, body?: string }} req
 */
export async function callSmsProvider(req, dependencies = {}) {
  if (typeof dependencies.sendSms === 'function') {
    return dependencies.sendSms(req);
  }
  // Default: not configured — never invent a live send
  return {
    ok: false,
    error: 'sms_provider_not_configured',
    idempotencyKey: req.idempotencyKey,
  };
}

/**
 * Full pipeline with explicit phases for crash testing.
 * Phases: claim → mark request_started → provider call → mark accepted → persist sms_sent.
 *
 * @param {object} hooks optional crash injection: throwAfter = 'claim'|'request_started'|'provider_accepted'
 */
export async function executeSmsFallbackPipeline(db, deliveryOperationId, {
  workerId,
  now = Date.now(),
  claimSmsFallbackSlot,
  markSmsProviderAccepted,
  completeSmsFallback,
  callProvider = callSmsProvider,
  throwAfter = null,
  providerDeps = {},
} = {}) {
  const claim = await claimSmsFallbackSlot(db, deliveryOperationId, { workerId, now });
  if (!claim.ok) return claim;
  if (claim.alreadySent) return { ok: false, error: 'sms_already_sent', phase: 'pre_claim' };
  if (!claim.claimed) return { ok: false, error: claim.reason || 'sms_not_claimed', phase: 'pre_claim' };

  if (claim.completeOnly) {
    const done = await completeSmsFallback(db, deliveryOperationId, now);
    return { ...done, phase: 'complete_after_crash' };
  }

  if (throwAfter === 'claim') {
    const err = new Error('injected_crash_after_claim');
    err.phase = 'claim';
    throw err;
  }

  // Phase: request started (before network I/O)
  const ref = db.collection('whatsapp_delivery_operations').doc(deliveryOperationId);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data() : {};
  await ref.set({
    ...cur,
    smsRequestStartedAtMs: now,
    smsIdempotencyKey: buildSmsIdempotencyKey(deliveryOperationId).key,
    updatedAtMs: now,
  }, { merge: false });

  if (throwAfter === 'request_started') {
    const err = new Error('injected_crash_after_request_started');
    err.phase = 'request_started';
    throw err;
  }

  const idemp = buildSmsIdempotencyKey(deliveryOperationId);
  const providerResult = await callProvider({
    idempotencyKey: idemp.key,
    deliveryOperationId,
  }, providerDeps);

  if (!providerResult.ok) {
    if (providerResult.error === 'sms_provider_not_configured') {
      // Dev/test path without provider: treat as accepted simulation only when explicitly allowed
      if (providerDeps.simulateAccept === true) {
        // fall through
      } else {
        return { ok: false, error: 'sms_provider_not_configured', phase: 'provider_call' };
      }
    } else {
      return { ok: false, error: providerResult.error || 'provider_rejected', phase: 'provider_call' };
    }
  }

  await markSmsProviderAccepted(db, deliveryOperationId, now);

  if (throwAfter === 'provider_accepted') {
    const err = new Error('injected_crash_after_provider_accepted');
    err.phase = 'provider_accepted';
    throw err;
  }

  const completed = await completeSmsFallback(db, deliveryOperationId, now);
  if (throwAfter === 'persisted') {
    const err = new Error('injected_crash_after_persisted');
    err.phase = 'persisted';
    throw err;
  }
  return { ...completed, phase: 'persisted', idempotencyKey: idemp.key };
}

/** Mark ambiguous outcome — blocks auto resend. */
export async function markSmsOutcomeUnknown(db, deliveryOperationId, now = Date.now(), reason = 'ambiguous') {
  const ref = db.collection('whatsapp_delivery_operations').doc(deliveryOperationId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'delivery_not_found' };
  const cur = snap.data() || {};
  if (cur.smsFallbackSentAtMs != null) return { ok: true, data: cur };
  await ref.set({
    ...cur,
    smsOutcomeUnknown: true,
    smsOutcomeUnknownReason: String(reason).slice(0, 120),
    smsOutcomeUnknownAtMs: now,
    updatedAtMs: now,
  }, { merge: false });
  return { ok: true };
}
