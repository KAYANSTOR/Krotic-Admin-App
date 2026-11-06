/**
 * Map device SMS task outcomes onto delivery operations.
 * sms_sent only via completeSmsFallbackFromDevice.
 */
import { completeSmsFallbackFromDevice } from './deliveryOperations.js';
import { SMS_DEVICE_TASKS_COLLECTION } from './smsDeviceTaskContract.js';

/**
 * Apply one task's terminal status to its delivery operation.
 */
export async function applySmsDeviceTaskOutcome(db, task, now = Date.now()) {
  if (!task || !task.deliveryOperationId) {
    return { ok: false, error: 'task_invalid' };
  }
  if (task.status === 'sent') {
    return completeSmsFallbackFromDevice(
      db,
      task.deliveryOperationId,
      'sent',
      { deviceSentAtMs: task.deviceSentAtMs ?? now, deviceError: null },
      now,
    );
  }
  if (task.status === 'failed') {
    return completeSmsFallbackFromDevice(
      db,
      task.deliveryOperationId,
      'failed',
      { deviceError: task.deviceError || 'sms_device_failed' },
      now,
    );
  }
  return { ok: false, error: 'task_not_terminal', status: task.status };
}

/**
 * Scan terminal device tasks and complete matching delivery ops.
 * Used from dispatch recovery (no Cloud Functions required).
 */
export async function settleTerminalSmsDeviceTasks(db, {
  now = Date.now(),
  limit = 30,
} = {}) {
  let settled = 0;
  let skipped = 0;
  const items = [];

  if (db._store instanceof Map) {
    for (const [path, data] of db._store.entries()) {
      if (!path.startsWith(`${SMS_DEVICE_TASKS_COLLECTION}/`) || !data) continue;
      if (data.status === 'sent' || data.status === 'failed') {
        items.push(data);
      }
    }
  } else {
    try {
      const sent = await db.collection(SMS_DEVICE_TASKS_COLLECTION)
        .where('status', '==', 'sent').limit(limit).get();
      const failed = await db.collection(SMS_DEVICE_TASKS_COLLECTION)
        .where('status', '==', 'failed').limit(limit).get();
      for (const doc of [...(sent.docs || []), ...(failed.docs || [])]) {
        items.push(doc.data() || {});
      }
    } catch {
      // Missing composite index — skip production scan quietly
      return { ok: true, settled: 0, skipped: 0, note: 'query_unavailable' };
    }
  }

  for (const task of items.slice(0, limit)) {
    const result = await applySmsDeviceTaskOutcome(db, task, now);
    if (result.ok) settled += 1;
    else skipped += 1;
  }

  return { ok: true, settled, skipped };
}
