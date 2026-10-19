export const ADMIN_DATA_CACHE_PREFIX = 'krotak:admin-data:';
// Keep route-to-route data warm locally; explicit manual refresh bypasses it.
export const MEMORY_CACHE_TTL = 30 * 60_000; // 30 minutes
export const LOCAL_CACHE_TTL = 7 * 24 * 60 * 60_000; // 7 days persistent cache
const CACHE_RESULT = Symbol('ADMIN_DATA_CACHE_RESULT');

export function withAdminDataCacheMetadata(value, metadata) {
  return { [CACHE_RESULT]: true, value, metadata: metadata || {} };
}

function storageFromGlobal() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function validUid(uid) {
  return typeof uid === 'string' && uid.trim() ? uid : null;
}

export function buildAdminDataStorageKey(uid, key) {
  const normalizedUid = validUid(uid);
  if (!normalizedUid) return null;
  return `${ADMIN_DATA_CACHE_PREFIX}${encodeURIComponent(normalizedUid)}:${key}`;
}

function isFresh(createdAt, ttl) {
  return Number.isFinite(createdAt) && Date.now() - createdAt < ttl;
}

export function createAdminDataCache({
  getUid = () => null,
  getStorage = storageFromGlobal,
  prefix = ADMIN_DATA_CACHE_PREFIX,
  memoryTtl = MEMORY_CACHE_TTL,
  localCacheTtl = LOCAL_CACHE_TTL,
} = {}) {
  const memory = new Map();
  const inFlight = new Map();
  const requestVersions = new Map();
  const metadata = new Map();
  const listeners = new Map();
  let generation = 0;

  function notify(scopedKey, value) {
    const state = metadata.get(scopedKey) || null;
    listeners.get(scopedKey)?.forEach((listener) => {
      try {
        listener(value, state);
      } catch (error) {
        console.error('Admin data-cache subscriber failed:', error);
      }
    });
  }

  function storageKey(uid, key) {
    const normalizedUid = validUid(uid);
    return normalizedUid ? `${prefix}${encodeURIComponent(normalizedUid)}:${key}` : null;
  }

  function readLocal(uid, key) {
    const fullKey = storageKey(uid, key);
    if (!fullKey) return null;
    try {
      const storage = getStorage();
      const raw = storage?.getItem(fullKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const cachedAt = Number(parsed?.cachedAt ?? parsed?.storedAt ?? parsed?.createdAt);
      if (!parsed || parsed.value == null || !Number.isFinite(cachedAt)) return null;
      const parsedLastSyncedAt = Number(parsed.lastSyncedAt);
      return {
        value: parsed.value,
        cachedAt,
        lastSyncedAt: Number.isFinite(parsedLastSyncedAt) && parsedLastSyncedAt > 0 ? parsedLastSyncedAt : null,
        stale: !isFresh(cachedAt, LOCAL_CACHE_TTL),
      };
    } catch {
      return null;
    }
  }

  function writeLocal(uid, key, value) {
    const fullKey = storageKey(uid, key);
    if (!fullKey) return;
    try {
      getStorage()?.setItem(fullKey, JSON.stringify({ cachedAt: Date.now(), value }));
    } catch {
      // localStorage is an optional acceleration layer.
    }
  }

  function clearLocalStorage(preserveUid = null) {
    try {
      const storage = getStorage();
      if (!storage) return;
      const preservedPrefix = validUid(preserveUid) ? `${prefix}${encodeURIComponent(preserveUid)}:` : null;
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix) && (!preservedPrefix || !key.startsWith(preservedPrefix))) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // A blocked or unavailable localStorage must not prevent logout.
    }
  }

  async function readCached(key, loader, { force = false, uid, revalidate = false } = {}) {
    const scopeUid = validUid(uid ?? getUid());
    // Never create an unscoped custom snapshot. Protected callers should have a UID.
    if (!scopeUid) return loader();

    const scopedKey = `${scopeUid}:${key}`;
    const currentGeneration = generation;
    const cached = memory.get(scopedKey);
    if (!force && !revalidate && cached) {
      if (isFresh(cached.createdAt, memoryTtl)) return cached.value;
      if (isFresh(cached.createdAt, localCacheTtl)) {
        const state = metadata.get(scopedKey) || {};
        metadata.set(scopedKey, { ...state, fromCache: true, cachedAt: cached.createdAt, stale: false });
        notify(scopedKey, cached.value);
        return cached.value;
      }
      const state = metadata.get(scopedKey) || {};
      metadata.set(scopedKey, { ...state, fromCache: true, cachedAt: state.cachedAt || cached.createdAt, stale: true });
      notify(scopedKey, cached.value);
      if (!inFlight.has(scopedKey)) {
        void readCached(key, loader, { force: false, uid: scopeUid, revalidate: true }).catch(() => {
          // Keep serving the last known snapshot when offline.
        });
      }
      return cached.value;
    }
    if (!force && !revalidate && inFlight.has(scopedKey)) return inFlight.get(scopedKey);
    let localValue = null;
    if (!force && !revalidate && !cached) {
      localValue = readLocal(scopeUid, key);
      if (localValue) {
        memory.set(scopedKey, { value: localValue.value, createdAt: localValue.cachedAt });
        metadata.set(scopedKey, {
          fromCache: true,
          cachedAt: localValue.cachedAt,
          lastSyncedAt: localValue.lastSyncedAt,
          stale: localValue.stale,
        });
        if (localValue.stale) {
          void readCached(key, loader, { force: false, uid: scopeUid, revalidate: true }).catch(() => {
            // Keep serving the last known local snapshot when offline.
          });
        }
        return localValue.value;
      }
    }

    const requestVersion = (requestVersions.get(scopedKey) || 0) + 1;
    requestVersions.set(scopedKey, requestVersion);
    let request;
    const previousValue = cached?.value ?? localValue?.value ?? null;
    const previousCachedAt = cached?.createdAt ?? localValue?.cachedAt ?? null;
    request = Promise.resolve().then(() => loader({
      cachedValue: previousValue,
      cachedAt: previousCachedAt,
      force,
      uid: scopeUid,
    })).then((result) => {
      const taggedResult = result?.[CACHE_RESULT] === true ? result : null;
      const value = taggedResult ? taggedResult.value : result;
      const stillCurrent = generation === currentGeneration
        && requestVersions.get(scopedKey) === requestVersion;
      if (stillCurrent) {
        const cachedAt = Date.now();
        const fromCache = taggedResult ? taggedResult.metadata.fromCache : null;
        // A degraded (partial) result must not be served from cache, otherwise a
        // transient backend gap would keep the dashboard empty until the TTL
        // expires. It is still published to subscribers so the UI can render it.
        const cacheable = taggedResult ? taggedResult.metadata.cacheable !== false : true;
        if (cacheable) {
          memory.set(scopedKey, { value, createdAt: cachedAt });
          writeLocal(scopeUid, key, value);
        } else {
          memory.delete(scopedKey);
        }
        metadata.set(scopedKey, {
          fromCache,
          cachedAt,
          lastSyncedAt: fromCache === false ? cachedAt : null,
          ...(cacheable ? {} : { partial: true }),
        });
        notify(scopedKey, value);
      }
      return value;
    }).finally(() => {
      if (inFlight.get(scopedKey) === request) inFlight.delete(scopedKey);
    });
    inFlight.set(scopedKey, request);
    return request;
  }

  function clear({ preserveUid = null } = {}) {
    generation += 1;
    memory.clear();
    inFlight.clear();
    requestVersions.clear();
    metadata.clear();
    clearLocalStorage(preserveUid);
  }

  function invalidate(keys, uid = getUid()) {
    const scopeUid = validUid(uid);
    if (!scopeUid) return;
    const normalizedKeys = Array.isArray(keys) ? keys : [keys];
    for (const pattern of normalizedKeys) {
      if (typeof pattern !== 'string' || !pattern) continue;
      const wildcard = pattern.endsWith('*');
      const keyPrefix = wildcard ? pattern.slice(0, -1) : pattern;
      const scopedPrefix = `${scopeUid}:${keyPrefix}`;
      const knownKeys = new Set([...memory.keys(), ...inFlight.keys(), ...metadata.keys()]);
      const scopedKeys = wildcard
        ? [...knownKeys].filter((key) => key.startsWith(scopedPrefix))
        : [`${scopeUid}:${pattern}`];
      for (const scopedKey of scopedKeys) {
        const cacheKey = scopedKey.slice(scopeUid.length + 1);
        requestVersions.set(scopedKey, (requestVersions.get(scopedKey) || 0) + 1);
        memory.delete(scopedKey);
        inFlight.delete(scopedKey);
        metadata.delete(scopedKey);
        try {
          getStorage()?.removeItem(storageKey(scopeUid, cacheKey));
        } catch {
          // Cache invalidation must not block a successful Firestore mutation.
        }
      }
      if (!wildcard) continue;
      try {
        const storage = getStorage();
        if (!storage) continue;
        const localPrefix = storageKey(scopeUid, keyPrefix);
        const localKeys = [];
        for (let index = 0; index < storage.length; index += 1) {
          const localKey = storage.key(index);
          if (localKey?.startsWith(localPrefix)) localKeys.push(localKey);
        }
        localKeys.forEach((localKey) => storage.removeItem(localKey));
      } catch {
        // Cache invalidation must not block a successful Firestore mutation.
      }
    }
  }

  function set(key, value, uid = getUid()) {
    const scopeUid = validUid(uid);
    if (!scopeUid || typeof key !== 'string' || !key) return false;
    const scopedKey = `${scopeUid}:${key}`;
    const cachedAt = Date.now();
    requestVersions.set(scopedKey, (requestVersions.get(scopedKey) || 0) + 1);
    inFlight.delete(scopedKey);
    memory.set(scopedKey, { value, createdAt: cachedAt });
    metadata.set(scopedKey, { fromCache: false, cachedAt, lastSyncedAt: null });
    writeLocal(scopeUid, key, value);
    notify(scopedKey, value);
    return true;
  }

  function getState(key, uid = getUid()) {
    const scopeUid = validUid(uid);
    return scopeUid ? (metadata.get(`${scopeUid}:${key}`) || null) : null;
  }

  function getValue(key, uid = getUid()) {
    const scopeUid = validUid(uid);
    if (!scopeUid) return null;
    const cached = memory.get(`${scopeUid}:${key}`);
    if (cached) return cached.value;
    return readLocal(scopeUid, key)?.value ?? null;
  }

  function subscribe(key, listener, uid = getUid()) {
    const scopeUid = validUid(uid);
    if (!scopeUid || typeof listener !== 'function') return () => {};
    const scopedKey = `${scopeUid}:${key}`;
    const currentListeners = listeners.get(scopedKey) || new Set();
    currentListeners.add(listener);
    listeners.set(scopedKey, currentListeners);
    const cached = memory.get(scopedKey);
    if (cached) {
      try {
        listener(cached.value, metadata.get(scopedKey) || null);
      } catch (error) {
        console.error('Admin data-cache subscriber failed:', error);
      }
    }
    return () => {
      currentListeners.delete(listener);
      if (!currentListeners.size) listeners.delete(scopedKey);
    };
  }

  return { readCached, clear, getState, getValue, invalidate, set, subscribe };
}
