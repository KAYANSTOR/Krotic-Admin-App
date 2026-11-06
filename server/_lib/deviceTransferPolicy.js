/**
 * Self-service move of an account's license to a new app installation.
 *
 * Why: the installation id lives in the app's private storage. Reinstalling
 * the app, clearing its data or moving to a new phone produces a new id, and
 * the server used to answer `installation_mismatch` forever until an admin
 * re-bound the device by hand. The app then had no lease and showed the
 * suspension screen to a paying customer.
 *
 * Rules (all enforced inside the activation transaction):
 * 1. Only an authenticated owner of an eligible account reaches this policy.
 * 2. The license moves only to an installation that was never bound to this
 *    account before. A replaced installation cannot pull the license back,
 *    so two phones cannot ping-pong one account; it gets
 *    `installation_replaced` instead.
 * 3. At most MAX_TRANSFERS_PER_WINDOW automatic moves per rolling window.
 *    Beyond that the owner must contact support (admin device re-bind).
 * 4. Every move bumps entitlementVersion and writes an audit log entry.
 */
export const DEVICE_TRANSFER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TRANSFERS_PER_WINDOW = 3;
export const INSTALLATION_HISTORY_LIMIT = 20;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

export function appendHistory(history, installationId) {
  const next = cleanHistory(history).filter((value) => value !== installationId);
  next.push(installationId);
  return next.slice(-INSTALLATION_HISTORY_LIMIT);
}

function recentTransfers(transfers, nowMs) {
  if (!Array.isArray(transfers)) return [];
  return transfers
    .filter((value) => Number.isFinite(value) && value > nowMs - DEVICE_TRANSFER_WINDOW_MS && value <= nowMs)
    .sort((a, b) => a - b);
}

function versionOf(user) {
  const raw = Number(user?.entitlementVersion);
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

export function planDeviceTransfer({ user, installationId, nowMs }) {
  const bound = typeof user?.entitlementInstallationId === 'string'
    ? user.entitlementInstallationId.trim()
    : '';
  const previous = typeof user?.entitlementPreviousInstallationId === 'string'
    ? user.entitlementPreviousInstallationId.trim()
    : '';
  const history = cleanHistory(user?.entitlementInstallationHistory);
  if (bound && !history.includes(bound)) history.push(bound);

  if (history.includes(installationId) || installationId === previous) {
    return { allowed: false, error: 'installation_mismatch', reason: 'installation_replaced' };
  }
  const transfers = recentTransfers(user?.entitlementAutoTransfersMs, nowMs);
  if (transfers.length >= MAX_TRANSFERS_PER_WINDOW) {
    return { allowed: false, error: 'installation_mismatch', reason: 'device_transfer_limit_reached' };
  }
  return {
    allowed: true,
    nextVersion: versionOf(user) + 1,
    history: appendHistory(history, installationId),
    transfers: [...transfers, nowMs],
  };
}
