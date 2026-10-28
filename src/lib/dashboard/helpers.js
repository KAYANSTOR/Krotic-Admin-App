import { toDate } from '../format.js';

/** حالات البيع المعروضة في لوحة التحكم. */
export const SALE_STATUS = Object.freeze({
  COMPLETED: Object.freeze({ label: 'مكتمل', tone: 'success' }),
  ROLLED_BACK: Object.freeze({ label: 'مسترجع', tone: 'warning' }),
  SMS_PENDING: Object.freeze({ label: 'بانتظار SMS', tone: 'info' }),
});

const SALE_STATUS_FALLBACK = Object.freeze({ label: 'غير محدد', tone: 'neutral' });

export function saleStatusMeta(status) {
  return SALE_STATUS[status] ?? SALE_STATUS_FALLBACK;
}

/** يشتق قائمة حديثة من سجلات الشبكات المحفوظة محلياً. */
export function recentOperationsFromNetworks(networks, limit = 8) {
  if (!Array.isArray(networks)) return [];

  return networks
    .flatMap((network) => {
      const networkName = network.networkName || network.network_name || network.name
        || network.networkTitle || `شبكة ${network.networkId || network.uid || 'غير معروفة'}`;
      const sales = Array.isArray(network.sales) ? network.sales : [];

      return sales.map((sale) => ({
        ...sale,
        networkName,
        commissionRate: network.commissionRate,
      }));
    })
    .sort((left, right) => (
      (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0)
    ))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export const BALANCE_VISIBLE_KEY = 'krotak:dashboard-balance-visible';

export function loadBalanceVisible() {
  try {
    return window.localStorage.getItem(BALANCE_VISIBLE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveBalanceVisible(visible) {
  try {
    window.localStorage.setItem(BALANCE_VISIBLE_KEY, String(Boolean(visible)));
  } catch {
    // Preferences are best-effort when browser storage is unavailable.
  }
}
