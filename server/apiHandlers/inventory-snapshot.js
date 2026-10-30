// ============================================================
// Krotak Pro — Vercel Serverless Function
// POST /api/inventory/snapshot — ملخص أعداد مخزون الكروت من Android
// ------------------------------------------------------------
// يستقبل أعداداً مجرّدة فقط (متاح/محجوز/مباع/تالف) مع تفصيل الفئات.
// لا يستقبل أي بيانات كرت سرية (PIN/كلمة مرور/رقم كرت/رمز/خام).
//
// المصادقة مطابقة لـ api/sales/ingest.js و api/device-heartbeat.js:
//   1) يتحقق من Firebase ID token ويستخرج UID من التوكن فقط.
//   2) يرفض حسابات المدراء (عملاء فقط).
//   3) يربط الشبكة بحساب المالك عبر users/{uid}.networkId و networks/{networkId}.owner_uid.
//   4) يتحقق أن networkId في الجسم يطابق الشبكة الموثّقة للحساب.
//
// Idempotency/Revision على المسار networks/{networkId}/inventory_snapshot/current:
//   - نفس snapshotId  => 200 already_acked.
//   - revision أقدم  => 409 STALE_REVISION.
//   - أحدث           => حفظ + serverTimestamp + 200 acked.
// يتطلب FIREBASE_SERVICE_ACCOUNT. لا كتابة عميل في Firestore.
// ============================================================

import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../_lib/firebaseAdmin.js';

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CURRENCY_PATTERN = /^[A-Za-z0-9]{1,8}$/;
const MAX_COUNT = 100_000_000;
const MAX_BREAKDOWN_ENTRIES = 500;

const TOTAL_FIELDS = [
  'totalAvailableCards',
  'totalReservedCards',
  'totalSoldCards',
  'totalInvalidCards',
];
const BREAKDOWN_FIELDS = [
  'catalogId', 'denomination', 'currency',
  'availableCount', 'reservedCount', 'soldCount',
];
const ALLOWED_FIELDS = new Set([
  'schemaVersion', 'networkId', 'snapshotId', 'inventoryRevision', 'generatedAt',
  ...TOTAL_FIELDS, 'breakdown',
]);

// حظر صريح لأي حقل يحمل بيانات كرت سرية. نقارن بمفتاح مُطبَّع (حروف صغيرة بلا رموز)
// حتى يلتقط card_number و raw_card و PIN بأي صيغة.
const FORBIDDEN_SECRET_FIELDS = new Set([
  'pin', 'password', 'cardnumber', 'secret', 'code', 'rawcard',
]);

function normalizeKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function objectBody(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function findForbiddenSecretField(input) {
  const stack = [input];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of Object.keys(current)) {
      if (FORBIDDEN_SECRET_FIELDS.has(normalizeKey(key))) return key;
      const value = current[key];
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

function normalizeGeneratedAt(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return { ms: value, iso: new Date(value).toISOString() };
  }
  if (typeof value === 'string' && value.trim() && value.length <= 64) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    return { ms: parsed, iso: new Date(parsed).toISOString() };
  }
  return null;
}

function validateCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
}

export function validateInventorySnapshot(body) {
  const input = objectBody(body);
  if (!input) return { ok: false, error: 'invalid_json' };

  const secretField = findForbiddenSecretField(input);
  if (secretField) return { ok: false, error: 'secret_field_forbidden', field: secretField };

  if (input.schemaVersion !== 1) return { ok: false, error: 'schema_version_unsupported' };

  const unknown = Object.keys(input).find((field) => !ALLOWED_FIELDS.has(field));
  if (unknown) return { ok: false, error: 'unknown_field', field: unknown };

  const networkId = typeof input.networkId === 'string' ? input.networkId.trim() : '';
  if (!ID_PATTERN.test(networkId)) return { ok: false, error: 'network_id_invalid' };

  const snapshotId = typeof input.snapshotId === 'string' ? input.snapshotId.trim() : '';
  if (!ID_PATTERN.test(snapshotId)) return { ok: false, error: 'snapshot_id_invalid' };

  if (!Number.isSafeInteger(input.inventoryRevision) || input.inventoryRevision < 0) {
    return { ok: false, error: 'revision_invalid' };
  }

  const generatedAt = normalizeGeneratedAt(input.generatedAt);
  if (!generatedAt) return { ok: false, error: 'generated_at_invalid' };

  for (const field of TOTAL_FIELDS) {
    if (!validateCount(input[field])) return { ok: false, error: 'counter_invalid', field };
  }

  const rawBreakdown = input.breakdown;
  if (!Array.isArray(rawBreakdown) || rawBreakdown.length > MAX_BREAKDOWN_ENTRIES) {
    return { ok: false, error: 'breakdown_invalid' };
  }
  const breakdown = [];
  for (const entry of rawBreakdown) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: 'breakdown_invalid' };
    }
    const entryUnknown = Object.keys(entry).find((field) => !BREAKDOWN_FIELDS.includes(field));
    if (entryUnknown) return { ok: false, error: 'breakdown_field_unknown', field: entryUnknown };
    const catalogId = typeof entry.catalogId === 'string' ? entry.catalogId.trim() : '';
    if (!catalogId || catalogId.length > 128) return { ok: false, error: 'catalog_id_invalid' };
    if (!Number.isSafeInteger(entry.denomination) || entry.denomination < 0 || entry.denomination > MAX_COUNT) {
      return { ok: false, error: 'denomination_invalid' };
    }
    const currency = typeof entry.currency === 'string' ? entry.currency.trim().toUpperCase() : '';
    if (!CURRENCY_PATTERN.test(currency)) return { ok: false, error: 'currency_invalid' };
    for (const field of ['availableCount', 'reservedCount', 'soldCount']) {
      if (!validateCount(entry[field])) return { ok: false, error: 'counter_invalid', field };
    }
    breakdown.push({
      catalogId,
      denomination: entry.denomination,
      currency,
      availableCount: entry.availableCount,
      reservedCount: entry.reservedCount,
      soldCount: entry.soldCount,
    });
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      networkId,
      snapshotId,
      inventoryRevision: input.inventoryRevision,
      generatedAt: generatedAt.iso,
      generatedAtMs: generatedAt.ms,
      totalAvailableCards: input.totalAvailableCards,
      totalReservedCards: input.totalReservedCards,
      totalSoldCards: input.totalSoldCards,
      totalInvalidCards: input.totalInvalidCards,
      breakdown,
    },
  };
}

/**
 * يقرر النتيجة مقابل الوثيقة المحفوظة دون كتابة.
 * same snapshotId => already_acked | incoming < current => stale | otherwise => accepted.
 */
export function decideInventoryOutcome(existingData, incoming) {
  const current = existingData || null;
  const currentRevision = current && Number.isSafeInteger(current.inventoryRevision)
    ? current.inventoryRevision : null;
  if (current && current.snapshotId === incoming.snapshotId) {
    return {
      status: 'already_acked',
      snapshotId: incoming.snapshotId,
      inventoryRevision: currentRevision ?? incoming.inventoryRevision,
    };
  }
  if (currentRevision !== null && incoming.inventoryRevision < currentRevision) {
    return { status: 'stale', currentRevision };
  }
  return { status: 'accepted' };
}

export default async function handler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const validated = validateInventorySnapshot(req.body);
  if (!validated.ok) {
    const payload = { ok: false, error: validated.error };
    if (validated.field) payload.field = validated.field;
    return res.status(400).json(payload);
  }

  const configured = (dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin)();
  if (!configured?.ok) {
    return res.status(503).json({ ok: false, error: configured?.error || 'server_not_configured' });
  }

  const authorization = String(req.headers?.authorization || '');
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!idToken) return res.status(401).json({ ok: false, error: 'missing_token' });

  const auth = dependencies.auth || getAuth();
  let uid;
  try {
    const claims = await auth.verifyIdToken(idToken);
    uid = typeof claims.uid === 'string' ? claims.uid : '';
  } catch {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
  if (!uid) return res.status(401).json({ ok: false, error: 'invalid_token' });

  const db = dependencies.db || getFirestore();
  const now = dependencies.now ?? Date.now();

  try {
    const adminSnap = await db.collection('Admins').doc(uid).get();
    const legacyAdminSnap = adminSnap.exists ? null : await db.collection('admins').doc(uid).get();
    if (adminSnap.exists || legacyAdminSnap?.exists) {
      return res.status(403).json({ ok: false, error: 'not_client_account' });
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ ok: false, error: 'account_not_found' });
    const user = userSnap.data() || {};
    const networkId = typeof user.networkId === 'string' && user.networkId.trim()
      ? user.networkId.trim() : uid;
    if (validated.value.networkId !== networkId) {
      return res.status(403).json({ ok: false, error: 'network_identity_mismatch' });
    }

    const networkSnap = await db.collection('networks').doc(networkId).get();
    if (!networkSnap.exists) return res.status(404).json({ ok: false, error: 'network_not_found' });
    const network = networkSnap.data() || {};
    if ((network.owner_uid && network.owner_uid !== uid) || (!network.owner_uid && networkId !== uid)) {
      return res.status(403).json({ ok: false, error: 'network_owner_mismatch' });
    }

    const snapshotRef = db.collection('networks').doc(networkId)
      .collection('inventory_snapshot').doc('current');
    const outcome = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(snapshotRef);
      const decision = decideInventoryOutcome(previous.exists ? previous.data() : null, validated.value);
      if (decision.status !== 'accepted') return decision;
      transaction.set(snapshotRef, {
        ...validated.value,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: now,
        serverReceivedAtMs: now,
      }, { merge: false });
      return {
        status: 'accepted',
        snapshotId: validated.value.snapshotId,
        inventoryRevision: validated.value.inventoryRevision,
      };
    });

    if (outcome.status === 'stale') {
      return res.status(409).json({
        ok: false,
        error: 'STALE_REVISION',
        currentRevision: outcome.currentRevision,
      });
    }
    if (outcome.status === 'already_acked') {
      return res.status(200).json({
        ok: true,
        status: 'already_acked',
        snapshotId: outcome.snapshotId,
        inventoryRevision: outcome.inventoryRevision,
      });
    }
    return res.status(200).json({
      ok: true,
      status: 'acked',
      snapshotId: outcome.snapshotId,
      inventoryRevision: outcome.inventoryRevision,
    });
  } catch (error) {
    console.error('inventory/snapshot: request failed', { uid, code: error?.code });
    return res.status(500).json({ ok: false, error: 'inventory_snapshot_failed' });
  }
}
