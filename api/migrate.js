// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/migrate — مهاجرة قابلة للاستئناف (قرار ي1/ي2/ي3)
// ------------------------------------------------------------
//   action=classify-users  { cursor?, limit? } → تصنيف حقول الوصول الخادمية
//   action=rebuild-network { uid }             → إعادة بناء رصيد شبكة + مجاميعها
//   action=rebuild-all     { cursor?, limit? } → إعادة بناء كل الشبكات
//
// restartable وآمنة التكرار: cursor + كتابة قيم مطلقة. مدير موثّق فقط.
// لا تُشغَّل تلقائياً؛ تُستدعى يدوياً بعد موافقة المالك.
// ============================================================

import { getFirestore, FieldValue, Timestamp, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from '../server/_lib/firebaseAdmin.js';
import { planUserMigration, computeNetworkTotals, computeAggregate } from '../server/_lib/migration.js';
import { parseNetworkId } from '../server/_lib/networkId.js';
import { legacyAccessFields } from '../server/_lib/accessStatus.js';

export const MIGRATE_ACTIONS = ['classify-users', 'rebuild-network', 'rebuild-all', 'migrate-legacy-sales'];
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const READ_PAGE_SIZE = 300;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function toMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

export function validateMigrateInput(body) {
  const input = normalizeBody(body);
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  if (!MIGRATE_ACTIONS.includes(action)) return { ok: false, error: 'unknown_action' };

  const cursor = typeof input.cursor === 'string' && input.cursor.trim() ? input.cursor.trim() : null;
  const limit = input.limit === undefined ? DEFAULT_LIMIT : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: 'limit_invalid' };

  if (action === 'rebuild-network') {
    const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
    if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
    return { ok: true, value: { action, uid } };
  }
  if (action === 'migrate-legacy-sales') {
    const uid = typeof input.uid === 'string' && input.uid.trim() ? input.uid.trim() : null;
    if (uid && !UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
    return { ok: true, value: { action, uid, cursor, limit } };
  }
  return { ok: true, value: { action, cursor, limit } };
}

async function readAll(query) {
  const docs = [];
  let last = null;
  while (true) {
    let page = query.limit(READ_PAGE_SIZE);
    if (last) page = page.startAfter(last);
    const snap = await page.get();
    snap.docs.forEach((doc) => docs.push({ id: doc.id, ...doc.data() }));
    if (snap.size < READ_PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
}

function saleIdentityKeys(sale = {}) {
  return [
    ['saleUuid', sale.saleUuid],
    ['saleId', sale.saleId],
    ['documentId', sale.id],
  ].flatMap(([prefix, raw]) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value ? [`${prefix}:${value}`] : [];
  });
}

/** Prefer current networkId records and include only unique UID-path legacy sales. */
export function mergeSalesPreferCurrent(currentSales = [], legacySales = []) {
  const merged = [];
  const identityToIndex = new Map();
  for (const sale of [...currentSales, ...legacySales]) {
    const keys = saleIdentityKeys(sale);
    const existingIndex = keys.map((key) => identityToIndex.get(key)).find((index) => index !== undefined);
    if (existingIndex !== undefined) {
      keys.forEach((key) => identityToIndex.set(key, existingIndex));
      continue;
    }
    const index = merged.length;
    merged.push(sale);
    keys.forEach((key) => identityToIndex.set(key, index));
  }
  return merged;
}

function resolveRate(user, globalRate) {
  const rate = Number(user?.commission_rate);
  return user?.commission_rate != null && user.commission_rate !== '' && Number.isFinite(rate) ? rate : globalRate;
}

async function globalRate(db) {
  const snap = await db.collection('app_settings').doc('global_config').get();
  return Number(snap.data()?.default_commission_rate ?? 5) || 5;
}

async function classifyUsers(db, { cursor, limit, now, actorUid }) {
  let query = db.collection('users').orderBy(FieldPath.documentId()).limit(limit);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get();

  const planned = snap.docs.map((docSnap) => {
    const source = { uid: docSnap.id, ...(docSnap.data() || {}) };
    const previousEnd = toMillis(source.subscriptionEndsAt ?? source.subscription_end_date);
    const plan = planUserMigration({ ...source, subscriptionEndMs: previousEnd }, { now });
    const networkId = parseNetworkId(plan.networkId) ? plan.networkId : docSnap.id;
    return {
      docSnap,
      plan,
      endAt: Timestamp.fromMillis(plan.subscriptionEndsAt),
      networkId,
      networkRef: db.collection('networks').doc(networkId),
    };
  });
  const networkRefs = [...new Map(planned.map((item) => [item.networkRef.path, item.networkRef])).values()];
  const networkSnapshots = networkRefs.length ? await db.getAll(...networkRefs) : [];
  const networksByPath = new Map(networkSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
  const batch = db.batch();

  for (const item of planned) {
    const { docSnap, plan, endAt, networkId, networkRef } = item;
    const accessPatch = {
      accessStatus: plan.accessStatus,
      ...legacyAccessFields(plan.accessStatus, endAt),
      trialStartedAt: Timestamp.fromMillis(plan.trialStartedAt),
      subscriptionEndsAt: endAt,
      networkId,
      owner_uid: plan.ownerUid,
      migratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    batch.set(docSnap.ref, accessPatch, { merge: true });

    const networkSnapshot = networksByPath.get(networkRef.path);
    if (!networkSnapshot?.exists) continue;
    const network = networkSnapshot.data() || {};
    const belongsToUser = network.owner_uid === docSnap.id
      || (!network.owner_uid && networkId === docSnap.id);
    if (!belongsToUser) continue;
    batch.set(networkRef, {
      accessStatus: plan.accessStatus,
      ...legacyAccessFields(plan.accessStatus, endAt),
      trialStartedAt: Timestamp.fromMillis(plan.trialStartedAt),
      subscriptionEndsAt: endAt,
      networkId,
      owner_uid: plan.ownerUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  if (snap.size) await batch.commit();

  const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : null;
  await db.collection('admin_audit_logs').add({
    action: 'MIGRATION_CLASSIFY_USERS', actorUid, targetType: 'migration', targetId: cursor || 'start',
    details: { processed: snap.size, nextCursor }, createdAt: FieldValue.serverTimestamp(), createdAtMs: now,
  });
  return { status: 'classified', processed: snap.size, nextCursor, done: !nextCursor };
}

async function rebuildNetwork(db, { uid, now, actorUid, rate }) {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return { status: 'account_not_found' };
  const user = userSnap.data() || {};
  const networkId = parseNetworkId(user.networkId) ? user.networkId : uid;
  const networkRef = db.collection('networks').doc(networkId);
  const resolvedRate = resolveRate(user, rate);

  const [currentSales, legacySales, currentPayments, legacyPayments] = await Promise.all([
    readAll(networkRef.collection('sales')),
    networkId !== uid
      ? readAll(db.collection('networks').doc(uid).collection('sales'))
      : Promise.resolve([]),
    readAll(networkRef.collection('payments')),
    networkId !== uid
      ? readAll(db.collection('networks').doc(uid).collection('payments'))
      : Promise.resolve([]),
  ]);
  const sales = mergeSalesPreferCurrent(currentSales, legacySales);
  const paymentsById = new Map(currentPayments.map((payment) => [payment.id, payment]));
  legacyPayments.forEach((payment) => {
    if (!paymentsById.has(payment.id)) paymentsById.set(payment.id, payment);
  });
  const payments = [...paymentsById.values()];
  const totals = computeNetworkTotals(sales, payments, resolvedRate);
  const aggregate = computeAggregate(sales, resolvedRate);

  await networkRef.set({ ...totals, networkId, owner_uid: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection('admin_aggregates').doc(uid).set({
    ...aggregate,
    totalPaid: totals.totalPaidAmount,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: false });
  await db.collection('admin_audit_logs').add({
    action: 'MIGRATION_REBUILD_NETWORK', actorUid, targetType: 'network', targetId: uid,
    details: { networkId, totals }, createdAt: FieldValue.serverTimestamp(), createdAtMs: now,
  });
  return { status: 'rebuilt', uid, networkId, totals, aggregate: { totalFaceValue: aggregate.totalFaceValue, totalTransactions: aggregate.totalTransactions, totalCommissionDue: aggregate.totalCommissionDue } };
}

async function rebuildAll(db, { cursor, limit, now, actorUid, rate }) {
  let query = db.collection('users').orderBy(FieldPath.documentId()).limit(limit);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get();

  const results = [];
  for (const docSnap of snap.docs) {
    const result = await rebuildNetwork(db, { uid: docSnap.id, now, actorUid, rate });
    results.push({ uid: docSnap.id, status: result.status });
  }
  const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : null;
  return { status: 'rebuilt-all', processed: results.length, nextCursor, done: !nextCursor, results };
}

export async function migrateLegacySalesForUser(db, { uid, actorUid, now }) {
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    return { status: 'user_not_found', uid };
  }
  const userData = userDoc.data() || {};
  const rawNetId = String(userData.networkId || userData.network_id || '').trim();
  const networkId = rawNetId || uid;

  if (networkId === uid) {
    return {
      status: 'skipped_same_path',
      uid,
      networkId,
      message: 'المسار الموحد يطابق معرّف المستخدم؛ لا توجد حاجة للترحيل.',
      copiedCount: 0,
    };
  }

  // Read every page: the former 500/1000 document limits could silently omit
  // older sales and make the rebuilt totals look complete when they were not.
  const legacySales = await readAll(db.collection('networks').doc(uid).collection('sales'));
  if (legacySales.length === 0) {
    return { status: 'no_legacy_sales', uid, networkId, copiedCount: 0 };
  }

  const canonicalSales = await readAll(db.collection('networks').doc(networkId).collection('sales'));
  const canonicalKeys = new Set();
  canonicalSales.forEach((sale) => {
    if (sale.saleUuid) canonicalKeys.add(String(sale.saleUuid));
    if (sale.saleId) canonicalKeys.add(String(sale.saleId));
    canonicalKeys.add(sale.id);
  });

  const toCopy = [];
  legacySales.forEach((sale) => {
    const uuidKey = sale.saleUuid ? String(sale.saleUuid) : null;
    const idKey = sale.saleId ? String(sale.saleId) : null;
    if ((uuidKey && canonicalKeys.has(uuidKey)) || (idKey && canonicalKeys.has(idKey)) || canonicalKeys.has(sale.id)) return;
    toCopy.push(sale);
  });

  // Keep every Firestore batch under the 500-write limit.
  for (let offset = 0; offset < toCopy.length; offset += 450) {
    const batch = db.batch();
    toCopy.slice(offset, offset + 450).forEach((item) => {
      const targetRef = db.collection('networks').doc(networkId).collection('sales').doc(item.id);
      batch.set(targetRef, {
        ...item,
        migratedFromLegacyPath: true,
        legacyPath: `networks/${uid}/sales/${item.id}`,
        migratedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }

  await db.collection('admin_audit_logs').doc().set({
    action: 'MIGRATE_LEGACY_SALES',
    actorUid,
    targetType: 'network',
    targetId: networkId,
    details: {
      uid,
      networkId,
      legacyCount: legacySales.length,
      copiedCount: toCopy.length,
    },
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
  });

  return {
    status: 'migrated',
    uid,
    networkId,
    legacyCount: legacySales.length,
    copiedCount: toCopy.length,
  };
}

export async function migrateLegacySalesAll(db, { cursor, limit, now, actorUid }) {
  let query = db.collection('users').orderBy(FieldPath.documentId()).limit(limit);
  if (cursor) query = query.startAfter(cursor);
  const snap = await query.get();

  const results = [];
  for (const docSnap of snap.docs) {
    const res = await migrateLegacySalesForUser(db, { uid: docSnap.id, now, actorUid });
    results.push(res);
  }
  const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : null;
  return { status: 'migrated-legacy-sales-batch', processed: results.length, nextCursor, done: !nextCursor, results };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });
  const caller = await authenticateAdmin(req, { getAuth, getFirestore });
  if (!caller.ok) return res.status(caller.status).json({ success: false, error: caller.error });

  const parsed = validateMigrateInput(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

  const db = getFirestore();
  const now = Date.now();
  try {
    let result;
    if (parsed.value.action === 'classify-users') {
      result = await classifyUsers(db, { ...parsed.value, now, actorUid: caller.callerUid });
    } else if (parsed.value.action === 'rebuild-network') {
      result = await rebuildNetwork(db, { uid: parsed.value.uid, now, actorUid: caller.callerUid, rate: await globalRate(db) });
      if (result.status === 'account_not_found') return res.status(404).json({ success: false, error: 'account_not_found' });
    } else if (parsed.value.action === 'migrate-legacy-sales') {
      if (parsed.value.uid) {
        result = await migrateLegacySalesForUser(db, { uid: parsed.value.uid, now, actorUid: caller.callerUid });
        if (result.status === 'user_not_found') return res.status(404).json({ success: false, error: 'user_not_found' });
      } else {
        result = await migrateLegacySalesAll(db, { ...parsed.value, now, actorUid: caller.callerUid });
      }
    } else {
      result = await rebuildAll(db, { ...parsed.value, now, actorUid: caller.callerUid, rate: await globalRate(db) });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('migrate action failed', error);
    return res.status(500).json({ success: false, error: 'migration_failed' });
  }
}
