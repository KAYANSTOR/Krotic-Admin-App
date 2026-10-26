import rebindEntitlementDevice from '../../server/_lib/entitlementDeviceRebind.js';

// Vercel route: POST /api/entitlements/device-rebind
// The helper enforces administrator authentication and writes an audit record.
export default function handler(req, res) {
  return rebindEntitlementDevice(req, res);
}
