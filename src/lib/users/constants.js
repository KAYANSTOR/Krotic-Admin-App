export const PAGE_SIZE = 24;
export const FILTER_STORAGE_KEY = 'krotak:users-filter';
export const VIEW_MODE_STORAGE_KEY = 'krotak:users-view';
export const DEFAULT_WARNING_DAYS = 5;
export const DEFAULT_COMMISSION = 5;

export const FILTERS = [
  { value: 'all', label: 'الكل' },
  { value: 'active', label: 'نشط' },
  { value: 'verified', label: 'موثّق' },
  { value: 'unverified', label: 'غير موثّق' },
  { value: 'official', label: 'رسمي' },
  { value: 'trial', label: 'تجريبي' },
  { value: 'expiring', label: 'ينتهي قريباً' },
  { value: 'expired', label: 'منتهي' },
  { value: 'blocked', label: 'محظور' },
  { value: 'update-needed', label: 'يحتاج تحديث' },
  { value: 'version-unknown', label: 'إصدار مجهول' },
];

export const VIEW_MODES = Object.freeze({ CARDS: 'cards', TABLE: 'table' });

export function isKnownFilter(value) {
  return FILTERS.some((item) => item.value === value);
}

export function loadSavedFilter() {
  try {
    const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
    return isKnownFilter(saved) ? saved : 'all';
  } catch {
    return 'all';
  }
}

export function loadSavedViewMode() {
  try {
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === VIEW_MODES.TABLE ? VIEW_MODES.TABLE : VIEW_MODES.CARDS;
  } catch {
    return VIEW_MODES.CARDS;
  }
}

export function resolveInitialFilter() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('filter');
    if (isKnownFilter(fromUrl)) return fromUrl;
  } catch {
    // Safe fallback when browser URL APIs are unavailable.
  }
  return loadSavedFilter();
}
