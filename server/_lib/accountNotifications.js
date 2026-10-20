const MAX_NOTIFICATIONS = 100;

function timestampMillis(data) {
  const value = data?.createdAt ?? data?.timestamp ?? data?.created_at;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function serializeGlobalNotification(id, data = {}) {
  const title = String(data.title || '').trim();
  const message = String(data.body || data.message || '').trim();
  if (!title && !message) return null;
  return {
    id: String(id),
    title,
    message,
    timestamp: timestampMillis(data),
    is_read: false,
    is_global: true,
  };
}

export async function listGlobalNotifications(db, limit = MAX_NOTIFICATIONS) {
  const snapshot = await db.collection('notification_deliveries')
    .where('audienceType', '==', 'global')
    .get();
  return snapshot.docs
    .map((document) => serializeGlobalNotification(document.id, document.data()))
    .filter(Boolean)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, Math.min(MAX_NOTIFICATIONS, Math.max(1, Number(limit) || MAX_NOTIFICATIONS)));
}
