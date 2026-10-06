const numberFormatter = new Intl.NumberFormat('ar-YE');

export function formatNumber(value) {
  return numberFormatter.format(Math.round(Number(value) || 0));
}

export function toDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input.toDate === 'function') return input.toDate();
  if (input.seconds != null) return new Date(input.seconds * 1000);
  if (typeof input === 'number') return new Date(input);
  return new Date(input);
}

export function formatDate(input, { withTime = false } = {}) {
  const d = toDate(input);
  if (!d || Number.isNaN(d.getTime())) return '—';
  const base = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) return d.toLocaleString('ar-YE', { ...base, hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ar-YE', base);
}

export function formatToday() {
  return new Intl.DateTimeFormat('ar-YE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date());
}

export function formatDateInput(input) {
  const d = toDate(input);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function isExpired(input) {
  const d = toDate(input);
  if (!d) return false;
  return d < new Date();
}
