// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/migrate — مهاجرة قابلة للاستئناف (قرار ي1/ي2/ي3)
// ------------------------------------------------------------
//   action=classify-users             { cursor?, limit? } → تصنيف حقول الوصول الخادمية
//   action=rebuild-network            { uid }             → إعادة بناء رصيد شبكة + مجاميعها
//   action=reconcile-legacy-commissions { uid }            → إعادة احتساب عمولات مبيعات Android القديمة
//   action=rebuild-all                { cursor?, limit? } → إعادة بناء كل الشبكات
//
// restartable وآمنة التكرار: cursor + كتابة قيم مطلقة. مدير موثّق فقط.
// لا تُشغَّل تلقائياً؛ تُستدعى يدوياً بعد موافقة المالك.
// ============================================================

import { getFirestore, FieldValue, Timestamp, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ensureFirebaseAdmin, authenticateAdmin } from './_lib/firebaseAdmin.js';
import {
  planUserMigration,
  computeNetworkTotals,
  computeAggregate,
  isLegacyCommissionCandidate,
  saleCommissionMinor,
} from './_lib/migration.js';
import { parseNetworkId } from './_lib/networkId.js';
import { legacyAccessFields } from './_lib/accessStatus.js';
import { percentToBps } from './_lib/money.js';

export const MIGRATE_ACTIONS = ['classify-users', 'rebuild-network', 'reconcile-legacy-commissions', 'rebuild-all'];
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_DOCS_PER_NETWORK = 2000;
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

  if (action === 'rebuild-network' || action === 'reconcile-legacy-commissions') {
    const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
    if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
    return { ok: true, value: { action, uid } };
  }
  return { ok: true, value: { action, cursor, limit } };
}

async function readAll(query, cap = MAX_DOCS_PER_NETWORK) {
  const docs = [];
  let last = null;
  while (docs.length < cap) {
    let page = query.limit(300);
    if (last) page = page.startAfter(last);
    const snap = await page.get();
    snap.docs.forEach((doc) => docs.push({ id: doc.id, ...doc.data() }));
    if (snap.size < 300) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs.slice(0, cap);
}

async function readSalesForReconciliation(salesCollection, cap = MAX_DOCS_PER_NETWORK) {
  const query = salesCollection.orderBy(FieldPath.documentId());
  const docs = [];
  let last = null;
  while (docs.length < cap) {
    const pageSize = Math.min(300, cap - docs.length);
    let page = query.limit(pageSize);
    if (last) page = page.startAfter(last);
    const snap = await page.get();
    snap.docs.forEach((doc) => docs.push({ ...doc.data(), id: doc.id }));
    if (snap.size < pageSize) return { sales: docs, truncated: false };
    last = snap.docs[snap.docs.length - 1];
  }
  const extra = await query.startAfter(last).limit(1).get();
  return { sales: docs, truncated: extra.size > 0 };
}

function resolveRate(user, globalRate) {
  const rate = Number(user?.commission_rate);
  return user?.commission_rate != null && user.commission_rate !== '' && Number.isFinite(rate) ? rate : globalRate;
}

async function globalRate(db) {
  const snap = await db.collection('app_settings').doc('global_config').get();
  const configuredRate = Number(snap.data()?.default_commission_rate ?? 5);
  return Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : 5;
}

export async function reconcileLegacyCommissionData(db, { uid, globalCommissionRate, actorUid, now }) {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return { status: 'account_not_found' };

  const user = userSnap.data() || {};
  const networkId = parseNetworkId(user.networkId) ? user.networkId : uid;
  const customRate = Number(user.commission_rate);
  const hasCustomRate = user.commission_rate != null
    && user.commission_rate !== ''
    && Number.isFinite(customRate);
  const commissionRatePercent = resolveRate(user, globalCommissionRate);
  if (!Number.isFinite(commissionRatePercent) || commissionRatePercent < 0 || commissionRatePercent > 100) {
    return { status: 'commission_rate_invalid' };
  }

  const networkRef = db.collection('networks').doc(networkId);
  const { sales, truncated } = await readSalesForReconciliation(networkRef.collection('sales'));
  if (truncated) return { status: 'limit_exceeded', maxSales: MAX_DOCS_PER_NETWORK };

  const eligible = sales.filter(isLegacyCommissionCandidate);
  const alreadyReconciled = sales.some((sale) => sale.commissionReconciliationSource === 'admin_legacy_backfill');
  let updatedCount = 0;
  for (let offset = 0; offset < eligible.length; offset += 450) {
    const chunk = eligible.slice(offset, offset + 450);
    const batch = db.batch();
    chunk.forEach((sale) => {
      batch.update(networkRef.collection('sales').doc(sale.id), {
        commissionRiyal: saleCommissionMinor(sale, commissionRatePercent),
        commissionRateBps: percentToBps(commissionRatePercent),
        commissionReconciledAt: FieldValue.serverTimestamp(),
        commissionReconciliationSource: 'admin_legacy_backfill',
      });
    });
    await batch.commit();
    updatedCount += chunk.length;
  }

  if (updatedCount === 0 && !alreadyReconciled) {
    return {
      status: 'no_legacy_sales',
      updatedCount: 0,
      commissionRatePercent,
      rateSource: hasCustomRate ? 'customer' : 'global',
    };
  }

  // Rebuild absolute totals after persistence. A repeat also repairs totals
  // if a previous attempt saved sales but failed before finishing the rebuild.
  const rebuilt = await rebuildNetwork(db, { uid, now, actorUid, rate: globalCommissionRate });
  if (rebuilt.status !== 'rebuilt') return { status: rebuilt.status };
  const auditLog = {
    action: 'MIGRATION_RECONCILE_LEGACY_COMMISSIONS',
    actorUid,
    targetType: 'network',
    targetId: uid,
    details: { networkId, updatedCount, commissionRatePercent, totals: rebuilt.totals },
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: now,
  };
  let auditLogged = true;
  try {
    await db.collection('admin_audit_logs').add(auditLog);
  } catch (error) {
    auditLogged = false;
    console.warn('legacy commission audit log failed', error);
  }

  return {
    status: updatedCount > 0 ? 'reconciled' : 'already_reconciled',
    updatedCount,
    commissionRatePercent,
    rateSource: hasCustomRate ? 'customer' : 'global',
    auditLogged,
    totals: rebuilt.totals,
  };
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

  const [sales, payments] = await Promise.all([
    readAll(networkRef.collection('sales').orderBy(FieldPath.documentId())),
    readAll(networkRef.collection('payments')),
  ]);
  const totals = computeNetworkTotals(sales, payments, resolvedRate);
  const aggregate = computeAggregate(sales, resolvedRate);

  await networkRef.set({ ...totals, networkId, owner_uid: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection('admin_aggregates').doc(uid).set({ ...aggregate, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
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
    if (parsed.value.action === 'reconcile-legacy-commissions') {
      result = await reconcileLegacyCommissionData(db, {
        uid: parsed.value.uid,
        actorUid: caller.callerUid,
        now,
        globalCommissionRate: await globalRate(db),
      });
      if (result.status === 'account_not_found') return res.status(404).json({ success: false, error: 'account_not_found' });
      if (result.status === 'limit_exceeded') return res.status(409).json({ success: false, error: 'reconciliation_limit_exceeded', maxSales: result.maxSales });
      if (result.status === 'commission_rate_invalid') return res.status(409).json({ success: false, error: 'commission_rate_invalid' });
    } else if (parsed.value.action === 'classify-users') {
      result = await classifyUsers(db, { ...parsed.value, now, actorUid: caller.callerUid });
    } else if (parsed.value.action === 'rebuild-network') {
      result = await rebuildNetwork(db, { uid: parsed.value.uid, now, actorUid: caller.callerUid, rate: await globalRate(db) });
      if (result.status === 'account_not_found') return res.status(404).json({ success: false, error: 'account_not_found' });
    } else {
      result = await rebuildAll(db, { ...parsed.value, now, actorUid: caller.callerUid, rate: await globalRate(db) });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('migrate action failed', error);
    return res.status(500).json({ success: false, error: 'migration_failed' });
  }
}
