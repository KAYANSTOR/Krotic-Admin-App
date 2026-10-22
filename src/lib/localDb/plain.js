/**
 * يحوّل قيم Firestore (خاصة Timestamp) إلى أنواع قابلة للتخزين في IndexedDB.
 * IndexedDB لا تحفظ كائنات Firestore كما هي، ولا تقبل تواريخ كائنات.
 */
export function plain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      out[key] = plain(entry);
    }
    return out;
  }
  return value;
}

/** يعيد بناء كائن plain مع الحفاظ على المفاتيح الصغيرة (مثل uid / id). */
export function plainWithId(data, id) {
  const row = plain(data) || {};
  if (id !== undefined && id !== null) row.id = id;
  return row;
}
