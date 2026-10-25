import {
  aggregateMapByUid,
  buildDashboardReport,
  buildNetworkReport,
  mergeUsersWithNetworks,
  normalizeNotificationRow,
  paymentsForNetwork,
  readAllRows,
  readGlobalConfig,
  salesForNetwork,
  sortAuditDesc,
  sortNotificationsDesc,
  sortSalesByCreatedDesc,
} from './localQueries.js';

/**
 * واجهة البيانات المحلية: تحل محل `adminData.js` في الشاشات.
 * كل الدوال تقرأ من القاعدة المحلية فقط (IndexedDB)، بلا أي استعلام Firestore.
 */

/** يحمّل المستخدمين مع دمج مستندات الشبكات. */
export async function loadLocalUsers(localDb) {
  const [userRows, networkRows] = await Promise.all([
    readAllRows(localDb, 'users'),
    readAllRows(localDb, 'networks'),
  ]);
  return mergeUsersWithNetworks(userRows, networkRows);
}

/** يحمّل الإعدادات العامة. */
export async function loadLocalConfig(localDb) {
  return readGlobalConfig(localDb);
}

/** قائمة مبسّطة لاختيار حساب (اسم/هاتف/شبكة) من القاعدة المحلية. */
export async function loadLocalUserOptions(localDb) {
  const users = await loadLocalUsers(localDb);
  return users.map((user) => {
    const name = user.networkName || user.network_name || user.name
      || `مشترك (${String(user.uid).slice(0, 8)})`;
    const phone = user.phoneNumber || user.phone || '';
    return {
      uid: user.uid,
      name,
      phone,
      networkName: name,
      phoneNumber: phone,
    };
  });
}

/** يحمّل تقرير لوحة التحكم. */
export async function loadLocalDashboard(localDb) {
  const [users, aggregates, salesRows, paymentRows, config] = await Promise.all([
    loadLocalUsers(localDb),
    readAllRows(localDb, 'aggregates'),
    readAllRows(localDb, 'sales'),
    readAllRows(localDb, 'payments'),
    readGlobalConfig(localDb),
  ]);
  return buildDashboardReport({ users, aggregates, salesRows, paymentRows, config });
}

/** يحمّل المستخدمين مع تقريرهم المالي. */
export async function loadLocalUsersWithBilling(localDb) {
  const [users, aggregates, salesRows, paymentRows, config] = await Promise.all([
    loadLocalUsers(localDb),
    readAllRows(localDb, 'aggregates'),
    readAllRows(localDb, 'sales'),
    readAllRows(localDb, 'payments'),
    readGlobalConfig(localDb),
  ]);
  const aggregateMap = aggregateMapByUid(aggregates);
  const defaultCommissionRate = Number(config.default_commission_rate ?? 5);
  const enriched = users.map((user) => {
    const networkId = user.networkId || user.uid;
    return buildNetworkReport({
      user,
      sales: salesForNetwork(salesRows, networkId, user.uid),
      payments: paymentsForNetwork(paymentRows, networkId, user.uid),
      aggregate: aggregateMap.get(user.uid),
      defaultCommissionRate,
    });
  });
  return { users: enriched, globalConfig: config };
}

/** يحمّل قائمة الشبكات مع مبيعاتها (لصفحة المبيعات). */
export async function loadLocalNetworkSales(localDb) {
  const { users, globalConfig } = await loadLocalUsersWithBilling(localDb);
  const salesRows = await readAllRows(localDb, 'sales');
  const defaultCommissionRate = Number(globalConfig.default_commission_rate ?? 5);

  const networks = users
    .map((user) => {
      const networkId = user.networkId || user.uid;
      const sales = sortSalesByCreatedDesc(salesForNetwork(salesRows, networkId, user.uid));
      if (!sales.length) return null;
      return {
        uid: user.uid,
        networkName: user.networkName || user.network_name || '',
        phoneNumber: user.phoneNumber || user.phone || '',
        sales,
        commissionRate: Number(user.commission_rate) || defaultCommissionRate,
        recordedPayments: user.recordedPayments,
      };
    })
    .filter(Boolean);

  return networks;
}

/** يحمّل سجل الإشعارات. */
export async function loadLocalNotifications(localDb) {
  const rows = await readAllRows(localDb, 'notifications');
  return sortNotificationsDesc(rows.map(normalizeNotificationRow));
}

/** يحمّل سجل التدقيق (آخر 200 سجل محلياً). */
export async function loadLocalAuditLogs(localDb, limit = 200) {
  const rows = await readAllRows(localDb, 'audit_logs');
  return sortAuditDesc(rows).slice(0, limit);
}

/** يحمّل قائمة المدراء. */
export async function loadLocalAdmins(localDb) {
  const rows = await readAllRows(localDb, 'admins');
  return [...rows].sort((a, b) => (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0));
}

/** يحمّل تاريخ فوترة شبكة واحدة. */
export async function loadLocalBillingHistory(localDb, uid) {
  const [users, salesRows, paymentRows] = await Promise.all([
    readAllRows(localDb, 'users'),
    readAllRows(localDb, 'sales'),
    readAllRows(localDb, 'payments'),
  ]);
  const user = users.find((row) => row.uid === uid);
  const networkId = user?.networkId || uid;
  return {
    sales: sortSalesByCreatedDesc(salesForNetwork(salesRows, networkId, uid)),
    payments: paymentsForNetwork(paymentRows, networkId, uid),
  };
}
