import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../server/_lib/firebaseAdmin.js';
import { ACCESS_STATUSES, legacyAccessFields } from '../server/_lib/accessStatus.js';
import { formatNetworkId, nextNetworkSequence } from '../server/_lib/networkId.js';
import { encryptNetworkSecret, generateNetworkSecret } from '../server/_lib/networkSecret.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const NETWORK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_DOMAIN = 'krotak.app';
// تعطيل SMS مؤقتًا حتى يكتمل إعداد قنوات الرسائل. عند جاهزية القناة يُعاد
// تفعيل هذا المفتاح؛ لا نضع phone_verified=true لأن الهاتف لم يُتحقق منه.
const PHONE_VERIFICATION_REQUIRED = false;
const ALLOWED_FIELDS = new Set(['networkName', 'phone', 'platform', 'appVersion']);

export class RegistrationError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function plainObject(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function validateSelfRegistration(body) {
  const input = plainObject(body);
  if (Object.keys(input).some((key) => !ALLOWED_FIELDS.has(key))) {
    return { ok: false, error: 'fields_not_allowed' };
  }
  const networkName = typeof input.networkName === 'string' ? input.networkName.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const platform = typeof input.platform === 'string' ? input.platform.trim() : '';
  const appVersion = typeof input.appVersion === 'string' ? input.appVersion.trim() : '';
  if (!networkName || networkName.length > 100) return { ok: false, error: 'network_name_invalid' };
  if (!/^\d{11,15}$/.test(phone)) return { ok: false, error: 'phone_invalid' };
  if (platform !== 'android') return { ok: false, error: 'platform_invalid' };
  if (!appVersion || appVersion.length > 40) return { ok: false, error: 'app_version_invalid' };
  return { ok: true, value: { networkName, phone, platform, appVersion } };
}

function phoneIndexId(phone) {
  return createHash('sha256').update(phone, 'utf8').digest('hex');
}

async function findOwnedNetworkCandidates(transaction, db, uid) {
  const candidates = new Map();
  for (const field of ['owner_uid', 'ownerUid', 'uid']) {
    const snapshot = await transaction.get(
      db.collection('networks').where(field, '==', uid).limit(3),
    );
    for (const document of snapshot.docs || []) {
      const network = document.data() || {};
      const owner = network.owner_uid || network.ownerUid || network.uid;
      if (owner === uid) candidates.set(document.id, network);
    }
  }
  return [...candidates.entries()];
}

/**
 * Provision one server-owned network and one 30-day trial atomically.
 * Repeated calls for the same UID/normalized phone are idempotent; the phone
 * index prevents aliases of an already-registered number from consuming a
 * second trial. No access fields are accepted from the client payload.
 */
export async function provisionSelfRegistration(db, { uid, profile, now = Date.now() }) {
  if (!UID_PATTERN.test(uid)) throw new RegistrationError(400, 'uid_invalid');
  const userRef = db.collection('users').doc(uid);
  const counterRef = db.collection('counters').doc('networks');
  const phoneRef = db.collection('network_registration_phone_index').doc(phoneIndexId(profile.phone));
  const auditRef = db.collection('admin_audit_logs').doc();
  const candidateNetworkSecret = encryptNetworkSecret(generateNetworkSecret());

  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const phoneSnap = await transaction.get(phoneRef);
    const counterSnap = await transaction.get(counterRef);
    const user = userSnap.exists ? userSnap.data() || {} : {};

    if (phoneSnap.exists && phoneSnap.data()?.uid !== uid) {
      throw new RegistrationError(409, 'phone_already_registered');
    }

    let currentNetworkId = typeof user.networkId === 'string' ? user.networkId.trim() : '';
    if (!currentNetworkId) {
      const ownedNetworks = await findOwnedNetworkCandidates(transaction, db, uid);
      if (ownedNetworks.length > 1) {
        throw new RegistrationError(409, 'network_mapping_ambiguous');
      }
      if (ownedNetworks.length === 1) currentNetworkId = ownedNetworks[0][0];
    }
    if (currentNetworkId) {
      if (!NETWORK_ID_PATTERN.test(currentNetworkId)) {
        throw new RegistrationError(409, 'network_mapping_invalid');
      }
      const existingNetworkRef = db.collection('networks').doc(currentNetworkId);
      const existingNetworkSnap = await transaction.get(existingNetworkRef);
      const network = existingNetworkSnap.exists ? existingNetworkSnap.data() || {} : {};
      const existingMetadataRef = existingNetworkRef.collection('_metadata').doc('info');
      const existingMetadataSnap = await transaction.get(existingMetadataRef);
      const isOwned = existingNetworkSnap.exists
        && (network.owner_uid === uid || (!network.owner_uid && currentNetworkId === uid));
      if (!isOwned) throw new RegistrationError(409, 'network_mapping_incomplete');
      if (user.phone && user.phone !== profile.phone) {
        throw new RegistrationError(409, 'account_phone_mismatch');
      }
      const nowTimestamp = Timestamp.fromMillis(Number(now));
      const profilePatch = {
        ...(user.phone ? {} : { phone: profile.phone }),
        ...(user.network_name ? {} : { network_name: profile.networkName }),
        ...(user.platform ? {} : { platform: profile.platform }),
        ...(user.app_version ? {} : { app_version: profile.appVersion }),
        ...(user.created_at ? {} : { created_at: nowTimestamp }),
        ...(user.last_seen_at ? {} : { last_seen_at: nowTimestamp }),
        ...(user.phone_verification_required === true
          ? { phone_verification_required: PHONE_VERIFICATION_REQUIRED }
          : {}),
      };
      // Repair a missing user access snapshot only from this already-owned server record.
      // Never infer activation when the network itself has no recognized access status.
      const networkAccessStatus = typeof network.accessStatus === 'string'
        ? network.accessStatus.trim().toUpperCase()
        : '';
      const userAccessStatus = typeof user.accessStatus === 'string'
        ? user.accessStatus.trim().toUpperCase()
        : '';
      const networkExpiry = network.subscriptionEndsAt ?? network.subscription_end_date;
      if (!ACCESS_STATUSES.includes(userAccessStatus)
        && ACCESS_STATUSES.includes(networkAccessStatus)
        && networkExpiry != null) {
        Object.assign(profilePatch, {
          accessStatus: networkAccessStatus,
          ...legacyAccessFields(networkAccessStatus, networkExpiry),
          ...(network.trialStartedAt != null ? { trialStartedAt: network.trialStartedAt } : {}),
          ...(network.subscriptionEndsAt != null ? { subscriptionEndsAt: network.subscriptionEndsAt } : {}),
        });
      }
      if (Object.keys(profilePatch).length > 0) {
        profilePatch.updatedAtMs = Number(now);
        transaction.set(userRef, profilePatch, { merge: true });
      }
      if (!existingMetadataSnap.exists) {
        transaction.set(existingMetadataRef, {
          name: user.network_name || profile.networkName,
          phoneNumber: profile.phone,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      if (!phoneSnap.exists) {
        transaction.set(phoneRef, { uid, createdAt: FieldValue.serverTimestamp() });
      }
      return {
        status: 'duplicate',
        networkId: currentNetworkId,
        trialStartedAtMs: user.trialStartedAt?.toMillis?.() ?? null,
        subscriptionEndsAtMs: user.subscriptionEndsAt?.toMillis?.() ?? null,
      };
    }

    // Do not silently convert a legacy/admin-managed access record into a new trial.
    if (user.accessStatus || user.is_active !== undefined || user.is_trial !== undefined) {
      throw new RegistrationError(409, 'account_requires_admin_review');
    }
    if (user.phone && user.phone !== profile.phone) {
      throw new RegistrationError(409, 'account_phone_mismatch');
    }

    const lastNetworkId = counterSnap.exists ? counterSnap.data()?.lastNetworkId ?? null : null;
    const networkId = formatNetworkId(nextNetworkSequence(lastNetworkId));
    const networkRef = db.collection('networks').doc(networkId);
    const collisionSnap = await transaction.get(networkRef);
    if (collisionSnap.exists) throw new RegistrationError(409, 'network_id_conflict');

    const startedAtMs = Number(now);
    const endsAtMs = startedAtMs + 30 * DAY_MS;
    const startedAt = Timestamp.fromMillis(startedAtMs);
    const endsAt = Timestamp.fromMillis(endsAtMs);
    const accessFields = {
      networkId,
      owner_uid: uid,
      accessStatus: 'TRIAL',
      trialStartedAt: startedAt,
      subscriptionEndsAt: endsAt,
      ...legacyAccessFields('TRIAL', endsAt),
    };
    const network = {
      networkId,
      owner_uid: uid,
      accessStatus: 'TRIAL',
      trialStartedAt: startedAt,
      subscriptionEndsAt: endsAt,
      ...legacyAccessFields('TRIAL', endsAt),
      networkSecretEncrypted: candidateNetworkSecret,
      networkSecretVersion: 1,
      networkSecretUpdatedAt: FieldValue.serverTimestamp(),
      createdAt: startedAt,
      createdAtMs: startedAtMs,
      updatedAtMs: startedAtMs,
      createdBy: 'self-registration',
    };
    const userData = {
      uid,
      phone: profile.phone,
      network_name: profile.networkName,
      platform: profile.platform,
      app_version: profile.appVersion,
      phone_verified: false,
      phoneVerified: false,
      phone_verification_required: PHONE_VERIFICATION_REQUIRED,
      phone_verified_manual: false,
      created_at: startedAt,
      last_seen_at: startedAt,
      updatedAt: FieldValue.serverTimestamp(),
      createdAtMs: startedAtMs,
      updatedAtMs: startedAtMs,
      ...accessFields,
    };
    const metadataRef = networkRef.collection('_metadata').doc('info');

    transaction.set(counterRef, {
      lastNetworkId: networkId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(networkRef, network);
    transaction.set(userRef, userData, { merge: true });
    transaction.set(metadataRef, {
      name: profile.networkName,
      phoneNumber: profile.phone,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(phoneRef, { uid, createdAt: FieldValue.serverTimestamp() });
    transaction.set(auditRef, {
      action: 'NETWORK_SELF_REGISTER',
      actorUid: uid,
      targetType: 'network',
      targetId: networkId,
      details: { networkId },
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: startedAtMs,
      updatedAtMs: startedAtMs,
    });

    return { status: 'created', networkId, trialStartedAtMs: startedAtMs, subscriptionEndsAtMs: endsAtMs };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }
  const parsed = validateSelfRegistration(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return res.status(401).json({ success: false, error: 'missing_token' });
  let claims;
  try {
    claims = await getAuth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }
  const uid = typeof claims.uid === 'string' ? claims.uid : '';
  if (!UID_PATTERN.test(uid)) return res.status(401).json({ success: false, error: 'invalid_token' });
  const expectedEmail = `${parsed.value.phone}@${EMAIL_DOMAIN}`;
  if (String(claims.email || '').toLowerCase() !== expectedEmail) {
    return res.status(403).json({ success: false, error: 'phone_identity_mismatch' });
  }

  const db = getFirestore();
  try {
    const adminSnap = await db.collection('Admins').doc(uid).get();
    if (adminSnap.exists) return res.status(403).json({ success: false, error: 'not_client_account' });
    const result = await provisionSelfRegistration(db, { uid, profile: parsed.value });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof RegistrationError) {
      return res.status(error.status).json({ success: false, error: error.code });
    }
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'network_security_not_configured' });
    }
    console.error('self-registration failed', { uid, error });
    return res.status(500).json({ success: false, error: 'registration_failed' });
  }
}
