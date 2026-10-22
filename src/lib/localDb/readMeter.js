const counters = { total: 0, calls: 0, byLabel: {} };
const listeners = new Set();

function publish() {
  const state = readCounters();
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.warn('Read meter listener failed:', error);
    }
  });
}

export function readCounters() {
  return {
    total: counters.total,
    calls: counters.calls,
    byLabel: Object.fromEntries(
      Object.entries(counters.byLabel).map(([label, value]) => [label, { ...value }]),
    ),
  };
}

export function subscribeReadCounters(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetReadCounters() {
  counters.total = 0;
  counters.calls = 0;
  counters.byLabel = {};
  publish();
}

export function countReads(label, docCount, { fromCache = null } = {}) {
  const count = Math.max(1, Number(docCount) || 0);
  const entry = counters.byLabel[label] || {
    reads: 0,
    calls: 0,
    cacheReads: 0,
    serverReads: 0,
    unknownSourceReads: 0,
  };

  counters.total += count;
  counters.calls += 1;
  entry.reads += count;
  entry.calls += 1;
  if (fromCache === true) entry.cacheReads += count;
  else if (fromCache === false) entry.serverReads += count;
  else entry.unknownSourceReads += count;
  counters.byLabel[label] = entry;
  publish();
}

export async function trackRead(label, operation) {
  const result = await operation();
  const docCount = Array.isArray(result?.docs)
    ? result.docs.length
    : (typeof result?.exists === 'function' && result.exists() ? 1 : 0);
  countReads(label, docCount, { fromCache: result?.metadata?.fromCache ?? null });
  return result;
}

export function trackSnapshot(label, snapshot, { initial = false } = {}) {
  const changedDocs = initial
    ? snapshot.size
    : snapshot.docChanges().filter((change) => change.type !== 'removed').length;
  if (initial || changedDocs > 0) {
    countReads(label, changedDocs, { fromCache: snapshot.metadata?.fromCache ?? null });
  }
}