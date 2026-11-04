/**
 * Fail-Closed gate for whatsapp_card_delivery entitlement.
 * Reuses account feature semantics: missing/false ⇒ locked.
 */

export const WHATSAPP_CARD_DELIVERY_KEY = 'whatsapp_card_delivery';

/**
 * @param {object|null|undefined} accountFeatures - users/{uid}.account_features map
 * @returns {boolean} true only when explicitly true
 */
export function isWhatsappCardDeliveryEnabled(accountFeatures) {
  if (!accountFeatures || typeof accountFeatures !== 'object' || Array.isArray(accountFeatures)) {
    return false;
  }
  return accountFeatures[WHATSAPP_CARD_DELIVERY_KEY] === true;
}

/**
 * Resolve owner uid from network document and verify entitlement.
 * @returns {Promise<{ ok: true, ownerUid: string } | { ok: false, error: string, status: number }>}
 */
export async function assertWhatsappEntitlementForNetwork(db, networkId) {
  const networkSnap = await db.collection('networks').doc(networkId).get();
  if (!networkSnap.exists) {
    return { ok: false, status: 404, error: 'network_not_found' };
  }
  const network = networkSnap.data() || {};
  const ownerUid = [network.owner_uid, network.ownerUid, network.uid]
    .find((candidate) => typeof candidate === 'string' && candidate.length > 0)
    || (networkId === network.uid ? network.uid : null);
  // Legacy: networkId may equal owner uid
  const resolvedOwner = ownerUid || (typeof network.uid === 'string' ? network.uid : null) || networkId;

  const userSnap = await db.collection('users').doc(resolvedOwner).get();
  if (!userSnap.exists) {
    return { ok: false, status: 404, error: 'account_not_found' };
  }
  const user = userSnap.data() || {};
  if (!isWhatsappCardDeliveryEnabled(user.account_features)) {
    return { ok: false, status: 403, error: 'feature_locked' };
  }
  if (!['TRIAL', 'ACTIVE_PAID'].includes(user.accessStatus)) {
    return { ok: false, status: 403, error: 'account_access_locked' };
  }
  return { ok: true, ownerUid: resolvedOwner, network };
}
