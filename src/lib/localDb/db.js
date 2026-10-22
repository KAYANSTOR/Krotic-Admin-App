import Dexie from 'dexie';

export const SCHEMA_VERSION = 1;

/** اسم القاعدة المحلية لكل مدير: البيانات لا تختلط بين مديرين على نفس الجهاز. */
export function dbNameFor(uid) {
  return `krotak-admin-v${SCHEMA_VERSION}-${uid}`;
}

/**
 * تعريف الجداول والفهارس.
 * - sales و payments بمفتاح مركب [networkId+id] حتى لا تتداخل مبيعات شبكتين بنفس المعرّف.
 * - sync_state يحمل مؤشر كل مجموعة (cursorMs).
 */
export function createAdminDb(uid, { DexieCtor = Dexie } = {}) {
  const db = new DexieCtor(dbNameFor(uid));
  db.version(SCHEMA_VERSION).stores({
    users: 'uid, networkId, updatedAtMs',
    networks: 'networkId, owner_uid, updatedAtMs',
    sales: '[networkId+id], networkId, createdAtMs, updatedAtMs, status',
    payments: '[networkId+id], networkId, updatedAtMs',
    aggregates: 'uid, updatedAtMs',
    audit_logs: 'id, updatedAtMs',
    notifications: 'id, updatedAtMs',
    admins: 'id, updatedAtMs',
    settings: 'key',
    sync_state: 'key',
    meta: 'key',
  });
  return db;
}

/** يحذف قاعدة المدير بالكامل (يُستدعى عند تسجيل الخروج). */
export async function deleteAdminDb(uid) {
  const name = dbNameFor(uid);
  try {
    await Dexie.delete(name);
    return true;
  } catch (error) {
    console.warn('Failed to delete local admin database:', error);
    return false;
  }
}
