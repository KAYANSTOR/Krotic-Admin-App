import {
  collection, count, doc, getAggregateFromServer, getDoc, getDocs, getDocsFromServer, limit, orderBy, query, startAt, sum, Timestamp, where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { toDate } from './format';
import { mapWithConcurrency } from './mapWithConcurrency';
import { createAdminDataCache, withAdminDataCacheMetadata } from './adminDataCache';

const adminDataCache = createAdminDataCache({ getUid: () => auth.currentUser?.uid || null });
const FAN_OUT_CONCURRENCY = 5;

async function readCached(key, loader, options = {}) {
  return adminDataCache.readCached(key, loader, options);
}

export function clearAdminDataCache(options) {
  // This only removes the custom krotak:admin-data:* namespace. Firestore's
  // native IndexedDB persistence is intentionally left intact.
  adminDataCache.clear(options);
}

export function invalidateAdminDataCache(keys, uid) {
  adminDataCache.invalidate(keys, uid);
}

export function invalidateAdminUserData(uid) {
  invalidateAdminDataCache([
    'all-users', 'users-with-billing', 'dashboard-stats', 'network-sales',
    'users-for-select', `aggregate:${uid}`, `network-meta:${uid}`,
  ]);
}

export function invalidateAdminGlobalConfigData() {
  invalidateAdminDataCache([
    'global-config', 'users-with-billing', 'dashboard-stats', 'network-sales',
  ]);
}

export function getAdminDataCacheState(key, uid = auth.currentUser?.uid) {
  return adminDataCache.getState(key, uid);
}

export function subscribeAdminDataCache(key, listener, uid = auth.currentUser?.uid) {
  return adminDataCache.subscribe(key, listener, uid);
}

async function mapUsersWithLimit(users, label, mapper) {
  return mapWithConcurrency(users, FAN_OUT_CONCURRENCY, async (user, index) => {
    try {
      return await mapper(user, index);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} failed for user ${user.uid}: ${detail}`, { cause: error });
    }
  });
}

/**
 * Maps a fan-out but never rejects: a single failed child (e.g. a missing
 * composite index for one network) degrades that item instead of throwing away
 * the whole page. The returned errors are surfaced so the UI can warn honestly.
 */
async function mapUsersSoft(users, label, mapper) {
  const errors = [];
  const values = await mapWithConcurrency(users, FAN_OUT_CONCURRENCY, async (user, index) => {
    try {
      return await mapper(user, index);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${label} failed for user ${user.uid}: ${detail}`);
      return undefined;
    }
  });
  return { values, errors };
}

function partialResult(value, errors) {
  return withAdminDataCacheMetadata(
    { ...value, partial: true, errors },
    { fromCache: false, cacheable: false },
  );
}

export async function fetchGlobalConfig(options) {
  return readCached('global-config', async () => {
    const snap = await getDoc(doc(db, 'app_settings', 'global_config'));
    return snap.exists() ? snap.data() : { default_commission_rate: 5, is_app_active: true };
  }, options);
}

/**
 * قائمة المدراء مع تخزين محلي. المدير لا يُغيَّر إلا عبر مسار المصادقة، لذا
 * نُبطل مفتاحه يدوياً بعد الإنشاء/الحذف (انظر invalidateAdminListData).
 */
export async function fetchAdmins(options) {
  return readCached('admins', async () => {
    const snap = await getDocs(collection(db, 'Admins'));
    const admins = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    admins.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return admins;
  }, options);
}

/** أول صفحة من سجل العمليات مع تخزين محلي (الصفحات التالية تُدمج عند الطلب). */
export async function fetchAuditLogs(options) {
  return readCached('audit-logs', async () => {
    const snap = await getDocs(query(
      collection(db, 'admin_audit_logs'),
      orderBy('createdAtMs', 'desc'),
      limit(30),
    ));
    return { logs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), hasMore: snap.docs.length === 30 };
  }, options);
}

/** أول صفحة من الإشعارات العامة مع تخزين محلي. */
export async function fetchNotificationHistory(options) {
  return readCached('notification-history', async () => {
    const snap = await getDocs(query(
      collection(db, 'app_settings', 'global_config', 'notifications'),
      orderBy('timestamp', 'desc'),
      limit(20),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, options);
}

export function invalidateNotificationHistory() {
  invalidateAdminDataCache(['notification-history']);
}

export function invalidateAdminListData() {
  invalidateAdminDataCache(['admins']);
}

function nestedReadOptions(options, loaderContext) {
  return { ...(options || {}), force: Boolean(options?.force || loaderContext?.force) };
}

async function fetchNetworkMeta(uid, options) {
  return readCached(`network-meta:${uid}`, async () => {
    try {
      const snap = await getDoc(doc(db, 'networks', uid, '_metadata', 'info'));
      if (snap.exists()) { const data = snap.data(); return { networkName: data.name || '', phoneNumber: data.phoneNumber || '' }; }
    } catch { /* optional */ }
    return { networkName: '', phoneNumber: '' };
  }, options);
}
async function fetchSalesForUser(uid, recentOnly = false, options) {
  return readCached(`sales:${uid}:${recentOnly ? 'recent' : 'all'}`, async () => {
    const ref = collection(db, 'networks', uid, 'sales');
    const snap = await getDocs(recentOnly ? query(ref, orderBy('createdAt', 'desc'), limit(50)) : ref);
    return snap.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
  }, options);
}
function mergeByDocumentId(previous = [], incoming = []) {
  const records = new Map(previous.map((record) => [record.id, record]));
  incoming.forEach((record) => records.set(record.id, record));
  return [...records.values()];
}
function latestTimestampCursor(records, field) {
  let millis = null;
  records.forEach((record) => {
    const date = toDate(record[field]);
    const value = date?.getTime();
    if (Number.isFinite(value) && (millis === null || value > millis)) millis = value;
  });
  return millis === null ? null : { millis };
}
export async function fetchUserBillingHistory(uid, options) {
  return readCached(`billing-history:${uid}`, async ({ cachedValue, force } = {}) => {
    const salesRef = collection(db, 'networks', uid, 'sales');
    const paymentsRef = collection(db, 'networks', uid, 'payments');
    const salesCursor = Number(cachedValue?.salesCursor?.millis);
    const paymentsCursor = Number(cachedValue?.paymentsCursor?.millis);
    const incrementalSales = !force && Array.isArray(cachedValue?.sales) && Number.isFinite(salesCursor);
    const incrementalPayments = !force && Array.isArray(cachedValue?.payments) && Number.isFinite(paymentsCursor);
    const salesConstraints = [where('status', '==', 'COMPLETED'), orderBy('createdAt', 'asc')];
    const paymentConstraints = [orderBy('timestamp', 'asc')];
    if (incrementalSales) salesConstraints.push(startAt(Timestamp.fromMillis(salesCursor)));
    if (incrementalPayments) paymentConstraints.push(startAt(Timestamp.fromMillis(paymentsCursor)));
    const readQuery = (firestoreQuery) => (force
      ? getDocsFromServer(firestoreQuery)
      : getDocs(firestoreQuery));
    const [salesSnapshot, paymentsSnapshot] = await Promise.all([
      readQuery(query(salesRef, ...salesConstraints)),
      readQuery(query(paymentsRef, ...paymentConstraints)),
    ]);
    const incomingSales = salesSnapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
    const incomingPayments = paymentsSnapshot.docs.map((paymentDoc) => ({ id: paymentDoc.id, ...paymentDoc.data() }));
    const sales = mergeByDocumentId(incrementalSales ? cachedValue.sales : [], incomingSales);
    const payments = mergeByDocumentId(incrementalPayments ? cachedValue.payments : [], incomingPayments);
    const history = {
      sales,
      payments,
      salesCursor: latestTimestampCursor(sales, 'createdAt'),
      paymentsCursor: latestTimestampCursor(payments, 'timestamp'),
    };
    return force ? withAdminDataCacheMetadata(history, { fromCache: false }) : history;
  }, options);
}
export async function fetchAllUsers(options) {
  return readCached('all-users', async () => {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((userDoc) => ({ uid: userDoc.id, ...userDoc.data() }));
  }, options);
}
function monthKey(input) {
  const date = toDate(input);
  return date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : null;
}
function buildMonthlyBuckets(sales) {
  const buckets = {};
  sales.forEach((sale) => {
    const key = monthKey(sale.createdAt); if (!key) return;
    const bucket = buckets[key] || { face: 0, count: 0 };
    const face = Number(sale.faceValue) || 0;
    bucket.face += face; bucket.count += 1; buckets[key] = bucket;
  });
  return buckets;
}
function sixMonthsAgo() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 5, 1);
}
async function fetchAggregateFromFirestore(uid) {
  const salesRef = collection(db, 'networks', uid, 'sales');
  const completedQuery = query(salesRef, where('status', '==', 'COMPLETED'));
  const paymentsRef = collection(db, 'networks', uid, 'payments');
  const [salesAggregate, paymentsAggregate] = await Promise.all([
    getAggregateFromServer(completedQuery, {
      totalFaceValue: sum('faceValue'),
      totalTransactions: count(),
    }),
    getAggregateFromServer(paymentsRef, { totalPaid: sum('amount') }),
  ]);
  const totalFaceValue = Number(salesAggregate.data().totalFaceValue) || 0;
  const totalTransactions = Number(salesAggregate.data().totalTransactions) || 0;
  const totalPaid = Number(paymentsAggregate.data().totalPaid) || 0;
  let monthly = {};
  let monthlyAvailable = true;
  try {
    const recentSalesSnapshot = await getDocs(query(
      completedQuery,
      where('createdAt', '>=', Timestamp.fromDate(sixMonthsAgo())),
      orderBy('createdAt', 'asc'),
    ));
    const recentSales = recentSalesSnapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
    monthly = buildMonthlyBuckets(recentSales);
  } catch (error) {
    // Keep all-time totals usable, but explicitly mark the monthly chart incomplete.
    monthlyAvailable = false;
    console.warn(`تعذر تحميل مبيعات الأشهر الأخيرة للشبكة ${uid}:`, error);
  }
  return {
    totalFaceValue,
    totalTransactions,
    totalPaid,
    monthly,
    monthlyAvailable,
    source: 'aggregation',
  };
}
async function fetchAggregate(uid, options) {
  return readCached(`aggregate:${uid}`, async () => {
    const snap = await getDoc(doc(db, 'admin_aggregates', uid));
    const aggregate = snap.exists()
      ? { ...snap.data(), monthlyAvailable: Object.hasOwn(snap.data(), 'monthly'), source: 'aggregate' }
      : await fetchAggregateFromFirestore(uid);
    const monthly = Object.fromEntries(Object.entries(aggregate.monthly || {}).map(([month, bucket]) => [
      month,
      { face: Number(bucket.face) || 0, count: Number(bucket.count) || 0 },
    ]));
    const { totalAdminEarnings: _unverifiedEarnings, ...reportedAggregate } = aggregate;
    return {
      ...reportedAggregate,
      monthly,
    };
  }, options);
}
async function enrichUserForBilling(user, options) {
  const [meta, aggregate] = await Promise.all([fetchNetworkMeta(user.uid, options), fetchAggregate(user.uid, options)]);
  return { ...user, ...meta, reportedSalesValue: Number(aggregate.totalFaceValue) || 0, reportedTransactions: Number(aggregate.totalTransactions) || 0, recordedPayments: Number(aggregate.totalPaid) || 0 };
}
export async function fetchUsersWithBilling(options) {
  return readCached('users-with-billing', async (loaderContext) => {
    const childOptions = nestedReadOptions(options, loaderContext);
    const [config, users] = await Promise.all([fetchGlobalConfig(childOptions), fetchAllUsers(childOptions)]);
    const { values: enrichedUsers, errors } = await mapUsersSoft(users, 'Billing data', (user) => enrichUserForBilling(user, childOptions));
    // Keep every user row; a failed network shows zeroed aggregates but is still
    // listed, and the error is reported so the UI can flag incomplete data.
    const completeUsers = enrichedUsers.map((enriched, index) => enriched ?? {
      ...users[index],
      networkName: '',
      phoneNumber: '',
      reportedSalesValue: 0,
      reportedTransactions: 0,
      recordedPayments: 0,
    });
    const value = { users: completeUsers, globalConfig: config };
    return errors.length ? partialResult(value, errors) : value;
  }, options);
}
const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAY_MS = 86_400_000;
function recentMonths(buckets, count) {
  const now = new Date(); const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, label: MONTH_LABELS[cursor.getMonth()], ...(buckets[key] || { face: 0, count: 0 }) });
  }
  return months;
}
export async function fetchDashboardStats(options) {
  return readCached('dashboard-stats', async (loaderContext) => {
    const childOptions = nestedReadOptions(options, loaderContext);
    const [config, users] = await Promise.all([fetchGlobalConfig(childOptions), fetchAllUsers(childOptions)]);
    const { values: rawAggregates, errors } = await mapUsersSoft(users, 'Dashboard aggregate', (user) => fetchAggregate(user.uid, childOptions));
    const aggregates = rawAggregates.map((aggregate) => aggregate ?? { monthly: {}, monthlyAvailable: true });
    const totals = { totalSales: 0, totalTransactions: 0 }; const buckets = {};
    aggregates.forEach((aggregate) => {
      totals.totalSales += Number(aggregate.totalFaceValue) || 0; totals.totalTransactions += Number(aggregate.totalTransactions) || 0;
      Object.entries(aggregate.monthly || {}).forEach(([key, value]) => { const b = buckets[key] || { face: 0, count: 0 }; b.face += Number(value.face) || 0; b.count += Number(value.count) || 0; buckets[key] = b; });
    });
    const warningDays = Number(config.warning_days_before_expiry) > 0 ? Number(config.warning_days_before_expiry) : 5; const now = Date.now(); let expiredUsers = 0; let expiringSoonUsers = 0; let trialExpiringSoonUsers = 0;
    users.forEach((user) => { const end = toDate(user.subscription_end_date); if (!end || Number.isNaN(end.getTime())) return; const remaining = end.getTime() - now; if (remaining < 0) expiredUsers += 1; else if (remaining <= warningDays * DAY_MS) { expiringSoonUsers += 1; if (user.is_trial === true) trialExpiringSoonUsers += 1; } });
    const value = { appStatus: config, stats: { totalUsers: users.length, trialUsers: users.filter((u) => u.is_trial === true).length, activeUsers: users.filter((u) => u.is_active !== false).length, blockedUsers: users.filter((u) => u.is_active === false).length, ...totals }, alerts: { expiredUsers, expiringSoonUsers, trialExpiringSoonUsers, warningDays }, monthlySales: recentMonths(buckets, 6), monthlyDataWarning: errors.length > 0 || aggregates.some((aggregate) => aggregate.monthlyAvailable === false) };
    return errors.length ? partialResult(value, errors) : value;
  }, options);
}
export async function fetchNetworkSales(options) {
  return readCached('network-sales', async (loaderContext) => {
    const childOptions = nestedReadOptions(options, loaderContext);
    const [users, config] = await Promise.all([fetchAllUsers(childOptions), fetchGlobalConfig(childOptions)]);
    const defaultCommissionRate = Number(config.default_commission_rate ?? 5);
    const { values: rawNetworks, errors } = await mapUsersSoft(users, 'Network sales', async (user) => {
      const [meta, sales] = await Promise.all([fetchNetworkMeta(user.uid, childOptions), fetchSalesForUser(user.uid, false, childOptions)]);
      if (!sales.length) return null;
      const customRate = Number(user.commission_rate);
      const commissionRate = user.commission_rate != null && user.commission_rate !== '' && Number.isFinite(customRate)
        ? customRate
        : (Number.isFinite(defaultCommissionRate) ? defaultCommissionRate : 5);
      return { uid: user.uid, networkName: meta.networkName, phoneNumber: meta.phoneNumber, sales, commissionRate };
    });
    const value = rawNetworks.filter(Boolean);
    return errors.length ? partialResult(value, errors) : value;
  }, options);
}
export async function fetchUsersForSelect(options) {
  return readCached('users-for-select', async (loaderContext) => {
    const childOptions = nestedReadOptions(options, loaderContext);
    const users = await fetchAllUsers(childOptions); return mapUsersWithLimit(users, 'User selector', async (user) => { const meta = await fetchNetworkMeta(user.uid, childOptions); return { uid: user.uid, name: meta.networkName || user.uid }; });
  }, options);
}
