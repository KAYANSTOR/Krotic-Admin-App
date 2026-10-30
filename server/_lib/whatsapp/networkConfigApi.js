/**
 * Admin API: get/set WhatsApp non-secret config on networks/{networkId}.
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { authenticateAdmin, ensureFirebaseAdmin } from '../firebaseAdmin.js';
import { parseNetworkId } from '../networkId.js';
import { readNetworkWhatsappConfig, validateNetworkWhatsappInput } from './networkConfig.js';
import { secretsReadinessReport } from './secrets.js';

function respond(res, status, body) {
  return res.status(status).json(body);
}

function bodyObject(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export default async function whatsappNetworkConfigHandler(req, res, dependencies = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const configured = ensure();
  if (!configured?.ok) return respond(res, 503, { success: false, error: configured?.error || 'server_not_configured' });

  const getAuthFn = dependencies.getAuth || getAuth;
  const getFirestoreFn = dependencies.getFirestore || getFirestore;
  const authorize = dependencies.authenticateAdmin || authenticateAdmin;
  const caller = await authorize(req, { getAuth: getAuthFn, getFirestore: getFirestoreFn });
  if (!caller.ok) return respond(res, caller.status, { success: false, error: caller.error });

  const input = bodyObject(req.body);
  if (!input) return respond(res, 400, { success: false, error: 'invalid_json' });

  const action = input.action === 'get' || input.action === 'set' || input.action === 'readiness'
    ? input.action
    : null;
  if (!action) return respond(res, 400, { success: false, error: 'unknown_action' });

  if (action === 'readiness') {
    return respond(res, 200, { success: true, secrets: secretsReadinessReport() });
  }

  const networkIdRaw = typeof input.networkId === 'string' ? input.networkId.trim() : '';
  const parsedNet = parseNetworkId(networkIdRaw);
  // Allow legacy uid-as-networkId for old accounts
  const networkId = parsedNet?.networkId || (/^[A-Za-z0-9_-]{6,128}$/.test(networkIdRaw) ? networkIdRaw : null);
  if (!networkId) return respond(res, 400, { success: false, error: 'network_id_invalid' });

  const db = dependencies.db || getFirestoreFn();
  const now = dependencies.now ?? Date.now();

  try {
    const ref = db.collection('networks').doc(networkId);
    const snap = await ref.get();
    if (!snap.exists) return respond(res, 404, { success: false, error: 'network_not_found' });

    if (action === 'get') {
      return respond(res, 200, {
        success: true,
        networkId,
        config: readNetworkWhatsappConfig(snap.data() || {}),
      });
    }

    const validated = validateNetworkWhatsappInput(input.config || input);
    if (!validated.ok) return respond(res, 400, { success: false, error: validated.error });

    const patch = {
      ...validated.value,
      whatsappUpdatedAtMs: now,
      whatsappUpdatedBy: caller.callerUid,
      updatedAtMs: now,
      updatedAt: dependencies.serverTimestamp ? dependencies.serverTimestamp() : FieldValue.serverTimestamp(),
    };
    await ref.set(patch, { merge: true });

    const after = await ref.get();
    return respond(res, 200, {
      success: true,
      networkId,
      config: readNetworkWhatsappConfig(after.data() || {}),
    });
  } catch (error) {
    console.error('whatsapp network-config failed', { code: error?.code, message: error?.message });
    return respond(res, 500, { success: false, error: 'network_config_failed' });
  }
}
