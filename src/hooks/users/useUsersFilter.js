import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../../lib/users/constants.js';
import { isExpired } from '../../lib/format.js';
import { isUserPhoneVerified } from '../../lib/accessStatus.js';
import { getAppUpdateStatus } from '../../lib/appVersion.js';
import { isExpiringSoon } from '../../lib/users/accessHelpers.js';

function lower(value) {
  return String(value ?? '').toLocaleLowerCase();
}

function matchesSearch(user, query) {
  if (!query) return true;
  return [
    user?.networkName,
    user?.network_name,
    user?.name,
    user?.phoneNumber,
    user?.phone,
    user?.networkId,
    user?.app_version,
    user?.app_version_code,
    user?.uid,
  ].some((value) => lower(value).includes(query));
}

function matchesFilter(user, filterType, warningWindowMs, globalConfig) {
  switch (filterType) {
    case 'active':
      return user.is_active !== false;
    case 'verified':
      return isUserPhoneVerified(user);
    case 'unverified':
      return !isUserPhoneVerified(user);
    case 'trial':
      return user.is_trial === true;
    case 'official':
      return user.is_trial === false;
    case 'blocked':
      return user.is_active === false;
    case 'update-needed':
      return getAppUpdateStatus(user, globalConfig) === 'outdated';
    case 'version-unknown':
      return getAppUpdateStatus(user, globalConfig) === 'unknown';
    case 'expired':
      return isExpired(user.subscriptionEndsAt ?? user.subscription_end_date);
    case 'expiring':
      return isExpiringSoon(user, warningWindowMs);
    default:
      return true;
  }
}

export function useUsersFilter(users, {
  searchTerm,
  filterType,
  versionSort,
  warningWindowMs,
  globalConfig,
}) {
  const deferredSearch = useDeferredValue(searchTerm);

  const filteredUsers = useMemo(() => {
    const query = lower(deferredSearch).trim();
    return users.filter((user) => (
      matchesSearch(user, query)
      && matchesFilter(user, filterType, warningWindowMs, globalConfig)
    ));
  }, [users, deferredSearch, filterType, warningWindowMs, globalConfig]);

  const orderedUsers = useMemo(() => {
    if (versionSort === 'none') return filteredUsers;

    const rank = (user) => (
      { outdated: 0, unknown: 1, current: 2 }[getAppUpdateStatus(user, globalConfig)] ?? 3
    );

    return [...filteredUsers].sort((left, right) => {
      const byStatus = rank(left) - rank(right);
      if (byStatus !== 0) return byStatus;

      const leftCode = Number(left.app_version_code) || 0;
      const rightCode = Number(right.app_version_code) || 0;
      const codeDelta = leftCode - rightCode;
      return versionSort === 'oldest' ? codeDelta : -codeDelta;
    });
  }, [filteredUsers, versionSort, globalConfig]);

  return { filteredUsers, orderedUsers };
}

export function useFilterCounts(users, globalConfig, warningWindowMs) {
  return useMemo(() => {
    const counts = {
      all: users.length,
      active: 0,
      verified: 0,
      unverified: 0,
      trial: 0,
      official: 0,
      blocked: 0,
      expired: 0,
      expiring: 0,
      'update-needed': 0,
      'version-unknown': 0,
    };

    for (const user of users) {
      if (user.is_active !== false) counts.active += 1;
      if (user.is_active === false) counts.blocked += 1;
      if (isUserPhoneVerified(user)) counts.verified += 1;
      if (user.is_trial === true) counts.trial += 1;
      if (user.is_trial === false) counts.official += 1;

      const expiry = user.subscriptionEndsAt ?? user.subscription_end_date;
      if (isExpired(expiry)) counts.expired += 1;
      else if (isExpiringSoon(user, warningWindowMs)) counts.expiring += 1;

      const updateStatus = getAppUpdateStatus(user, globalConfig);
      if (updateStatus === 'outdated') counts['update-needed'] += 1;
      if (updateStatus === 'unknown') counts['version-unknown'] += 1;
    }

    counts.unverified = users.length - counts.verified;
    return counts;
  }, [users, globalConfig, warningWindowMs]);
}

export function usePagination(items, searchTerm, filterType, versionSort = 'none') {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchTerm, filterType, versionSort]);

  const visibleUsers = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount],
  );

  return {
    visibleUsers,
    hasMore: items.length > visibleUsers.length,
    loadMore: () => setVisibleCount((current) => current + PAGE_SIZE),
  };
}
