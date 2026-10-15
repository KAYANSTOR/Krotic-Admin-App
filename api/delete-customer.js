import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { authenticateAdmin, ensureFirebaseAdmin } from './_lib/firebaseAdmin.js';
import { parseNetworkId } from './_lib/networkId.js';

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DELETE_BATCH_SIZE = 400;

function isValidNetworkId(value) {
  return UID_PATTERN.test(value) && !value.startsWith('NET-') || Boolean(parseNetworkId(value));
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
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export function validateDeleteCustomerInput(body) {
  const input = normalizeBody(body);
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';
  if (!UID_PATTERN.test(uid)) return { ok: false, error: 'uid_invalid' };
  if (typeof input.confirmationUid !== 'string' || input.confirmationUid.trim() !== uid) {
    return { ok: false, error: 'uid_confirmation_required' };
  }
  const networkId = typeof input.networkId === 'string' && input.networkId.trim()
    ? input.networkId.trim()
    : null;
  if (networkId && !isValidNetworkId(networkId)) {
    return { ok: false, error: 'network_mapping_invalid' };
  }
  return { ok: true, value: { uid, networkId } };
}

async function deleteQueryInBatches(db, query) {
  let deleted = 0;
  while (true) {
    const snapshot = await query.limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < DELETE_BATCH_SIZE) return deleted;
  }
}

async function deleteAuditReferences(db, targetIds) {
  let deleted = 0;
  for (const targetId of new Set(targetIds.filter(Boolean))) {
    deleted += await deleteQueryInBatches(
      db,
      db.collection('admin_audit_logs').where('targetId', '==', targetId),
    );
  }
  return deleted;
}

/**
 * Permanently removes one customer account and its customer-owned network.
 * Admin audit rows that identify the customer are erased; a non-identifying
 * deletion event is written after the data removal for operational traceability.
 */
export async function deleteCustomerData(db, auth, { uid, networkIdHint, actorUid, now = Date.now() }) {
  const userRef = db.collection('users').doc(uid);
  const [userSnap, adminSnap] = await Promise.all([
    userRef.get(),
    db.collection('Admins').doc(uid).get(),
  ]);
  if (adminSnap.exists) return { status: 'target_is_admin' };

  const user = userSnap.exists ? userSnap.data() || {} : {};
  const storedNetworkId = typeof user.networkId === 'string' ? user.networkId.trim() : '';
  if (storedNetworkId && !isValidNetworkId(storedNetworkId)) {
    return { status: 'network_mapping_invalid' };
  }
  if (storedNetworkId && networkIdHint && storedNetworkId !== networkIdHint) {
    return { status: 'network_mapping_invalid' };
  }
  let networkId = storedNetworkId || (userSnap.exists ? uid : (networkIdHint || uid));
  if (!isValidNetworkId(networkId)) return { status: 'network_mapping_invalid' };

  let networkRef = db.collection('networks').doc(networkId);
  let networkSnap = await networkRef.get();
  if (!userSnap.exists && !networkSnap.exists && networkIdHint && networkIdHint !== uid) {
    networkId = uid;
    networkRef = db.collection('networks').doc(networkId);
    networkSnap = await networkRef.get();
  }
  if (networkSnap.exists) {
    const network = networkSnap.data() || {};
    if (network.owner_uid && network.owner_uid !== uid) return { status: 'network_owner_mismatch' };
    if (!network.owner_uid && networkId !== uid) return { status: 'network_owner_mismatch' };
    const linkedUsers = await db.collection('users').where('networkId', '==', networkId).limit(3).get();
    if (linkedUsers.docs.some((document) => document.id !== uid)) return { status: 'shared_network' };
  }

  let authUserExists = false;
  try {
    await auth.getUser(uid);
    authUserExists = true;
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  if (!userSnap.exists && !networkSnap.exists && !authUserExists) return { status: 'customer_not_found' };

  // Revoke account login first. A retry is safe if a later Firestore cleanup fails.
  if (authUserExists) await auth.deleteUser(uid);

  const deleted = {
    registryRecords: await deleteQueryInBatches(db, db.collection('sale_ingest_registry').where('uid', '==', uid)),
    phoneIndexes: await deleteQueryInBatches(db, db.collection('network_registration_phone_index').where('uid', '==', uid)),
    notificationRequests: await deleteQueryInBatches(db, db.collection('notification_requests').where('targetUid', '==', uid)),
    notificationDeliveries: await deleteQueryInBatches(db, db.collection('notification_deliveries').where('target', '==', `user:${uid}`)),
    notificationsByTarget: await deleteQueryInBatches(db, db.collection('notifications').where('targetUid', '==', uid)),
    notificationsByUid: await deleteQueryInBatches(db, db.collection('notifications').where('uid', '==', uid)),
  };

  if (networkSnap.exists) await db.recursiveDelete(networkRef);
  await db.collection('admin_aggregates').doc(uid).delete();
  deleted.auditRows = await deleteAuditReferences(db, [uid, networkId]);
  await db.recursiveDelete(userRef);

  let auditLogged = true;
  try {
    await db.collection('admin_audit_logs').add({
      action: 'CUSTOMER_DELETE',
      actorUid,
      targetType: 'customer_record',
      targetId: 'deleted',
      targetLabel: 'عميل محذوف',
      details: { anonymized: true },
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
    });
  } catch (error) {
    auditLogged = false;
    console.warn('anonymous customer deletion audit log failed', error?.code || 'unknown');
  }

  return { status: 'deleted', networkId, deleted, authDeleted: authUserExists, auditLogged };
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

  const input = validateDeleteCustomerInput(req.body);
  if (!input.ok) return res.status(400).json({ success: false, error: input.error });

  try {
    const result = await deleteCustomerData(getFirestore(), getAuth(), {
      uid: input.value.uid,
      networkIdHint: input.value.networkId,
      actorUid: caller.callerUid,
    });
    if (result.status === 'customer_not_found') return res.status(404).json({ success: false, error: 'customer_not_found' });
    if (result.status === 'target_is_admin') return res.status(403).json({ success: false, error: result.status });
    if (['network_owner_mismatch', 'shared_network', 'network_mapping_invalid'].includes(result.status)) {
      return res.status(409).json({ success: false, error: result.status });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('delete-customer failed', error?.code || 'unknown');
    return res.status(500).json({ success: false, error: 'customer_delete_failed' });
  }
}
