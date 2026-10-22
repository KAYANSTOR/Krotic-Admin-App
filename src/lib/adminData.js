import {
  collection, count, doc, getAggregateFromServer, getDoc, getDocFromServer, getDocs, getDocsFromServer, limit, onSnapshot, orderBy, query, startAt, sum, Timestamp, where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { toDate } from './format';
import { mapWithConcurrency } from './mapWithConcurrency';
import { createAdminDataCache, withAdminDataCacheMetadata } from './adminDataCache';
import { normalizeUserAccess } from './accessStatus';
import { summarizeCompletedSales } from './commission';
import { trackRead, trackSnapshot } from './localDb/readMeter';

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
  return readCached('global-config', async ({ force = false } = {}) => {
    const configRef = doc(db, 'app_settings', 'global_config');
    const snap = await trackRead('config:global', () => (force ? getDocFromServer(configRef) : getDoc(configRef)));
    return snap.exists() ? snap.data() : { default_commission_rate: 5, is_app_active: true };
  }, options);
}
function resolveCommissionRate(user, defaultRate) {
  const customRate = Number(user?.commission_rate);
  return user?.commission_rate != null && user.commission_rate !== '' && Number.isFinite(customRate)
    ? customRate
    : (Number.isFinite(Number(defaultRate)) ? Number(defaultRate) : 5);
}

/**
 * قائمة المدراء مع تخزين محلي. المدير لا يُغيَّر إلا عبر مسار المصادقة، لذا
 * نُبطل مفتاحه يدوياً بعد الإنشاء/الحذف (انظر invalidateAdminListData).
 */
export async function fetchAdmins(options) {
  return readCached('admins', async ({ force = false } = {}) => {
    const adminsRef = collection(db, 'Admins');
    const snap = await trackRead('admins:list', () => (force ? getDocsFromServer(adminsRef) : getDocs(adminsRef)));
    const admins = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    admins.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return admins;
  }, options);
}

/** أول صفحة من سجل العمليات مع تخزين محلي (الصفحات التالية تُدمج عند الطلب). */
export async function fetchAuditLogs(options) {
  return readCached('audit-logs', async ({ force = false } = {}) => {
    const auditQuery = query(
      collection(db, 'admin_audit_logs'),
      orderBy('createdAtMs', 'desc'),
      limit(30),
    );
    const snap = await trackRead('audit:initial-page', () => (force ? getDocsFromServer(auditQuery) : getDocs(auditQuery)));
    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // دمج تعارضات مبيعات الأجهزة الموثقة في sale_ingest_registry ضمن التدقيق
    try {
      const conflictQuery = query(
        collection(db, 'sale_ingest_registry'),
        limit(20)
      );
      const conflictSnap = await trackRead('audit:sale-conflicts', () => (force ? getDocsFromServer(conflictQuery) : getDocs(conflictQuery)));
      conflictSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const recordedMs = data.recordedAt?.toMillis?.() || Date.now();
        logs.push({
          id: `conflict_${doc.id}`,
          action: 'SALE_CONFLICT_DETECTED',
          targetType: 'sale',
          targetId: data.saleUuid || doc.id,
          targetLabel: data.reason === 'sale_id_payload_conflict'
            ? 'تعارض في محتوى البيع (تكرار معرّف مع تغيير بيانات)'
            : 'سجل قديم يحتاج مطابقة مع البصمة الخادمية',
          actorUid: data.uid || 'client:android',
          actorEmail: `عميل: ${data.uid || '—'}`,
          details: {
            saleUuid: data.saleUuid,
            reason: data.reason,
            incomingHash: data.incomingHash ? `${data.incomingHash.slice(0, 16)}...` : '—',
            previousHash: data.previousHash ? `${data.previousHash.slice(0, 16)}...` : '—',
          },
          createdAtMs: recordedMs,
          createdAt: data.recordedAt || null,
        });
      });
      logs.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    } catch {
      // safe fallback if permission or collection empty
    }

    return { logs, hasMore: snap.docs.length === 30 };
  }, options);
}

/** أول صفحة من الإشعارات مع تخزين محلي (تدمج سجل الإرسال الفعلي وإعدادات التطبيق). */
export async function fetchNotificationHistory(options) {
  return readCached('notification-history', async ({ force = false } = {}) => {
    const notifsMap = new Map();

    try {
      const delivQuery = query(
        collection(db, 'notification_deliveries'),
        orderBy('createdAt', 'desc'),
        limit(50),
      );
      const snap = await trackRead('notifications:deliveries', () => (force ? getDocsFromServer(delivQuery) : getDocs(delivQuery)));
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        const title = data.title || '';
        const body = data.body || data.message || '';
        const ts =
          (data.createdAt && typeof data.createdAt.toMillis === 'function' ? data.createdAt.toMillis() : null) ||
          data.timestamp ||
          data.createdAtMs ||
          Date.now();

        notifsMap.set(d.id, {
          id: d.id,
          ...data,
          title,
          message: body,
          body,
          status: data.status || 'sent',
          sentCount: data.sent ?? data.sentCount ?? 1,
          displayTimestamp: ts,
          timestamp: ts,
        });
      });
    } catch (err) {
      console.warn('Could not read notification_deliveries:', err);
    }

    const list = Array.from(notifsMap.values());
    list.sort((a, b) => (b.displayTimestamp || 0) - (a.displayTimestamp || 0));
    return list;
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
  return readCached(`network-meta:${uid}`, async ({ force = false } = {}) => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnapshot = await trackRead(`network-meta:user:${uid}`, () => (force ? getDocFromServer(userRef) : getDoc(userRef)));
      const userData = userSnapshot.exists() ? userSnapshot.data() : {};
      const networkId = networkDocumentId({ uid, ...userData });
      const fallbackName = userData.network_name || userData.networkName || userData.name || '';
      const fallbackPhone = userData.phone || userData.phoneNumber || '';
      const snap = await trackRead(`network-meta:details:${uid}`, () => getDoc(doc(db, 'networks', networkId, '_metadata', 'info')));
      if (snap.exists()) {
        const data = snap.data();
        return {
          networkName: data.name || data.networkName || fallbackName,
          phoneNumber: data.phoneNumber || data.phone || fallbackPhone,
        };
      }
      return { networkName: fallbackName, phoneNumber: fallbackPhone };
    } catch { /* optional */ }
    return { networkName: '', phoneNumber: '' };
  }, options);
}
function networkDocumentId(user) {
  return typeof user?.networkId === 'string' && user.networkId.trim() ? user.networkId.trim() : user.uid;
}
async function fetchSalesForUser(uid, recentOnly = false, options) {
  return readCached(`sales:${uid}:${recentOnly ? 'recent' : 'all'}`, async ({ force = false } = {}) => {
    const userRef = doc(db, 'users', uid);
    const userSnapshot = await trackRead(`sales:user:${uid}`, () => (force ? getDocFromServer(userRef) : getDoc(userRef)));
    const networkId = networkDocumentId(userSnapshot.exists() ? { uid, ...userSnapshot.data() } : { uid });
    const ref = collection(db, 'networks', networkId, 'sales');
    const salesQuery = recentOnly ? query(ref, orderBy('createdAt', 'desc'), limit(50)) : ref;
    const snap = await trackRead(`sales:network:${uid}`, () => (force ? getDocsFromServer(salesQuery) : getDocs(salesQuery)));
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
    const userRef = doc(db, 'users', uid);
    const userSnapshot = await trackRead(`billing:user:${uid}`, () => (force ? getDocFromServer(userRef) : getDoc(userRef)));
    const networkId = networkDocumentId(userSnapshot.exists() ? { uid, ...userSnapshot.data() } : { uid });
    const salesRef = collection(db, 'networks', networkId, 'sales');
    const paymentsRef = collection(db, 'networks', networkId, 'payments');
    const paymentsCursor = Number(cachedValue?.paymentsCursor?.millis);
    // Offline sales may arrive after a newer sale while carrying an older
    // createdAt. A createdAt cursor would silently omit those late-arriving
    // records, so the customer's full history is re-read on each load.
    const incrementalPayments = !force && Array.isArray(cachedValue?.payments) && Number.isFinite(paymentsCursor);
    const salesConstraints = [where('status', '==', 'COMPLETED'), orderBy('createdAt', 'asc')];
    const paymentConstraints = [orderBy('timestamp', 'asc')];
    if (incrementalPayments) paymentConstraints.push(startAt(Timestamp.fromMillis(paymentsCursor)));
    const readQuery = (label, firestoreQuery) => trackRead(label, () => (force
      ? getDocsFromServer(firestoreQuery)
      : getDocs(firestoreQuery)));
    const [salesSnapshot, paymentsSnapshot] = await Promise.all([
      readQuery(`billing:sales:${uid}`, query(salesRef, ...salesConstraints)),
      readQuery(`billing:payments:${uid}`, query(paymentsRef, ...paymentConstraints)),
    ]);
    const incomingSales = salesSnapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
    const incomingPayments = paymentsSnapshot.docs.map((paymentDoc) => ({ id: paymentDoc.id, ...paymentDoc.data() }));
    const sales = incomingSales;
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
  return readCached('all-users', async ({ force = false } = {}) => {
    const usersMap = new Map();

    // 1. Load users from canonical 'users' collection
    try {
      const usersRef = collection(db, 'users');
      const snap = await trackRead('users:canonical', () => (force ? getDocsFromServer(usersRef) : getDocs(usersRef)));
      snap.docs.forEach((userDoc) => {
        const data = userDoc.data() || {};
        const netName =
          data.network_name ||
          data.networkName ||
          data.name ||
          data.displayName ||
          data.networkTitle ||
          data.network ||
          data.username ||
          '';
        const phone = data.phone || data.phoneNumber || data.mobile || data.phone_number || '';
        const normalized = normalizeUserAccess({
          uid: userDoc.id,
          ...data,
          networkName: netName || `مشترك (${userDoc.id.slice(0, 8)})`,
          network_name: netName || `مشترك (${userDoc.id.slice(0, 8)})`,
          phoneNumber: phone,
          phone: phone,
        });
        usersMap.set(userDoc.id, normalized);
      });
    } catch (err) {
      console.warn('Error fetching users collection:', err);
    }

    // 2. Discover and merge all network records from 'networks' collection
    try {
      const networksRef = collection(db, 'networks');
      const netSnap = await trackRead('networks:list', () => (force ? getDocsFromServer(networksRef) : getDocs(networksRef)));
      netSnap.docs.forEach((netDoc) => {
        const netData = netDoc.data() || {};
        const ownerUid = String(netData.owner_uid || netData.ownerUid || netData.uid || netData.userId || netDoc.id).trim();
        const netName = netData.networkName || netData.network_name || netData.name || netData.networkTitle || `شبكة ${netDoc.id}`;
        const phone = netData.phone || netData.phoneNumber || netData.mobile || '';

        if (ownerUid) {
          if (usersMap.has(ownerUid)) {
            // Merge network ID and metadata into existing user document
            const existing = usersMap.get(ownerUid);
            usersMap.set(ownerUid, {
              ...existing,
              networkId: existing.networkId || netDoc.id,
              networkName: existing.networkName && !existing.networkName.startsWith('مشترك (') ? existing.networkName : netName,
              network_name: existing.network_name && !existing.network_name.startsWith('مشترك (') ? existing.network_name : netName,
              phoneNumber: existing.phoneNumber || phone,
              phone: existing.phone || phone,
              is_active: existing.is_active ?? netData.is_active ?? true,
              is_trial: existing.is_trial ?? netData.is_trial ?? false,
              accessStatus: existing.accessStatus || netData.accessStatus || (netData.is_trial ? 'TRIAL' : 'ACTIVE_PAID'),
              subscription_end_date: existing.subscription_end_date || netData.subscription_end_date || netData.subscriptionEndsAt || null,
            });
          } else {
            // Add user from network document
            usersMap.set(ownerUid, normalizeUserAccess({
              uid: ownerUid,
              networkId: netDoc.id,
              networkName: netName,
              network_name: netName,
              phoneNumber: phone,
              phone: phone,
              is_active: netData.is_active ?? true,
              is_trial: netData.is_trial ?? false,
              accessStatus: netData.accessStatus || (netData.is_trial ? 'TRIAL' : 'ACTIVE_PAID'),
              subscription_end_date: netData.subscription_end_date || netData.subscriptionEndsAt || null,
            }));
          }
        }
      });
    } catch (err) {
      console.warn('Error fetching networks collection in fetchAllUsers:', err);
    }

    // 3. Fallback discovery from capitalized 'Users' collection if any client created documents there
    try {
      const usersCapRef = collection(db, 'Users');
      const capSnap = await trackRead('users:legacy-capitalized', () => (force ? getDocsFromServer(usersCapRef) : getDocs(usersCapRef)));
      capSnap.docs.forEach((userDoc) => {
        if (!usersMap.has(userDoc.id)) {
          const data = userDoc.data() || {};
          const netName = data.network_name || data.networkName || data.name || data.displayName || `مشترك (${userDoc.id.slice(0, 8)})`;
          const phone = data.phone || data.phoneNumber || data.mobile || '';
          usersMap.set(userDoc.id, normalizeUserAccess({
            uid: userDoc.id,
            ...data,
            networkName: netName,
            network_name: netName,
            phoneNumber: phone,
            phone: phone,
          }));
        }
      });
    } catch {}

    // 4. Mزامنة وإظهار كافة المستخدمين المسجلين في Firebase Auth الذين قد تنقصهم مستندات Firestore
    if (auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch('/api/admin-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ action: 'sync-auth-users' }),
        });
        if (res.ok) {
          const syncResult = await res.json();
          if (syncResult?.success && Array.isArray(syncResult.users)) {
            syncResult.users.forEach((u) => {
              if (usersMap.has(u.uid)) {
                const existing = usersMap.get(u.uid);
                usersMap.set(u.uid, {
                  ...existing,
                  networkId: existing.networkId || u.networkId,
                  networkName: existing.networkName || u.networkName,
                  network_name: existing.network_name || u.network_name,
                  phoneNumber: existing.phoneNumber || u.phoneNumber || u.phone,
                  phone: existing.phone || u.phone,
                });
              } else {
                usersMap.set(u.uid, normalizeUserAccess(u));
              }
            });
          }
        }
      } catch (authSyncErr) {
        console.warn('Sync auth users in fetchAllUsers failed:', authSyncErr);
      }
    }

    return Array.from(usersMap.values());
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
async function fetchAggregateFromFirestore(uid, { force = false } = {}) {
  const userRef = doc(db, 'users', uid);
  const userSnapshot = await trackRead(`aggregate:user:${uid}`, () => (force ? getDocFromServer(userRef) : getDoc(userRef)));
  const networkId = networkDocumentId(userSnapshot.exists() ? { uid, ...userSnapshot.data() } : { uid });
  const salesRef = collection(db, 'networks', networkId, 'sales');
  const completedQuery = query(salesRef, where('status', '==', 'COMPLETED'));
  const paymentsRef = collection(db, 'networks', networkId, 'payments');

  // This path is used only when the server aggregate document is absent.
  // Reading the completed sales once lets us report verified server commission
  // snapshots rather than silently setting the due amount to zero.
  const [salesSnapshot, paymentsAggregate] = await Promise.all([
    trackRead(`aggregate:sales:${uid}`, () => (force ? getDocsFromServer(completedQuery) : getDocs(completedQuery))),
    trackRead(`aggregate:payments:${uid}`, () => getAggregateFromServer(paymentsRef, { totalPaid: sum('amount') })),
  ]);
  const sales = salesSnapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }));
  const totals = summarizeCompletedSales(sales);
  const totalPaid = Number(paymentsAggregate.data().totalPaid) || 0;
  const minRecentDate = sixMonthsAgo();
  const monthly = buildMonthlyBuckets(sales.filter((sale) => {
    const date = toDate(sale.createdAt);
    return date && !Number.isNaN(date.getTime()) && date >= minRecentDate;
  }));

  return {
    totalFaceValue: totals.reportedSalesValue,
    totalTransactions: totals.reportedTransactions,
    totalCommissionDue: totals.commissionDue,
    totalPaid,
    monthly,
    monthlyAvailable: true,
    source: 'aggregation-fallback',
  };
}
async function fetchMonthlyBucketsFromFirestore(uid, { force = false } = {}) {
  const userRef = doc(db, 'users', uid);
  const userSnapshot = await trackRead(`aggregate:monthly-user:${uid}`, () => (force ? getDocFromServer(userRef) : getDoc(userRef)));
  const networkId = networkDocumentId(userSnapshot.exists() ? { uid, ...userSnapshot.data() } : { uid });
  const salesRef = collection(db, 'networks', networkId, 'sales');
  // Equality-only query uses Firestore's single-field index; avoid depending on
  // the composite status+createdAt index just to recover a missing summary.
  const completedQuery = query(salesRef, where('status', '==', 'COMPLETED'));
  const salesSnapshot = await trackRead(`aggregate:monthly-sales:${uid}`, () => (force ? getDocsFromServer(completedQuery) : getDocs(completedQuery)));
  const minRecentDate = sixMonthsAgo();
  const recentSales = salesSnapshot.docs
    .map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() }))
    .filter((sale) => {
      const date = toDate(sale.createdAt);
      return date && !Number.isNaN(date.getTime()) && date >= minRecentDate;
    });
  return buildMonthlyBuckets(recentSales);
}
async function fetchAggregate(uid, options) {
  return readCached(`aggregate:${uid}`, async ({ force = false } = {}) => {
    const aggregateRef = doc(db, 'admin_aggregates', uid);
    const snap = await trackRead(`aggregate:summary:${uid}`, () => (force ? getDocFromServer(aggregateRef) : getDoc(aggregateRef)));
    let aggregate;
    if (!snap.exists()) {
      aggregate = await fetchAggregateFromFirestore(uid, { force });
    } else {
      const data = snap.data() || {};
      const hasMonthly = Object.hasOwn(data, 'monthly')
        && data.monthly !== null
        && typeof data.monthly === 'object'
        && !Array.isArray(data.monthly);
      if (hasMonthly) {
        aggregate = { ...data, monthlyAvailable: true, source: 'aggregate' };
      } else {
        // Keep verified lifetime totals even if repairing the historical monthly
        // breakdown fails. Never replace missing values with fabricated zeros.
        try {
          const monthly = await fetchMonthlyBucketsFromFirestore(uid, { force });
          aggregate = { ...data, monthly, monthlyAvailable: true, source: 'aggregate+monthly-rebuild' };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          aggregate = {
            ...data,
            monthly: {},
            monthlyAvailable: false,
            monthlyError: `Monthly breakdown rebuild failed for user ${uid}: ${detail}`,
            source: 'aggregate',
          };
        }
      }
    }
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
  const commissionDue = Number(aggregate.totalCommissionDue) || 0;
  const recordedPayments = Number(aggregate.totalPaid) || 0;
  return {
    ...user,
    ...meta,
    reportedSalesValue: Number(aggregate.totalFaceValue) || 0,
    reportedTransactions: Number(aggregate.totalTransactions) || 0,
    recordedPayments,
    commissionDue,
    // ما يظهر للمدير هو العمولة غير المسوّاة فقط؛ المسوّاة تظهر في سجل العميل.
    outstandingCommission: Math.max(0, commissionDue - recordedPayments),
  };
}
export async function fetchUsersWithBilling(options) {
  return readCached('users-with-billing', async (loaderContext) => {
    const childOptions = nestedReadOptions(options, loaderContext);
    const [config, users] = await Promise.all([fetchGlobalConfig(childOptions), fetchAllUsers(childOptions)]);
    const { values: enrichedUsers, errors } = await mapUsersSoft(users, 'Billing data', (user) => enrichUserForBilling(user, childOptions));
    // Keep every user row; a failed network shows zeroed aggregates but is still
    // listed, and the error is reported so the UI can flag incomplete data.
    const completeUsers = enrichedUsers.map((enriched, index) => {
      const u = users[index];
      const fallbackNetName = u?.network_name || u?.networkName || u?.name || '';
      const fallbackPhone = u?.phone || u?.phoneNumber || '';
      if (!enriched) {
        return {
          ...u,
          networkName: fallbackNetName,
          phoneNumber: fallbackPhone,
          reportedSalesValue: 0,
          reportedTransactions: 0,
          recordedPayments: 0,
        };
      }
      return {
        ...enriched,
        networkName: enriched.networkName || fallbackNetName,
        phoneNumber: enriched.phoneNumber || fallbackPhone,
      };
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
    const totals = { totalSales: 0, totalTransactions: 0, totalCommission: 0, totalPaid: 0, totalCommissionOutstanding: 0 }; const buckets = {};
    aggregates.forEach((aggregate) => {
      const due = Number(aggregate.totalCommissionDue) || 0;
      const paid = Number(aggregate.totalPaid) || 0;
      totals.totalSales += Number(aggregate.totalFaceValue) || 0; totals.totalTransactions += Number(aggregate.totalTransactions) || 0; totals.totalCommission += due; totals.totalPaid += paid; totals.totalCommissionOutstanding += Math.max(0, due - paid);
      Object.entries(aggregate.monthly || {}).forEach(([key, value]) => { const b = buckets[key] || { face: 0, count: 0 }; b.face += Number(value.face) || 0; b.count += Number(value.count) || 0; buckets[key] = b; });
    });
    const warningDays = Number(config.warning_days_before_expiry) > 0 ? Number(config.warning_days_before_expiry) : 5; const now = Date.now(); let expiredUsers = 0; let expiringSoonUsers = 0; let trialExpiringSoonUsers = 0;
    users.forEach((user) => { const end = toDate(user.subscription_end_date); if (!end || Number.isNaN(end.getTime())) return; const remaining = end.getTime() - now; if (remaining < 0) expiredUsers += 1; else if (remaining <= warningDays * DAY_MS) { expiringSoonUsers += 1; if (user.is_trial === true) trialExpiringSoonUsers += 1; } });
    const monthlyErrors = aggregates
      .filter((aggregate) => aggregate.monthlyAvailable === false && aggregate.monthlyError)
      .map((aggregate) => aggregate.monthlyError);
    const allErrors = [...errors, ...monthlyErrors];
    const value = { appStatus: config, stats: { totalUsers: users.length, trialUsers: users.filter((u) => u.is_trial === true).length, activeUsers: users.filter((u) => u.is_active !== false).length, blockedUsers: users.filter((u) => u.is_active === false).length, ...totals }, alerts: { expiredUsers, expiringSoonUsers, trialExpiringSoonUsers, warningDays }, monthlySales: recentMonths(buckets, 6), monthlyDataWarning: allErrors.length > 0 || aggregates.some((aggregate) => aggregate.monthlyAvailable === false) };
    return allErrors.length ? partialResult(value, allErrors) : value;
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
      const commissionRate = resolveCommissionRate(user, defaultCommissionRate);
      return { uid: user.uid, networkName: meta.networkName, phoneNumber: meta.phoneNumber, sales, commissionRate };
    });
    const value = rawNetworks.filter(Boolean);
    return errors.length ? partialResult(value, errors) : value;
  }, options);
}
/**
 * Streams all sale records for every registered network. Each subscription is
 * scoped to one network's sales collection, so Firestore rules can authorize
 * the same path the admin already reads for the initial page load.
 */
export function subscribeNetworkSalesRealtime(onUpdate, onError, onReady, { includePaymentTotals = false } = {}) {
  let active = true;
  let defaultCommissionRate = 5;
  let usersUnsubscribe = null;
  let configUnsubscribe = null;
  let initialNetworkIds = null;
  let readyCalled = false;
  const usersByUid = new Map();
  const metadataByUid = new Map();
  const salesByUid = new Map();
  const paymentTotalsByUid = new Map();
  const salesCacheByUid = new Map();
  const ledgerCacheByUid = new Map();
  const salesUnsubscribers = new Map();
  const ledgerUnsubscribers = new Map();
  const initialSalesSnapshots = new Set();
  const initialLedgerSnapshots = new Set();

  const reportError = (error, uid = '') => {
    if (active) onError?.(error, uid);
  };
  const isReady = () => initialNetworkIds !== null
    && [...initialNetworkIds].every((uid) => (
      initialSalesSnapshots.has(uid)
      && (!includePaymentTotals || initialLedgerSnapshots.has(uid))
    ));

  const publish = (newSales = []) => {
    if (!active) return;
    const networks = [];
    usersByUid.forEach((user, uid) => {
      const sales = salesByUid.get(uid) || [];
      if (!sales.length && !(includePaymentTotals && (paymentTotalsByUid.get(uid) || 0) > 0)) return;
      const meta = metadataByUid.get(uid) || { networkName: '', phoneNumber: '' };
      networks.push({
        uid,
        networkName: meta.networkName,
        phoneNumber: meta.phoneNumber,
        sales,
        commissionRate: resolveCommissionRate(user, defaultCommissionRate),
        // The network ledger is the authoritative source for actual recorded payments.
        recordedPayments: includePaymentTotals && paymentTotalsByUid.has(uid) ? paymentTotalsByUid.get(uid) : undefined,
      });
    });

    const allUids = [...usersByUid.keys()];
    const fromCache = allUids.some((uid) => (
      salesCacheByUid.get(uid) !== false
      || (includePaymentTotals && ledgerCacheByUid.get(uid) !== false)
    ));
    const expectedCount = initialNetworkIds?.size ?? null;
    const initialSnapshotsCount = initialSalesSnapshots.size;
    const initialLedgerSnapshotsCount = initialLedgerSnapshots.size;
    const ready = isReady();

    // Publish loaded networks progressively; the user list can track financial
    // indicators from sales plus the canonical network-level payment ledger.
    onUpdate(networks, {
      fromCache,
      ready,
      expectedCount,
      initialSnapshotsCount,
      initialPaymentSnapshotsCount: includePaymentTotals ? initialLedgerSnapshotsCount : null,
      includesPaymentLedger: includePaymentTotals,
    }, newSales);

    if (!readyCalled && ready) {
      readyCalled = true;
      onReady?.();
    }
  };

  const startSalesSubscription = (uid, networkId) => {
    if (salesUnsubscribers.has(uid)) return;
    fetchNetworkMeta(uid).then((meta) => {
      if (!active || !usersByUid.has(uid)) return;
      metadataByUid.set(uid, meta);
      publish();
    }).catch((error) => reportError(error, uid));

    const unsubscribe = onSnapshot(
      collection(db, 'networks', networkId, 'sales'),
      { includeMetadataChanges: true },
      (snapshot) => {
        trackSnapshot(`realtime:sales:${uid}`, snapshot, { initial: !initialSalesSnapshots.has(uid) });
        if (!active || !usersByUid.has(uid)) return;
        const isInitialSnapshot = !initialSalesSnapshots.has(uid);
        const latestUser = usersByUid.get(uid);
        const meta = metadataByUid.get(uid) || { networkName: '', phoneNumber: '' };
        const newSales = isInitialSnapshot ? [] : snapshot.docChanges()
          .filter((change) => change.type === 'added')
          .map((change) => ({
            uid,
            networkName: meta.networkName,
            faceValue: Number(change.doc.data().faceValue) || 0,
            status: change.doc.data().status || '',
            commissionRiyal: change.doc.data().commissionRiyal ?? change.doc.data().commission ?? change.doc.data().commissionAmount ?? change.doc.data().commissionMinor ?? null,
            commissionMinor: change.doc.data().commissionMinor ?? change.doc.data().commission ?? null,
            commissionRate: resolveCommissionRate(latestUser, defaultCommissionRate),
          }));
        salesByUid.set(uid, snapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() })));
        salesCacheByUid.set(uid, snapshot.metadata.fromCache);
        initialSalesSnapshots.add(uid);
        publish(newSales);
      },
      (error) => {
        reportError(error, uid);
        initialSalesSnapshots.add(uid);
        publish();
      },
    );
    salesUnsubscribers.set(uid, unsubscribe);
  };

  const startFinancialLedgerSubscription = (uid, networkId) => {
    if (ledgerUnsubscribers.has(uid)) return;
    const unsubscribe = onSnapshot(
      doc(db, 'networks', networkId),
      { includeMetadataChanges: true },
      (snapshot) => {
        trackSnapshot(`realtime:ledger:${uid}`, snapshot, { initial: !initialLedgerSnapshots.has(uid) });
        if (!active || !usersByUid.has(uid)) return;
        const data = snapshot.exists() ? (snapshot.data() || {}) : {};
        paymentTotalsByUid.set(uid, Math.max(0, Number(data.totalPaidAmount ?? data.totalPaid) || 0));
        ledgerCacheByUid.set(uid, snapshot.metadata.fromCache);
        initialLedgerSnapshots.add(uid);
        publish();
      },
      (error) => {
        reportError(error, uid);
        initialLedgerSnapshots.add(uid);
        publish();
      },
    );
    ledgerUnsubscribers.set(uid, unsubscribe);
  };

  let initialUsersSnapshot = true;
  usersUnsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
    trackSnapshot('realtime:users', snapshot, { initial: initialUsersSnapshot });
    initialUsersSnapshot = false;
    if (!active) return;
    const currentUids = new Set(snapshot.docs.map((userDoc) => userDoc.id));
    if (initialNetworkIds === null || !readyCalled) initialNetworkIds = new Set(currentUids);

    for (const [uid, unsubscribe] of salesUnsubscribers) {
      if (currentUids.has(uid)) continue;
      unsubscribe();
      salesUnsubscribers.delete(uid);
      salesByUid.delete(uid);
      salesCacheByUid.delete(uid);
      initialSalesSnapshots.delete(uid);
    }
    for (const [uid, unsubscribe] of ledgerUnsubscribers) {
      if (currentUids.has(uid)) continue;
      unsubscribe();
      ledgerUnsubscribers.delete(uid);
      paymentTotalsByUid.delete(uid);
      ledgerCacheByUid.delete(uid);
      initialLedgerSnapshots.delete(uid);
    }
    for (const uid of [...usersByUid.keys()]) {
      if (currentUids.has(uid)) continue;
      usersByUid.delete(uid);
      metadataByUid.delete(uid);
    }

    snapshot.docs.forEach((userDoc) => {
      const user = { uid: userDoc.id, ...userDoc.data() };
      usersByUid.set(userDoc.id, user);
      const networkId = networkDocumentId(user);
      startSalesSubscription(userDoc.id, networkId);
      if (includePaymentTotals) startFinancialLedgerSubscription(userDoc.id, networkId);
    });
    publish();
  }, (error) => {
    reportError(error);
    if (!readyCalled) {
      readyCalled = true;
      onReady?.();
    }
  });

  let initialConfigSnapshot = true;
  configUnsubscribe = onSnapshot(doc(db, 'app_settings', 'global_config'), (snapshot) => {
    trackSnapshot('realtime:config', snapshot, { initial: initialConfigSnapshot });
    initialConfigSnapshot = false;
    if (!active) return;
    defaultCommissionRate = snapshot.exists()
      ? Number(snapshot.data().default_commission_rate ?? 5)
      : 5;
    publish();
  }, (error) => reportError(error));

  return () => {
    active = false;
    usersUnsubscribe?.();
    configUnsubscribe?.();
    salesUnsubscribers.forEach((unsubscribe) => unsubscribe());
    ledgerUnsubscribers.forEach((unsubscribe) => unsubscribe());
    salesUnsubscribers.clear();
    ledgerUnsubscribers.clear();
    salesCacheByUid.clear();
    ledgerCacheByUid.clear();
  };
}
export async function fetchUsersForSelect(options) {
  return readCached('users-for-select', async (loaderContext) => {
    const childOptions = nestedReadOptions(options, loaderContext);
    const users = await fetchAllUsers(childOptions);
    return mapUsersWithLimit(users, 'User selector', async (user) => {
      const meta = await fetchNetworkMeta(user.uid, childOptions);
      const name = meta.networkName || user.networkName || user.network_name || user.name || `مشترك (${user.uid.slice(0, 8)})`;
      const phone = meta.phoneNumber || user.phoneNumber || user.phone || '';
      return {
        uid: user.uid,
        name,
        phone,
        networkName: name,
        phoneNumber: phone,
      };
    });
  }, options);
}
