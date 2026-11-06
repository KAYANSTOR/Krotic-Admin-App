import { useMemo } from 'react';
import { isExpired, toDate } from '../../lib/format';
import { getAppUpdateStatus } from '../../lib/appVersion';

/**
 * Filtering, sorting and counts are isolated from the page UI.
 * Data and API actions remain owned by UsersPage.
 */
export function useUsersFilter(users, {
  searchTerm,
  filterType,
  versionSort,
  warningWindowMs,
  globalConfig,
}) {
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        (user.networkName || '').toLowerCase().includes(q) ||
        (user.network_name || '').toLowerCase().includes(q) ||
        (user.name || '').toLowerCase().includes(q) ||
        (user.phoneNumber || '').includes(q) ||
        (user.phone || '').includes(q) ||
        (user.networkId || '').toLowerCase().includes(q) ||
        String(user.app_version || '').toLowerCase().includes(q) ||
        String(user.app_version_code || '').includes(q) ||
        user.uid.toLowerCase().includes(q);

      if (filterType === 'active') return matchesSearch && user.is_active !== false;
      if (filterType === 'trial') return matchesSearch && user.is_trial === true;
      if (filterType === 'official') return matchesSearch && user.is_trial === false;
      if (filterType === 'blocked') return matchesSearch && user.is_active === false;
      if (filterType === 'update-needed') {
        return matchesSearch && getAppUpdateStatus(user, globalConfig) === 'outdated';
      }
      if (filterType === 'version-unknown') {
        return matchesSearch && getAppUpdateStatus(user, globalConfig) === 'unknown';
      }
      if (filterType === 'expired') return matchesSearch && isExpired(user.subscription_end_date);
      if (filterType === 'expiring') {
        if (!matchesSearch || isExpired(user.subscription_end_date)) return false;
        const endDate = toDate(user.subscription_end_date);
        if (!endDate) return false;
        return endDate.getTime() - Date.now() <= warningWindowMs;
      }
      return matchesSearch;
    });
  }, [users, searchTerm, filterType, warningWindowMs, globalConfig]);

  const orderedUsers = useMemo(() => {
    if (versionSort === 'none') return filteredUsers;

    return [...filteredUsers].sort((a, b) => {
      const rank = (user) => ({ outdated: 0, unknown: 1, current: 2 })[
        getAppUpdateStatus(user, globalConfig)
      ];
      const byStatus = rank(a) - rank(b);
      if (byStatus) return byStatus;

      const codeDelta = (Number(a.app_version_code) || 0)
        - (Number(b.app_version_code) || 0);
      return versionSort === 'oldest' ? codeDelta : -codeDelta;
    });
  }, [filteredUsers, versionSort, globalConfig]);

  return { filteredUsers, orderedUsers };
}

/**
 * Counts are calculated independently of the active filter and search text,
 * so each filter chip shows its own actual total.
 */
export function useUsersFilterCounts(users, globalConfig, warningWindowMs) {
  return useMemo(() => {
    let active = 0;
    let trial = 0;
    let official = 0;
    let blocked = 0;
    let expired = 0;
    let expiring = 0;
    let updateNeeded = 0;
    let versionUnknown = 0;

    for (const user of users) {
      if (user.is_active !== false) active += 1;
      else blocked += 1;

      if (user.is_trial === true) trial += 1;
      if (user.is_trial === false) official += 1;

      if (isExpired(user.subscription_end_date)) {
        expired += 1;
      } else {
        const end = toDate(user.subscription_end_date);
        if (end && end.getTime() - Date.now() <= warningWindowMs) expiring += 1;
      }

      const status = getAppUpdateStatus(user, globalConfig);
      if (status === 'outdated') updateNeeded += 1;
      if (status === 'unknown') versionUnknown += 1;
    }

    return {
      all: users.length,
      active,
      trial,
      official,
      expiring,
      expired,
      blocked,
      'update-needed': updateNeeded,
      'version-unknown': versionUnknown,
    };
  }, [users, globalConfig, warningWindowMs]);
}

export function useUsersPagination(orderedUsers, visibleCount) {
  return useMemo(
    () => orderedUsers.slice(0, visibleCount),
    [orderedUsers, visibleCount],
  );
}
