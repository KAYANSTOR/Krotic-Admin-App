import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from '../server/_lib/firebaseAdmin.js';
import { ensureNetworkSecret } from '../server/_lib/networkSecretStore.js';

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const init = ensureFirebaseAdmin();
  if (!init.ok) return res.status(503).json({ success: false, error: init.error });

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return res.status(401).json({ success: false, error: 'missing_token' });

  let uid;
  try {
    uid = (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }

  const db = getFirestore();
  try {
    const adminSnapshot = await db.collection('Admins').doc(uid).get();
    if (adminSnapshot.exists) return res.status(403).json({ success: false, error: 'not_client_account' });

    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists) return res.status(404).json({ success: false, error: 'network_not_provisioned' });
    const user = userSnapshot.data() || {};
    const networkId = typeof user.networkId === 'string' && user.networkId.trim() ? user.networkId.trim() : uid;
    if (!DOC_ID_PATTERN.test(networkId)) return res.status(409).json({ success: false, error: 'network_mapping_invalid' });

    const networkRef = db.collection('networks').doc(networkId);
    const networkSnapshot = await networkRef.get();
    if (!networkSnapshot.exists) return res.status(404).json({ success: false, error: 'network_not_provisioned' });
    const network = networkSnapshot.data() || {};
    if ((network.owner_uid && network.owner_uid !== uid) || (!network.owner_uid && networkId !== uid)) {
      return res.status(403).json({ success: false, error: 'network_owner_mismatch' });
    }

    const { networkSecret } = await ensureNetworkSecret(db, networkRef, {
      recoverUndecryptable: true,
    });
    return res.status(200).json({
      success: true,
      networkId,
      networkSecret,
      signatureAlgorithm: 'HMAC-SHA256',
      signatureHeader: 'x-verification-receipt',
      policyVersion: 1,
    });
  } catch (error) {
    if (error?.message === 'network_secret_master_not_configured') {
      return res.status(503).json({ success: false, error: 'hmac_not_configured' });
    }
    if (error?.message === 'network_secret_decryption_failed') {
      console.error('network-secret: stored key could not be decrypted', { uid });
      return res.status(503).json({ success: false, error: 'network_secret_unavailable' });
    }
    console.error('network-secret: request failed', { uid, error });
    return res.status(500).json({ success: false, error: 'network_secret_failed' });
  }
}
