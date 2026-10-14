// ============================================================
// Krotak Pro — معرّف الشبكة الخادمي (قرار المالك أ2)
// صيغة تسلسلية مقروءة وثابتة: NET-10001، لا تتأثر بتغيير هاتف العميل
// أو بيانات تسجيل الدخول. يولّده الخادم حصراً.
// ============================================================

export const NETWORK_ID_PREFIX = 'NET-';
export const NETWORK_ID_START = 10001;
export const COUNTER_DOC_PATH = ['counters', 'networks'];

const NETWORK_ID_PATTERN = /^NET-(\d{5,})$/;

export function formatNetworkId(sequence) {
  if (!Number.isInteger(sequence) || sequence < NETWORK_ID_START) {
    throw new Error('network_sequence_invalid');
  }
  return `${NETWORK_ID_PREFIX}${sequence}`;
}

export function parseNetworkId(networkId) {
  const match = NETWORK_ID_PATTERN.exec(String(networkId || '').trim());
  if (!match) return null;
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < NETWORK_ID_START) return null;
  return { networkId: `${NETWORK_ID_PREFIX}${sequence}`, sequence };
}

export function isNetworkId(networkId) {
  return parseNetworkId(networkId) !== null;
}

/** التسلسل التالي بعد آخر معرّف مُخصَّص، أو البداية إن لم يوجد. */
export function nextNetworkSequence(lastNetworkId) {
  const parsed = parseNetworkId(lastNetworkId);
  return parsed ? parsed.sequence + 1 : NETWORK_ID_START;
}
