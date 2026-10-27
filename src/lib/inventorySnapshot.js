import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { plain } from './localDb/plain';
import { trackRead } from './localDb/readMeter';

/**
 * يقرأ ملخص أعداد مخزون الكروت المزامَن من تطبيق Android لوثيقة واحدة صغيرة:
 * networks/{networkId}/inventory_snapshot/current
 *
 * الوثيقة تحمل أعداداً فقط (متاح/محجوز/مباع/تالف + تفصيل الفئات) ولا تحتوي
 * أي أرقام كروت سرية. تُكتب من المسار الخادمي POST /api/inventory/snapshot فقط.
 */
export async function fetchInventorySnapshot(networkId) {
  if (!networkId) return null;
  const ref = doc(db, 'networks', networkId, 'inventory_snapshot', 'current');
  const snapshot = await trackRead('inventory:snapshot', () => getDoc(ref));
  if (!snapshot.exists()) return null;
  return normalizeInventorySnapshot({ ...plain(snapshot.data()), networkId });
}

/** يطبّع الوثيقة المقروءة (Timestamps => ms) ويُرجع حقول الأعداد فقط. */
export function normalizeInventorySnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const breakdown = Array.isArray(raw.breakdown)
    ? raw.breakdown.map((entry) => ({
      catalogId: entry?.catalogId || '',
      denomination: Number(entry?.denomination) || 0,
      currency: entry?.currency || '',
      availableCount: Number(entry?.availableCount) || 0,
      reservedCount: Number(entry?.reservedCount) || 0,
      soldCount: Number(entry?.soldCount) || 0,
    }))
    : [];
  return {
    snapshotId: raw.snapshotId || '',
    inventoryRevision: Number(raw.inventoryRevision) || 0,
    generatedAt: raw.generatedAt || null,
    generatedAtMs: Number(raw.generatedAtMs) || null,
    updatedAtMs: Number(raw.updatedAtMs) || null,
    serverReceivedAtMs: Number(raw.serverReceivedAtMs) || null,
    totalAvailableCards: Number(raw.totalAvailableCards) || 0,
    totalReservedCards: Number(raw.totalReservedCards) || 0,
    totalSoldCards: Number(raw.totalSoldCards) || 0,
    totalInvalidCards: Number(raw.totalInvalidCards) || 0,
    breakdown,
  };
}
