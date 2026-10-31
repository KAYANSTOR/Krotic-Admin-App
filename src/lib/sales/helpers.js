import { FILTER_STORAGE_KEY } from './constants';

export function saleDomId(id) {
  return 'sales-operation-' + String(id ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function toDateInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function loadSavedFilters() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      statusFilter: typeof parsed?.statusFilter === 'string' ? parsed.statusFilter : 'all',
      dateFrom: typeof parsed?.dateFrom === 'string' ? parsed.dateFrom : '',
      dateTo: typeof parsed?.dateTo === 'string' ? parsed.dateTo : '',
    };
  } catch {
    return null;
  }
}
