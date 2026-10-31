export function toNotificationMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  try {
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (typeof value.toDate === 'function') {
      const millis = value.toDate().getTime();
      return Number.isFinite(millis) ? millis : null;
    }
  } catch {
    return null;
  }

  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

export function notificationMillis(data) {
  return toNotificationMillis(data?.displayTimestamp)
    ?? toNotificationMillis(data?.timestamp)
    ?? toNotificationMillis(data?.createdAt)
    ?? toNotificationMillis(data?.createdAtMs);
}

export function formatNotificationDate(value) {
  const millis = toNotificationMillis(value);
  if (millis === null) return '—';
  return new Date(millis).toLocaleString('ar-YE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Converts a timestamp to the local datetime-local input format. */
export function toLocalDateTimeInput(millis) {
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
