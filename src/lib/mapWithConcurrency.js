/**
 * Maps a collection with a fixed worker pool while preserving result order.
 * This prevents per-record Firestore fan-out from becoming an unbounded burst.
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items);
  if (values.length === 0) return [];

  const requestedLimit = Number.isFinite(Number(concurrency))
    ? Math.floor(Number(concurrency))
    : 1;
  const workerCount = Math.max(1, Math.min(values.length, requestedLimit));
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index, values);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
