import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Shared admin data helpers — parallel Firestore reads, no sequential N+1.
 */

export async function fetchGlobalConfig() {
  const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
  if (!configDoc.exists()) {
    return { default_commission_rate: 5, is_app_active: true };
  }
  return configDoc.data();
}

export function resolveCommissionRate(userData, globalRate) {
  if (userData?.commission_rate != null && userData.commission_rate > 0) {
    return userData.commission_rate;
  }
  return globalRate ?? 5;
}

async function fetchNetworkMeta(uid) {
  try {
    const metaDoc = await getDoc(doc(db, 'networks', uid, '_metadata', 'info'));
    if (metaDoc.exists()) {
      const m = metaDoc.data();
      return {
        networkName: m.name || '',
        phoneNumber: m.phoneNumber || '',
      };
    }
  } catch {
    /* metadata optional */
  }
  return { networkName: '', phoneNumber: '' };
}

async function fetchSalesForUser(uid) {
  const snap = await getDocs(collection(db, 'networks', uid, 'sales'));
  const sales = [];
  snap.forEach((d) => sales.push({ id: d.id, ...d.data() }));
  return sales;
}

async function fetchPaymentsForUser(uid) {
  const snap = await getDocs(collection(db, 'networks', uid, 'payments'));
  let totalPaid = 0;
  snap.forEach((d) => {
    totalPaid += d.data().amount || 0;
  });
  return totalPaid;
}

/**
 * Load all users (raw docs) in one collection read.
 */
export async function fetchAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/**
 * Enrich a single user with network meta + sales aggregates + balance.
 * Used by Users page.
 */
async function enrichUserForBilling(user, globalCommission) {
  const [meta, sales, totalPaid] = await Promise.all([
    fetchNetworkMeta(user.uid),
    fetchSalesForUser(user.uid),
    fetchPaymentsForUser(user.uid),
  ]);

  const activeRate = resolveCommissionRate(user, globalCommission);
  let totalDue = 0;
  sales.forEach((sale) => {
    if (sale.status === 'COMPLETED') {
      totalDue += (sale.faceValue || 0) * (activeRate / 100);
    }
  });

  return {
    ...user,
    ...meta,
    balance: totalDue - totalPaid,
  };
}

/**
 * Users page: parallel enrichment of every user.
 */
export async function fetchUsersWithBilling() {
  const [config, users] = await Promise.all([
    fetchGlobalConfig(),
    fetchAllUsers(),
  ]);
  const globalCommission = config.default_commission_rate || 5;

  const enriched = await Promise.all(
    users.map((u) => enrichUserForBilling(u, globalCommission))
  );

  return { users: enriched, globalConfig: config, globalCommission };
}

/**
 * Dashboard: aggregate KPIs without blocking on sequential sales.
 */
export async function fetchDashboardStats() {
  const [config, users] = await Promise.all([
    fetchGlobalConfig(),
    fetchAllUsers(),
  ]);
  const globalCommission = config.default_commission_rate || 5;

  const totalUsers = users.length;
  const trialUsers = users.filter((u) => u.is_trial === true).length;
  const activeUsers = users.filter((u) => u.is_active !== false).length;
  const blockedUsers = users.filter((u) => u.is_active === false).length;

  const salesResults = await Promise.all(
    users.map(async (user) => {
      const sales = await fetchSalesForUser(user.uid);
      const activeRate = resolveCommissionRate(user, globalCommission);
      let face = 0;
      let earnings = 0;
      let count = 0;
      sales.forEach((sale) => {
        if (sale.status === 'COMPLETED') {
          count += 1;
          const fv = sale.faceValue || 0;
          face += fv;
          earnings += fv * (activeRate / 100);
        }
      });
      return { face, earnings, count };
    })
  );

  let totalSales = 0;
  let totalAdminEarnings = 0;
  let totalTransactions = 0;
  salesResults.forEach((r) => {
    totalSales += r.face;
    totalAdminEarnings += r.earnings;
    totalTransactions += r.count;
  });

  return {
    appStatus: config,
    stats: {
      totalUsers,
      trialUsers,
      activeUsers,
      blockedUsers,
      totalSales,
      totalAdminEarnings,
      totalTransactions,
    },
  };
}

/**
 * Sales page: networks with full sales lists, all parallel.
 */
export async function fetchNetworkSales() {
  const [config, users] = await Promise.all([
    fetchGlobalConfig(),
    fetchAllUsers(),
  ]);
  const globalCommission = config.default_commission_rate || 5;

  const networks = await Promise.all(
    users.map(async (user) => {
      const [meta, sales] = await Promise.all([
        fetchNetworkMeta(user.uid),
        fetchSalesForUser(user.uid),
      ]);
      if (sales.length === 0) return null;

      const activeRate = resolveCommissionRate(user, globalCommission);
      return {
        uid: user.uid,
        networkName: meta.networkName,
        phoneNumber: meta.phoneNumber,
        commissionRate: activeRate,
        isCustomRate: user.commission_rate != null && user.commission_rate > 0,
        sales,
      };
    })
  );

  return networks.filter(Boolean);
}

/**
 * Notifications: users list with names only (parallel meta).
 */
export async function fetchUsersForSelect() {
  const users = await fetchAllUsers();
  const withNames = await Promise.all(
    users.map(async (u) => {
      const meta = await fetchNetworkMeta(u.uid);
      return { uid: u.uid, name: meta.networkName || u.uid };
    })
  );
  return withNames;
}
