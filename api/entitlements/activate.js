import activateEntitlement from '../../server/_lib/entitlementActivation.js';

// Vercel route: POST /api/entitlements/activate
// Signing keys remain in Vercel environment variables; this file contains no secrets.
export default function handler(req, res) {
  return activateEntitlement(req, res);
}
