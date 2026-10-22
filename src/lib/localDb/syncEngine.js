import {
  collection, collectionGroup, getDocs, limit, orderBy, query, startAfter, where,
} from 'firebase/firestore';
import { db as firestore } from '../../firebase';
import { plain } from './plain';
import { countReads } from './readMeter';
import { applyRows, applyTombstones, syncSource, createSyncController } from './syncCore';

const PAGE_SIZE = 300;
const MIN_AUTO_INTERVAL_MS = 60_000;

/**
 * كل مصدر: مجموعة على السيرفر + جدول محلي + طريقة تحويل الوثيقة.
 * map تحوّل Timestamp إلى أرقام ملّي ثانية عبر plain().
 */
export const SOURCES = [
  {
    key: 'users',
    table: 'users',
    ref: () => collection(firestore, 'users'),
    map: (d) => ({ ...plain(d.data()), uid: d.id }),
  },
  {
    key: 'networks',
    table: 'networks',
    ref: () => collection(firestore, 'networks'),
    map: (d) => ({ ...plain(d.data()), networkId: d.id }),
  },
  {
    key: 'sales',
    table: 'sales',
    ref: () => collectionGroup(firestore, 'sales'),
    map: (d) => ({ ...plain(d.data()), networkId: d.ref.parent.parent.id, id: d.id }),
  },
  {
    key: 'payments',
    table: 'payments',
    ref: () => collectionGroup(firestore, 'payments'),
    map: (d) => ({ ...plain(d.data()), networkId: d.ref.parent.parent.id, id: d.id }),
  },
  {
    key: 'aggregates',
    table: 'aggregates',
    ref: () => collection(firestore, 'admin_aggregates'),
    map: (d) => ({ ...plain(d.data()), uid: d.id }),
  },
  {
    key: 'audit_logs',
    table: 'audit_logs',
    ref: () => collection(firestore, 'admin_audit_logs'),
    map: (d) => ({ ...plain(d.data()), id: d.id }),
  },
  {
    key: 'notifications',
    table: 'notifications',
    ref: () => collection(firestore, 'notification_deliveries'),
    map: (d) => ({ ...plain(d.data()), id: d.id }),
  },
  {
    key: 'admins',
    table: 'admins',
    ref: () => collection(firestore, 'Admins'),
    map: (d) => ({ ...plain(d.data()), id: d.id }),
  },
  {
    key: 'settings',
    table: 'settings',
    ref: () => collection(firestore, 'app_settings'),
    map: (d) => ({ ...plain(d.data()), key: d.id }),
  },
  {
    key: 'tombstones',
    table: null, // خاص: يطبّق الحذف بدل الكتابة
    ref: () => collection(firestore, 'sync_tombstones'),
    map: (d) => ({ ...plain(d.data()), id: d.id }),
  },
];

/** فحص واحد: أحدث تغيير في المجموعة (قراءة واحدة). */
export async function latestMs(src) {
  const snap = await getDocs(query(src.ref(), orderBy('updatedAtMs', 'desc'), limit(1)));
  countReads(`sync:latest:${src.key}`, snap.size, { fromCache: snap.metadata?.fromCache ?? null });
  return snap.empty ? 0 : Number(snap.docs[0].data().updatedAtMs) || 0;
}

/**
 * تنزيل كل ما تغيّر منذ المؤشر، على صفحات، مع تخطي ما سبق قراءته بـ startAfter.
 * يعيد أعلى قيمة updatedAtMs وصلت إليها.
 */
export async function pullSince(src, cursorMs, onRows) {
  let last = null;
  let maxMs = cursorMs;
  for (;;) {
    const constraints = [where('updatedAtMs', '>=', cursorMs), orderBy('updatedAtMs', 'asc')];
    if (last) constraints.push(startAfter(last));
    constraints.push(limit(PAGE_SIZE));
    const snap = await getDocs(query(src.ref(), ...constraints));
    countReads(`sync:pull:${src.key}`, snap.size, { fromCache: snap.metadata?.fromCache ?? null });
    if (snap.empty) break;
    await onRows(snap.docs.map(src.map));
    last = snap.docs[snap.docs.length - 1];
    maxMs = Math.max(maxMs, Number(last.data().updatedAtMs) || 0);
    if (snap.size < PAGE_SIZE) break;
  }
  return maxMs;
}

const controller = createSyncController({ minAutoIntervalMs: MIN_AUTO_INTERVAL_MS });
controller.configure({ latestMs, pullSince });

/** مزامنة واحدة في كل وقت. التلقائي محدود بفاصل دقيقة، واليدوي دائماً ينفذ. */
export function syncAll(localDb, { reason = 'auto' } = {}) {
  return controller.run(localDb, SOURCES, { reason });
}

/** إعادة تعيين المؤشرات: تُستخدم فقط لزر "مزامنة كاملة" في الإعدادات. */
export async function resetSyncCursors(localDb) {
  await localDb.sync_state.clear();
  await localDb.meta.put({ key: 'lastSyncAt', value: 0, reason: 'reset' });
}

export { applyRows, applyTombstones, syncSource };
