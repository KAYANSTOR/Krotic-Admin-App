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

/** يعيد مؤشرات الحسابات والشبكات والمبيعات والدفعات مرة واحدة عند التحديث اليدوي. */
export async function resetLegacyDataCursorsOnce(localDb) {
  if (!localDb) return false;
  const key = 'legacy-data-path-reset-v2';
  const marker = await localDb.meta.get(key);
  if (marker?.value === 1) return false;
  for (const sourceKey of ['users', 'networks', 'sales', 'payments']) {
    const state = await localDb.sync_state.get(sourceKey);
    if (state && Number(state.cursorMs) > 0) {
      await localDb.sync_state.put({ ...state, cursorMs: 0, legacyPathResetAt: Date.now() });
    }
  }
  await localDb.meta.put({ key, value: 1, resetAt: Date.now() });
  return true;
}

/**
 * يستورد محلياً الوثائق التي لا تحمل updatedAtMs دون تعديل Firestore.
 * لا يعيد المسح الكامل إلا في أول مرة أو عندما يتغير عدد وثائق المصدر.
 */
export async function importUnindexedRowsWhenCountChanges(localDb, sources, { getRemoteCount, scanAll, now = () => Date.now() } = {}) {
  if (!localDb || typeof getRemoteCount !== 'function' || typeof scanAll !== 'function') {
    return { scannedDocuments: 0, importedRows: 0, scannedSources: 0 };
  }
  let scannedDocuments = 0;
  let importedRows = 0;
  let scannedSources = 0;

  for (const src of sources) {
    const remoteCount = Number(await getRemoteCount(src));
    if (!Number.isSafeInteger(remoteCount) || remoteCount < 0) throw new TypeError(`remote_count_invalid:${src.key}`);
    const markerKey = `legacy-unindexed-count:${src.key}`;
    const marker = await localDb.meta.get(markerKey);
    if (marker && Number(marker.remoteCount) === remoteCount) continue;

    const importedBefore = importedRows;
    await scanAll(src, async (rows) => {
      scannedDocuments += rows.length;
      const missingTimestamp = rows.filter((row) => {
        const updatedAtMs = Number(row?.updatedAtMs);
        return !Number.isFinite(updatedAtMs) || updatedAtMs <= 0;
      });
      if (!missingTimestamp.length) return;
      await localDb.table(src.table).bulkPut(missingTimestamp);
      importedRows += missingTimestamp.length;
    });
    await localDb.meta.put({ key: markerKey, remoteCount, scannedAt: now(), imported: importedRows - importedBefore });
    scannedSources += 1;
  }

  if (importedRows > 0) emitSyncEvent({ type: 'rows', key: 'legacy_unindexed', changed: importedRows });
  return { scannedDocuments, importedRows, scannedSources };
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
