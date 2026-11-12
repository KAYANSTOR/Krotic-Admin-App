// ============================================================
// WhatsApp gateway: client identity + paid-feature gate.
// ============================================================

import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from './firebaseAdmin.js';
import { resolveClientUid, resolveOwnedNetwork, networkLookupFailure } from './clientRequestAuth.js';
import { normalizeAccountFeatures } from './accountFeatures.js';
import { ACCOUNT_FEATURE_CATALOG } from './accountFeatureCatalog.js';

const FEATURE_KEY = 'whatsapp_card_delivery';

/**
 * Verifies Firebase ID token (client account only), resolves owned networkId
 * from Firestore (never from the request body), and requires whatsapp_card_delivery
 * unless `requireFeature: false` (delivery status / SMS-fallback bookkeeping that is already owed).
 */
export async function authorizeWhatsappOwner(req, dependencies = {}, { label = 'whatsapp', requireFeature = true } = {}) {
  const ensure = dependencies.ensureFirebaseAdmin || ensureFirebaseAdmin;
  const init = ensure();
  if (!init.ok) return { ok: false, status: 503, error: init.error || 'server_not_configured' };

  const caller = await resolveClientUid(req, dependencies, { label });
  if (!caller.ok) return { ok: false, status: caller.status, error: caller.error };
  const uid = caller.uid;

  const db = (dependencies.getFirestore || getFirestore)();
  let owned;
  try {
    owned = await resolveOwnedNetwork(db, uid);
  } catch (error) {
    const failure = networkLookupFailure(error, { label, uid });
    return { ok: false, status: failure.status, error: failure.error };
  }
  if (!owned.ok) return { ok: false, status: owned.status, error: owned.error };

  const features = normalizeAccountFeatures(owned.user?.account_features, ACCOUNT_FEATURE_CATALOG);
  if (requireFeature && features[FEATURE_KEY] !== true) {
    return { ok: false, status: 403, error: 'whatsapp_card_delivery_required', networkId: owned.networkId };
  }

  return {
    ok: true,
    uid,
    networkId: owned.networkId,
    user: owned.user,
    network: owned.network,
    db,
  };
}
