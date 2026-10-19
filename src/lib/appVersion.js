/** Compare versions reported by the app; missing reports are never treated as current. */
export function compareAppVersions(installed, latest) {
  const left = String(installed || '').split('+')[0].trim();
  const right = String(latest || '').split('+')[0].trim();
  if (!left || !right) return null;
  const a = left.split('.').map((part) => Number(part));
  const b = right.split('.').map((part) => Number(part));
  if (a.some((part) => !Number.isInteger(part) || part < 0)
      || b.some((part) => !Number.isInteger(part) || part < 0)) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function getAppUpdateStatus(user, latest = {}) {
  const installedCode = Number(user?.app_version_code);
  const latestCode = Number(latest?.app_latest_version_code);
  const hasCode = Number.isInteger(installedCode) && installedCode > 0
    && Number.isInteger(latestCode) && latestCode > 0;
  const installedVersion = user?.app_version || user?.appVersion || '';
  if (!installedVersion && !hasCode) return 'unknown';
  if (hasCode) return installedCode < latestCode ? 'outdated' : 'current';
  const comparison = compareAppVersions(installedVersion, latest?.app_latest_version);
  if (comparison === null) return 'unknown';
  return comparison < 0 ? 'outdated' : 'current';
}
