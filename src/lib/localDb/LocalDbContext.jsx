import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { createAdminDb, deleteAdminDb } from './db';
import { useAutoSync } from './useAutoSync';
import { syncAll } from './syncEngine';

const LocalDbContext = createContext(null);

/**
 * ينشئ قاعدة IndexedDB خاصة بالمدير الحالي، ويمسحها بالكامل عند تسجيل الخروج.
 * البيانات الإدارية لا تبقى على الجهاز بعد الخروج.
 */
export function LocalDbProvider({ children }) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || null;
  const [localDb, setLocalDb] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);

  useEffect(() => {
    if (!uid) {
      setLocalDb(null);
      setLastSyncAt(null);
      return undefined;
    }
    let db = null;
    try {
      db = createAdminDb(uid);
    } catch (error) {
      console.warn('Local database unavailable:', error);
      setLocalDb(null);
      return undefined;
    }
    setLocalDb(db);
    return () => {
      db.close();
    };
  }, [uid]);

  // المزامنة التلقائية: الدخول، عودة التبويب، عودة الإنترنت.
  useAutoSync(localDb, { enabled: Boolean(localDb) });

  // تحديث وقت آخر مزامنة ناجحة لعرضه في الواجهة.
  useEffect(() => {
    if (!localDb) return undefined;
    let active = true;
    const read = async () => {
      const meta = await localDb.meta.get('lastSyncAt');
      if (active) setLastSyncAt(meta?.value ?? null);
    };
    read();
    const timer = setInterval(read, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [localDb]);

  const value = useMemo(() => ({
    localDb,
    uid,
    syncing,
    setSyncing,
    lastSyncAt,
    /** مزامنة يدوية: تتجاوز فاصل الدقيقة وتعمل كمزامنة كاملة. */
    async runSync({ reason = 'manual' } = {}) {
      if (!localDb) return null;
      setSyncing(true);
      try {
        const result = await syncAll(localDb, { reason });
        const meta = await localDb.meta.get('lastSyncAt');
        setLastSyncAt(meta?.value ?? null);
        return result;
      } finally {
        setSyncing(false);
      }
    },
  }), [localDb, uid, syncing, lastSyncAt]);

  return <LocalDbContext.Provider value={value}>{children}</LocalDbContext.Provider>;
}

export function useLocalDb() {
  return useContext(LocalDbContext);
}

/** يُستدعى عند تسجيل الخروج لحذف قاعدة المدير من الجهاز. */
export async function purgeLocalDb(uid) {
  if (!uid) return false;
  return deleteAdminDb(uid);
}

export default LocalDbProvider;
