import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

const CACHE_TTL = 15_000;
const cache = new Map();
const inFlight = new Map();

async function readCached(key, loader, { force = false } = {}) {
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && now - cached.createdAt < CACHE_TTL) return cached.value;
  if (!force && inFlight.has(key)) return inFlight.get(key);
  const request = Promise.resolve().then(loader).then((value) => {
    cache.set(key, { value, createdAt: Date.now() });
    inFlight.delete(key);
    return value;
  }).catch((error) => {
    inFlight.delete(key);
    throw error;
  });
  inFlight.set(key, request);
  return request;
}

export function clearAdminDataCache() {
  cache.clear();
}

export async function fetchGlobalConfig(options) {
  return readCached('global-config', async () => {
    const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
    return configDoc.exists() ? configDoc.data() : { default_commission_rate: 5, is_app_active: true };
  }, options);
}

export function resolveCommissionRate(userData, globalRate) {
  if (userData?.commission_rate != null && userData.commission_rate > 0) return userData.commission_rate;
  return globalRate ?? 5;
}

// Per-user reads are shared across the dashboard, users and sales screens so the
// same subcollection is not fetched once per page within the cache window.
async function fetchNetworkMeta(uid) {
  return readCached(`network-meta:${uid}`, async () => {
    try {
      const metaDoc = await getDoc(doc(db, 'networks', uid, '_metadata', 'info'));
      if (metaDoc.exists()) {
        const metadata = metaDoc.data();
        return { networkName: metadata.name || '', phoneNumber: metadata.phoneNumber || '' };
      }
    } catch {
      // Network metadata is optional.
    }
    return { networkName: '', phoneNumber: '' };
  });
}

async function fetchSalesForUser(uid) {
  return readCached(`sales:${uid}`, async () => {
    const snap = await getDocs(collection(db, 'networks', uid, 'sales'));
    return snap.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
  });
}

// Payments are written from this panel, so they are intentionally not cached.
async function fetchPaymentsForUser(uid) {
  const snap = await getDocs(collection(db, 'networks', uid, 'payments'));
  return snap.docs.reduce((total, paymentDoc) => total + (paymentDoc.data().amount || 0), 0);
}

export async function fetchAllUsers(options) {
  return readCached('all-users', async () => {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((userDoc) => ({ uid: userDoc.id, ...userDoc.data() }));
  }, options);
}

async function enrichUserForBilling(user, globalCommission) {
  const [meta, sales, totalPaid] = await Promise.all([
    fetchNetworkMeta(user.uid),
    fetchSalesForUser(user.uid),
    fetchPaymentsForUser(user.uid),
  ]);
  const activeRate = resolveCommissionRate(user, globalCommission);
  const totalDue = sales.reduce((total, sale) => (
    sale.status === 'COMPLETED' ? total + (sale.faceValue || 0) * (activeRate / 100) : total
  ), 0);
  return { ...user, ...meta, balance: totalDue - totalPaid };
}

export async function fetchUsersWithBilling(options) {
  return readCached('users-with-billing', async () => {
    const [config, users] = await Promise.all([fetchGlobalConfig(options), fetchAllUsers(options)]);
    const globalCommission = config.default_commission_rate || 5;
    const enriched = await Promise.all(users.map((user) => enrichUserForBilling(user, globalCommission)));
    return { users: enriched, globalConfig: config, globalCommission };
  }, options);
}

export async function fetchDashboardStats(options) {
  return readCached('dashboard-stats', async () => {
    const [config, users] = await Promise.all([fetchGlobalConfig(options), fetchAllUsers(options)]);
    const globalCommission = config.default_commission_rate || 5;
    const salesResults = await Promise.all(users.map(async (user) => {
      const sales = await fetchSalesForUser(user.uid);
      return sales.reduce((result, sale) => {
        if (sale.status !== 'COMPLETED') return result;
        const faceValue = sale.faceValue || 0;
        result.face += faceValue;
        result.earnings += faceValue * (resolveCommissionRate(user, globalCommission) / 100);
        result.count += 1;
        return result;
      }, { face: 0, earnings: 0, count: 0 });
    }));
    const totals = salesResults.reduce((result, saleResult) => ({
      totalSales: result.totalSales + saleResult.face,
      totalAdminEarnings: result.totalAdminEarnings + saleResult.earnings,
      totalTransactions: result.totalTransactions + saleResult.count,
    }), { totalSales: 0, totalAdminEarnings: 0, totalTransactions: 0 });
    return {
      appStatus: config,
      stats: {
        totalUsers: users.length,
        trialUsers: users.filter((user) => user.is_trial === true).length,
        activeUsers: users.filter((user) => user.is_active !== false).length,
        blockedUsers: users.filter((user) => user.is_active === false).length,
        ...totals,
      },
    };
  }, options);
}

export async function fetchNetworkSales(options) {
  return readCached('network-sales', async () => {
    const [config, users] = await Promise.all([fetchGlobalConfig(options), fetchAllUsers(options)]);
    const globalCommission = config.default_commission_rate || 5;
    const networks = await Promise.all(users.map(async (user) => {
      const [meta, sales] = await Promise.all([fetchNetworkMeta(user.uid), fetchSalesForUser(user.uid)]);
      if (sales.length === 0) return null;
      const commissionRate = resolveCommissionRate(user, globalCommission);
      return {
        uid: user.uid,
        networkName: meta.networkName,
        phoneNumber: meta.phoneNumber,
        commissionRate,
        isCustomRate: user.commission_rate != null && user.commission_rate > 0,
        sales,
      };
    }));
    return networks.filter(Boolean);
  }, options);
}

export async function fetchUsersForSelect(options) {
  return readCached('users-for-select', async () => {
    const users = await fetchAllUsers(options);
    return Promise.all(users.map(async (user) => {
      const meta = await fetchNetworkMeta(user.uid);
      return { uid: user.uid, name: meta.networkName || user.uid };
    }));
  }, options);
}
