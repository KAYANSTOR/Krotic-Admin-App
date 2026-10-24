import { countReads } from './readMeter.js';
import { emitSyncEvent } from './syncEvents.js';

/**
 * نواة المزامنة مستقلة تماماً عن Firebase و IndexedDB، حتى يمكن اختبارها
 * ببدائل في الذاكرة. محركFirebase (syncEngine.js) هو من يمرّر الدوال الفعلية.
 */

/** يطبّق شواهد الحذف على القاعدة المحلية (حذف بدل كتابة). */
export async function applyTombstones(localDb, rows) {
  for (const t of rows) {
    if (t.collection === 'sales' && t.networkId && t.id) await localDb.sales.delete([t.networkId, t.id]);
    else if (t.collection === 'payments' && t.networkId && t.id) await localDb.payments.delete([t.networkId, t.id]);
    else if (t.collection === 'users' && t.id) await localDb.users.delete(t.id);
    else if (t.collection === 'networks' && t.id) await localDb.networks.delete(t.id);
    else if (t.collection === 'admin_aggregates' && t.id) await localDb.aggregates.delete(t.id);
    else if (t.collection === 'admin_audit_logs' && t.id) await localDb.audit_logs.delete(t.id);
    else if (t.collection === 'notification_deliveries' && t.id) await localDb.notifications.delete(t.id);
    else if (t.collection === 'Admins' && t.id) await localDb.admins.delete(t.id);
    else if (t.collection === 'app_settings' && t.id) await localDb.settings.delete(t.id);
  }
}

/** يكتب الصفوف في جدولها. bulkPut idempotent: إعادة كتابة نفس الوثيقة آمنة. */
export async function applyRows(localDb, src, rows) {
  if (src.key === 'tombstones') {
    await applyTombstones(localDb, rows);
    return;
  }
  await localDb.table(src.table).bulkPut(rows);
}

/**
 * يزامن مصدراً واحداً: فحص ثم تنزيل تزايدي ثم تحريك المؤشر.
 * latestMs و pullSince يحسبهما المستدعي (محرك Firebase أو الاختبار).
 */
export async function syncSource(localDb, src, { latestMs, pullSince }) {
  const state = (await localDb.sync_state.get(src.key)) || { key: src.key, cursorMs: 0 };
  const latest = await latestMs(src); // قراءة واحدة
  // لا توجد أي وثيقة تحمل updatedAtMs (المجموعة فارغة أو لم تُرحَّل بعد).
  // استعلام السحب لن يعيد شيئًا، لذا نتخطاه ونبقي المؤشر كما هو حتى تظهر
  // بيانات فعلية (بما فيها الوثائق التي يُعطيها الترحيل updatedAtMs = 1).
  if (latest === 0) return { key: src.key, changed: 0 };
  if (state.cursorMs > 0 && latest <= state.cursorMs) {
    return { key: src.key, changed: 0 }; // لا شيء جديد
  }
  let changed = 0;
  const nextCursor = await pullSince(src, state.cursorMs, async (rows) => {
    await applyRows(localDb, src, rows);
    changed += rows.length;
  });
  // المؤشر يتحرك بعد نجاح الكتابة فقط
  await localDb.sync_state.put({ key: src.key, cursorMs: nextCursor, syncedAt: Date.now() });
  if (changed > 0) emitSyncEvent({ type: 'rows', key: src.key, changed });
  return { key: src.key, changed };
}

/**
 * يدير المزامنة الكاملة لكل المصادر مع منع التزامن المتكرر.
 * reason = 'manual' يتجاوز فاصل التلقائي (دقيقة).
 */
export function createSyncController({ minAutoIntervalMs = 60_000, now = () => Date.now() } = {}) {
  let inFlight = null;
  let lastFinishedAt = 0;
  let ctx = {};

  async function runAll(localDb, sources, { reason = 'auto' } = {}) {
    if (!localDb) return null;
    if (inFlight) return inFlight;
    if (reason !== 'manual' && now() - lastFinishedAt < minAutoIntervalMs) {
      return null;
    }
    inFlight = (async () => {
      const results = [];
      for (const src of sources) results.push(await syncSource(localDb, src, ctx));
      await localDb.meta.put({ key: 'lastSyncAt', value: now(), reason });
      emitSyncEvent({ type: 'done', reason, results });
      return results;
    })().finally(() => {
      lastFinishedAt = now();
      inFlight = null;
    });
    return inFlight;
  }

  return {
    /** يسجّل الدوال المستخدمة داخل المزامنة (latestMs و pullSince). */
    configure(next) { ctx = { ...ctx, ...next }; },
    run: runAll,
    isRunning: () => inFlight !== null,
  };
}

export { countReads };
