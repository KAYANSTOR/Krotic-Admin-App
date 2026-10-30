/**
 * Durable Firestore delivery queue (no Cloud Tasks / no paid GCP).
 *
 * Collection: whatsapp_delivery_queue/{jobId}
 * jobId is deterministic: same as deliveryOperationId when tied to a sale,
 * or explicit id for maintenance jobs.
 *
 * States: queued → processing → completed | failed
 * Lock: lockOwner + lockUntilMs — expired locks are reclaimable.
 *
 * Does NOT guarantee exact 10s latency by itself; pairs with deadline fields
 * on delivery operations and a recovery dispatcher.
 */

export const QUEUE_COLLECTION = 'whatsapp_delivery_queue';
export const QUEUE_STATUSES = Object.freeze(['queued', 'processing', 'completed', 'failed']);
export const DEFAULT_LOCK_MS = 30_000;

/**
 * Atomically enqueue a job. create() prevents duplicates for same jobId.
 */
export async function enqueueDeliveryJob(db, {
  jobId,
  deliveryOperationId,
  networkId,
  kind = 'deadline_check',
  runAfterMs = Date.now(),
  now = Date.now(),
  payload = {},
}) {
  if (typeof jobId !== 'string' || jobId.length < 4) {
    return { ok: false, error: 'job_id_invalid' };
  }
  const ref = db.collection(QUEUE_COLLECTION).doc(jobId);
  const data = {
    jobId,
    deliveryOperationId: deliveryOperationId || jobId,
    networkId: networkId || null,
    kind,
    status: 'queued',
    runAfterMs: Number.isSafeInteger(runAfterMs) ? runAfterMs : now,
    attempts: 0,
    lockOwner: null,
    lockUntilMs: null,
    lastError: null,
    payload: payload && typeof payload === 'object' ? payload : {},
    createdAtMs: now,
    updatedAtMs: now,
  };
  try {
    await ref.create(data);
    return { ok: true, jobId, duplicate: false, data };
  } catch (error) {
    if (error?.code === 6 || error?.code === 'already-exists' || /already exists/i.test(String(error?.message || ''))) {
      const existing = await ref.get();
      return {
        ok: true,
        jobId,
        duplicate: true,
        data: existing.exists ? existing.data() : null,
      };
    }
    throw error;
  }
}

/**
 * Claim next eligible job with lock. Uses transaction when available.
 */
export async function claimNextJob(db, {
  workerId,
  now = Date.now(),
  lockMs = DEFAULT_LOCK_MS,
} = {}) {
  if (!workerId) return { ok: false, error: 'worker_id_required' };

  const candidates = [];
  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (path.startsWith(`${QUEUE_COLLECTION}/`) && data) {
        candidates.push({ id: path.slice(QUEUE_COLLECTION.length + 1), data });
      }
    }
  }

  candidates.sort((a, b) => (a.data.runAfterMs || 0) - (b.data.runAfterMs || 0));

  for (const item of candidates) {
    const { id, data } = item;
    const eligibleStatus = data.status === 'queued'
      || (data.status === 'processing' && Number(data.lockUntilMs) > 0 && data.lockUntilMs <= now);
    if (!eligibleStatus) continue;
    if (Number.isSafeInteger(data.runAfterMs) && data.runAfterMs > now) continue;

    const ref = db.collection(QUEUE_COLLECTION).doc(id);
    const next = {
      ...data,
      status: 'processing',
      lockOwner: workerId,
      lockUntilMs: now + lockMs,
      attempts: (Number(data.attempts) || 0) + 1,
      updatedAtMs: now,
    };

    if (typeof db.runTransaction === 'function') {
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const cur = snap.data() || {};
        const stillEligible = cur.status === 'queued'
          || (cur.status === 'processing' && Number(cur.lockUntilMs) > 0 && cur.lockUntilMs <= now);
        if (!stillEligible) return null;
        if (Number.isSafeInteger(cur.runAfterMs) && cur.runAfterMs > now) return null;
        const locked = {
          ...cur,
          status: 'processing',
          lockOwner: workerId,
          lockUntilMs: now + lockMs,
          attempts: (Number(cur.attempts) || 0) + 1,
          updatedAtMs: now,
        };
        tx.set(ref, locked, { merge: false });
        return locked;
      });
      if (claimed) return { ok: true, jobId: id, data: claimed };
      continue;
    }

    await ref.set(next, { merge: false });
    return { ok: true, jobId: id, data: next };
  }

  return { ok: true, jobId: null, data: null };
}

export async function completeJob(db, jobId, { now = Date.now(), result = null } = {}) {
  const ref = db.collection(QUEUE_COLLECTION).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'job_not_found' };
  const cur = snap.data() || {};
  await ref.set({
    ...cur,
    status: 'completed',
    lockOwner: null,
    lockUntilMs: null,
    result: result ?? null,
    updatedAtMs: now,
    completedAtMs: now,
  }, { merge: false });
  return { ok: true };
}

export async function failJob(db, jobId, { now = Date.now(), error = 'failed', requeue = false, runAfterMs = null } = {}) {
  const ref = db.collection(QUEUE_COLLECTION).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'job_not_found' };
  const cur = snap.data() || {};
  const next = {
    ...cur,
    lastError: String(error).slice(0, 200),
    lockOwner: null,
    lockUntilMs: null,
    updatedAtMs: now,
  };
  if (requeue) {
    next.status = 'queued';
    next.runAfterMs = Number.isSafeInteger(runAfterMs) ? runAfterMs : now;
  } else {
    next.status = 'failed';
  }
  await ref.set(next, { merge: false });
  return { ok: true, data: next };
}
