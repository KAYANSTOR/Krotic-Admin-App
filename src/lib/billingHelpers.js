import { toDate } from './format.js';

export const FIRESTORE_BATCH_LIMIT = 450;

/** Return a stable YYYY-MM key, or null when the input is not a valid date. */
export function monthKeyFromDate(input) {
  try {
    const date = toDate(input);
    if (!date || typeof date.getTime !== 'function' || Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/** Resolve the current month at call time so the default remains a real value. */
export function getCurrentMonthKey(now = new Date()) {
  return monthKeyFromDate(now);
}

/** Split Firestore writes into chunks below Firestore's 500-operation limit. */
export function chunkArray(items, size = FIRESTORE_BATCH_LIMIT) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('Chunk size must be a positive integer');

  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
