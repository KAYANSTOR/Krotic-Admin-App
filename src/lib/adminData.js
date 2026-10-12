import {
  collection, count, doc, getAggregateFromServer, getDoc, getDocs, limit, orderBy, query, sum, Timestamp, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { toDate } from './format';

const CACHE_TTL = 60_000;
const LOCAL_CACHE_TTL = 15 * 60_000;
const LOCAL_CACHE_PREFIX = 'krotak:admin-data:';
const cache = new Map();
const inFlight = new Map();

function readLocal(key) {
  try {
    const raw = window.localStorage.getItem(`${LOCAL_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.value == null || Date.now() - parsed.createdAt > LOCAL_CACHE_TTL) return null;
    return parsed.value;
  } catch { return null; }
}
function writeLocal(key, value) {
  try { window.localStorage.setItem(`${LOCAL_CACHE_PREFIX}${key}`, JSON.stringify({ createdAt: Date.now(), value })); } catch { /* optional */ }
}
async function readCached(key, loader, { force = false } = {}) {
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.createdAt < CACHE_TTL) return cached.value;
  if (!force && inFlight.has(key)) return inFlight.get(key);
  if (!force && !cached) {
    const localValue = readLocal(key);
    if (localValue != null) {
      cache.set(key, { value: localValue, createdAt: Date.now() - CACHE_TTL - 1 });
      void readCached(key, loader, { force: true }).catch(() => {
        // Keep serving the last known local snapshot when offline.
      });
      return localValue;
    }
  }
  const request = Promise.resolve().then(loader).then((value) => {
    cache.set(key, { value, createdAt: Date.now() });
    writeLocal(key, value);
    inFlight.delete(key);
    return value;
  }).catch((error) => { inFlight.delete(key); throw error; });
  inFlight.set(key, request);
  return request;
}
export function clearAdminDataCache() { cache.clear(); inFlight.clear(); }

export async function fetchGlobalConfig(options) {
  return readCached('global-config', async () => {
    const snap = await getDoc(doc(db, 'app_settings', 'global_config'));
    return snap.exists() ? snap.data() : { default_commission_rate: 5, is_app_active: true };
  }, options);
}
export function resolveCommissionRate(userData, globalRate) {
  return userData?.commission_rate != null && userData.commission_rate > 0 ? userData.commission_rate : (globalRate ?? 5);
}
async function fetchNetworkMeta(uid) {
  return readCached(`network-meta:${uid}`, async () => {
    try {
      const snap = await getDoc(doc(db, 'networks', uid, '_metadata', 'info'));
      if (snap.exists()) { const data = snap.data(); return { networkName: data.name || '', phoneNumber: data.phoneNumber || '' }; }
    } catch { /* optional */ }
    return { networkName: '', phoneNumber: '' };
  });
}
async function fetchSalesForUser(uid, recentOnly = false) {
  return readCached(`sales:${uid}:${recentOnly ? 'recent' : 'all'}`, async () => {
    const ref = collection(db, 'networks', uid, 'sales');
    const snap = await getDocs(recentOnly ? query(ref, orderBy('createdAt', 'desc'), limit(50)) : ref);
    return snap.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
  });
}
async function fetchPaymentsForUser(uid) {
  const snap = await getDocs(collection(db, 'networks', uid, 'payments'));
  return snap.docs.reduce((sum, paymentDoc) => sum + (Number(paymentDoc.data().amount) || 0), 0);
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
function buildMonthlyBuckets(sales, rate) {
  const buckets = {};
  sales.forEach((sale) => {
    const key = monthKey(sale.createdAt); if (!key) return;
    const bucket = buckets[key] || { face: 0, earnings: 0, count: 0 };
    const face = Number(sale.faceValue) || 0;
    bucket.face += face; bucket.earnings += face * rate; bucket.count += 1; buckets[key] = bucket;
  });
  return buckets;
}
function sixMonthsAgo() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 5, 1);
}
async function fetchAggregateFromFirestore(uid, user, globalCommission) {
  const rate = resolveCommissionRate(user, globalCommission) / 100;
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
  try {
    const recentSalesSnapshot = await getDocs(query(
      completedQuery,
      where('createdAt', '>=', Timestamp.fromDate(sixMonthsAgo())),
      orderBy('createdAt', 'asc'),
    ));
    const recentSales = recentSalesSnapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
    monthly = buildMonthlyBuckets(recentSales, rate);
  } catch (error) {
    // The dashboard totals remain usable while a newly deployed composite index settles.
    console.warn(`تعذر تحميل مبيعات الأشهر الأخيرة للشبكة ${uid}:`, error);
  }
  return {
    totalFaceValue,
    totalAdminEarnings: totalFaceValue * rate,
    totalTransactions,
    totalPaid,
    monthly,
    source: 'aggregation',
  };
}
async function fetchAggregate(uid, user, globalCommission) {
  const snap = await getDoc(doc(db, 'admin_aggregates', uid));
  if (snap.exists()) return { ...snap.data(), source: 'aggregate' };
  return fetchAggregateFromFirestore(uid, user, globalCommission);
}
async function enrichUserForBilling(user, globalCommission) {
  const [meta, aggregate] = await Promise.all([fetchNetworkMeta(user.uid), fetchAggregate(user.uid, user, globalCommission)]);
  return { ...user, ...meta, balance: (Number(aggregate.totalAdminEarnings) || 0) - (Number(aggregate.totalPaid) || 0), totalSales: Number(aggregate.totalFaceValue) || 0, totalTransactions: Number(aggregate.totalTransactions) || 0, totalPaid: Number(aggregate.totalPaid) || 0 };
}
export async function fetchUsersWithBilling(options) {
  return readCached('users-with-billing', async () => {
    const [config, users] = await Promise.all([fetchGlobalConfig(options), fetchAllUsers(options)]);
    const globalCommission = config.default_commission_rate || 5;
    return { users: await Promise.all(users.map((user) => enrichUserForBilling(user, globalCommission))), globalConfig: config, globalCommission };
  }, options);
}
const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAY_MS = 86_400_000;
function recentMonths(buckets, count) {
  const now = new Date(); const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    months.push({ month: key, label: MONTH_LABELS[cursor.getMonth()], ...(buckets[key] || { face: 0, earnings: 0, count: 0 }) });
  }
  return months;
}
export async function fetchDashboardStats(options) {
  return readCached('dashboard-stats', async () => {
    const [config, users] = await Promise.all([fetchGlobalConfig(options), fetchAllUsers(options)]);
    const rate = config.default_commission_rate || 5;
    const aggregates = await Promise.all(users.map((user) => fetchAggregate(user.uid, user, rate)));
    const totals = { totalSales: 0, totalAdminEarnings: 0, totalTransactions: 0 }; const buckets = {};
    aggregates.forEach((aggregate) => {
      totals.totalSales += Number(aggregate.totalFaceValue) || 0; totals.totalAdminEarnings += Number(aggregate.totalAdminEarnings) || 0; totals.totalTransactions += Number(aggregate.totalTransactions) || 0;
      Object.entries(aggregate.monthly || {}).forEach(([key, value]) => { const b = buckets[key] || { face: 0, earnings: 0, count: 0 }; b.face += Number(value.face) || 0; b.earnings += Number(value.earnings) || 0; b.count += Number(value.count) || 0; buckets[key] = b; });
    });
    const warningDays = Number(config.warning_days_before_expiry) > 0 ? Number(config.warning_days_before_expiry) : 5; const now = Date.now(); let expiredUsers = 0; let expiringSoonUsers = 0; let trialExpiringSoonUsers = 0;
    users.forEach((user) => { const end = toDate(user.subscription_end_date); if (!end || Number.isNaN(end.getTime())) return; const remaining = end.getTime() - now; if (remaining < 0) expiredUsers += 1; else if (remaining <= warningDays * DAY_MS) { expiringSoonUsers += 1; if (user.is_trial === true) trialExpiringSoonUsers += 1; } });
    return { appStatus: config, stats: { totalUsers: users.length, trialUsers: users.filter((u) => u.is_trial === true).length, activeUsers: users.filter((u) => u.is_active !== false).length, blockedUsers: users.filter((u) => u.is_active === false).length, ...totals }, alerts: { expiredUsers, expiringSoonUsers, trialExpiringSoonUsers, warningDays }, monthlySales: recentMonths(buckets, 6) };
  }, options);
}
export async function fetchNetworkSales(options) {
  return readCached('network-sales', async () => {
    const [config, users] = await Promise.all([fetchGlobalConfig(options), fetchAllUsers(options)]); const globalCommission = config.default_commission_rate || 5;
    const networks = await Promise.all(users.map(async (user) => {
      const [meta, aggregate, sales] = await Promise.all([fetchNetworkMeta(user.uid), fetchAggregate(user.uid, user, globalCommission), fetchSalesForUser(user.uid, true)]);
      if (!sales.length && !aggregate.totalTransactions) return null;
      return { uid: user.uid, networkName: meta.networkName, phoneNumber: meta.phoneNumber, commissionRate: resolveCommissionRate(user, globalCommission), isCustomRate: user.commission_rate != null && user.commission_rate > 0, sales, aggregate };
    }));
    return networks.filter(Boolean);
  }, options);
}
export async function fetchUsersForSelect(options) {
  return readCached('users-for-select', async () => {
    const users = await fetchAllUsers(options); return Promise.all(users.map(async (user) => { const meta = await fetchNetworkMeta(user.uid); return { uid: user.uid, name: meta.networkName || user.uid }; }));
  }, options);
}
