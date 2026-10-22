import { normalizeUserAccess } from '../accessStatus.js';
import { summarizeCompletedSales } from '../commission.js';

/**
 * طبقة الاستعلام المحلية: كل الشاشات تقرأ من IndexedDB عبر هذه الدوال.
 * لا يوجد أي استعلام Firestore هنا — القراءة كلها من القاعدة المحلية.
 */

const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAY_MS = 86_400_000;

export function networkDocumentId(user) {
  return typeof user?.networkId === 'string' && user.networkId.trim() ? user.networkId.trim() : user.uid;
}

export function timestampMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function rowTime(row, ...fields) {
  for (const field of fields) {
    const millis = timestampMs(row?.[field]);
    if (millis !== null) return millis;
  }
  return 0;
}

export function monthKeyFromMs(millis) {
  if (!millis) return null;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function recentMonthsFrom(buckets, count = 6) {
  const now = new Date();
  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, label: MONTH_LABELS[cursor.getMonth()], ...(buckets[key] || { face: 0, count: 0 }) });
  }
  return months;
}

/** يقرأ كل جدول محلي دفعة واحدة (قراءة واحدة من IndexedDB لكل جدول). */
export async function readAllRows(localDb, table) {
  if (!localDb) return [];
  try {
    return await localDb.table(table).toArray();
  } catch (error) {
    console.warn(`Local table read failed: ${table}`, error);
    return [];
  }
}

/** الإعدادات العامة مخزّنة محلياً في جدول settings. */
export async function readGlobalConfig(localDb) {
  const rows = await readAllRows(localDb, 'settings');
  const globalConfig = rows.find((row) => row.key === 'global_config');
  if (!globalConfig) return { default_commission_rate: 5, is_app_active: true };
  const { key: _key, id: _id, ...value } = globalConfig;
  return value;
}

/**
 * يدمج مستند `users` مع مستند `networks` المملوك له.
 * الشبكة هي المصدر الأصلي لاسم الشبكة والهاتف بعد ترحيل الهوية إلى NET-xxxxx.
 */
export function mergeUsersWithNetworks(userRows, networkRows) {
  const usersMap = new Map();
  (userRows || []).forEach((user) => {
    const data = user || {};
    const netName = data.network_name || data.networkName || data.name || data.displayName
      || data.networkTitle || data.network || data.username || '';
    const phone = data.phone || data.phoneNumber || data.mobile || data.phone_number || '';
    usersMap.set(data.uid, normalizeUserAccess({
      ...data,
      networkName: netName || `مشترك (${String(data.uid).slice(0, 8)})`,
      network_name: netName || `مشترك (${String(data.uid).slice(0, 8)})`,
      phoneNumber: phone,
      phone,
    }));
  });

  (networkRows || []).forEach((network) => {
    const ownerUid = String(network.owner_uid || network.ownerUid || network.uid || network.networkId || '').trim();
    if (!ownerUid) return;
    const netName = network.networkName || network.network_name || network.name || network.networkTitle || `شبكة ${network.networkId}`;
    const phone = network.phone || network.phoneNumber || network.mobile || '';
    const existing = usersMap.get(ownerUid);
    if (existing) {
      usersMap.set(ownerUid, {
        ...existing,
        networkId: existing.networkId || network.networkId,
        networkName: existing.networkName && !existing.networkName.startsWith('مشترك (') ? existing.networkName : netName,
        network_name: existing.network_name && !existing.network_name.startsWith('مشترك (') ? existing.network_name : netName,
        // الشبكة هي المصدر الأصلي للهاتف بعد ترحيل الهوية إلى NET-xxxxx.
        phoneNumber: phone || existing.phoneNumber,
        phone: phone || existing.phone,
        is_active: existing.is_active ?? network.is_active ?? true,
        is_trial: existing.is_trial ?? network.is_trial ?? false,
        accessStatus: existing.accessStatus || network.accessStatus || (network.is_trial ? 'TRIAL' : 'ACTIVE_PAID'),
        subscription_end_date: existing.subscription_end_date || network.subscription_end_date || network.subscriptionEndsAt || null,
      });
    } else {
      usersMap.set(ownerUid, normalizeUserAccess({
        uid: ownerUid,
        networkId: network.networkId,
        networkName: netName,
        network_name: netName,
        phoneNumber: phone,
        phone,
        is_active: network.is_active ?? true,
        is_trial: network.is_trial ?? false,
        accessStatus: network.accessStatus || (network.is_trial ? 'TRIAL' : 'ACTIVE_PAID'),
        subscription_end_date: network.subscription_end_date || network.subscriptionEndsAt || null,
      }));
    }
  });

  return [...usersMap.values()];
}

/** مبيعات الشبكة (بفهرس networkId). */
export function salesForNetwork(salesRows, networkId) {
  return (salesRows || []).filter((sale) => sale.networkId === networkId);
}

/** مدفوعات الشبكة (بفهرس networkId). */
export function paymentsForNetwork(paymentRows, networkId) {
  return (paymentRows || []).filter((payment) => payment.networkId === networkId);
}

/** إجماليات الإعدادات من جدول aggregates المحلي (المحدَّث خادمياً). */
export function summarizeAggregates(aggregateRows) {
  const totals = {
    totalFaceValue: 0,
    totalTransactions: 0,
    totalCommissionDue: 0,
    totalPaid: 0,
    totalCommissionOutstanding: 0,
  };
  const buckets = {};

  (aggregateRows || []).forEach((row) => {
    const data = row || {};
    const due = Number(data.totalCommissionDue) || 0;
    const paid = Number(data.totalPaid) || 0;
    totals.totalFaceValue += Number(data.totalFaceValue) || 0;
    totals.totalTransactions += Number(data.totalTransactions) || 0;
    totals.totalCommissionDue += due;
    totals.totalPaid += paid;
    totals.totalCommissionOutstanding += Math.max(0, due - paid);
    Object.entries(data.monthly || {}).forEach(([key, value]) => {
      const bucket = buckets[key] || { face: 0, count: 0 };
      bucket.face += Number(value.face) || 0;
      bucket.count += Number(value.count) || 0;
      buckets[key] = bucket;
    });
  });

  return { totals, monthly: buckets, monthlySales: recentMonthsFrom(buckets, 6) };
}

/** يبني خريطة إجماليات لكل مستخدم من جدول aggregates. */
export function aggregateMapByUid(aggregateRows) {
  const map = new Map();
  (aggregateRows || []).forEach((row) => {
    if (row?.uid) map.set(row.uid, row);
  });
  return map;
}

/**
 * يبني تقرير شبكة واحدة: بيانات الشبكة + إجمالياتها من المبيعات المحلية + المدفوعات.
 * لا حسابات مالية مُختلقة: العمولة تأتي من الحقول الخادمية في سجلات البيع.
 */
export function buildNetworkReport({ user, sales, payments, aggregate, defaultCommissionRate = 5 }) {
  const summary = summarizeCompletedSales(sales || []);
  const aggregateData = aggregate || {};
  const due = Number(aggregateData.totalCommissionDue) || summary.commissionDue;
  const recordedPayments = Number(aggregateData.totalPaid)
    || (payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const customRate = Number(user?.commission_rate);
  const commissionRate = user?.commission_rate != null && user.commission_rate !== '' && Number.isFinite(customRate)
    ? customRate
    : (Number.isFinite(Number(defaultCommissionRate)) ? Number(defaultCommissionRate) : 5);

  return {
    ...user,
    networkName: user?.networkName || user?.network_name || '',
    phoneNumber: user?.phoneNumber || user?.phone || '',
    commissionRate,
    reportedSalesValue: Number(aggregateData.totalFaceValue) || summary.reportedSalesValue,
    reportedTransactions: Number(aggregateData.totalTransactions) || summary.reportedTransactions,
    recordedPayments,
    commissionDue: due,
    outstandingCommission: Math.max(0, due - recordedPayments),
    monthly: Object.fromEntries(Object.entries(aggregateData.monthly || {}).map(([month, bucket]) => [
      month,
      { face: Number(bucket.face) || 0, count: Number(bucket.count) || 0 },
    ])),
  };
}

/** ينبّه على الاشتراكات المنتهية أو القريبة من الانتهاء. */
export function summarizeSubscriptionAlerts(users, config, now = Date.now()) {
  const warningDays = Number(config?.warning_days_before_expiry) > 0 ? Number(config.warning_days_before_expiry) : 5;
  let expiredUsers = 0;
  let expiringSoonUsers = 0;
  let trialExpiringSoonUsers = 0;
  (users || []).forEach((user) => {
    const end = timestampMs(user.subscription_end_date ?? user.subscriptionEndsAt);
    if (!end) return;
    const remaining = end - now;
    if (remaining < 0) expiredUsers += 1;
    else if (remaining <= warningDays * DAY_MS) {
      expiringSoonUsers += 1;
      if (user.is_trial === true) trialExpiringSoonUsers += 1;
    }
  });
  return { expiredUsers, expiringSoonUsers, trialExpiringSoonUsers, warningDays };
}

/** يبني تقرير لوحة التحكم كاملاً من القاعدة المحلية. */
export function buildDashboardReport({ users, aggregates, config }) {
  const { totals, monthlySales } = summarizeAggregates(aggregates);
  const alerts = summarizeSubscriptionAlerts(users, config);
  return {
    appStatus: config,
    stats: {
      totalUsers: users.length,
      trialUsers: users.filter((user) => user.is_trial === true).length,
      activeUsers: users.filter((user) => user.is_active !== false).length,
      blockedUsers: users.filter((user) => user.is_active === false).length,
      ...totals,
      // أسماء الحقول التي تستخدمها الشاشات (توافق مع تقرير لوحة التحكم القديم).
      totalSales: totals.totalFaceValue,
      totalCommission: totals.totalCommissionDue,
    },
    alerts,
    monthlySales,
    monthlyDataWarning: false,
  };
}

/** مبيعات الشبكة مرتّبة من الأحدث للأحدث. */
export function sortSalesByCreatedDesc(sales) {
  return [...(sales || [])].sort((a, b) => rowTime(b, 'createdAtMs', 'createdAt', 'ingestedAtMs') - rowTime(a, 'createdAtMs', 'createdAt', 'ingestedAtMs'));
}

/** سجل التدقيق مرتّباً من الأحدث للأقدم. */
export function sortAuditDesc(logs) {
  return [...(logs || [])].sort((a, b) => rowTime(b, 'createdAtMs', 'createdAt') - rowTime(a, 'createdAtMs', 'createdAt'));
}

/** سجل الإشعارات مرتّباً من الأحدث للأقدم. */
export function sortNotificationsDesc(list) {
  return [...(list || [])].sort((a, b) => (Number(b.displayTimestamp) || 0) - (Number(a.displayTimestamp) || 0));
}

/** يطبّع سجل إشعار من جدول notification_deliveries المحلي. */
export function normalizeNotificationRow(row) {
  const data = row || {};
  const body = data.body || data.message || '';
  const timestamp = timestampMs(data.createdAtMs) ?? timestampMs(data.timestamp) ?? Date.now();
  return {
    ...data,
    id: data.id,
    title: data.title || '',
    message: body,
    body,
    status: data.status || 'sent',
    sentCount: data.sent ?? data.sentCount ?? 1,
    displayTimestamp: timestamp,
    timestamp,
  };
}
