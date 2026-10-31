import { toDateInput } from './helpers';

export const NETWORK_PAGE_SIZE = 12;
export const SALE_ROW_LIMIT = 50;
export const FILTER_STORAGE_KEY = 'krotak:sales-filters:v4';

export const DATE_PRESETS = [
  {
    key: 'today',
    label: 'اليوم',
    range: () => {
      const today = new Date();
      return [toDateInput(today), toDateInput(today)];
    },
  },
  {
    key: 'week',
    label: 'آخر 7 أيام',
    range: () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return [toDateInput(from), toDateInput(today)];
    },
  },
  {
    key: 'month',
    label: 'آخر 30 يوماً',
    range: () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return [toDateInput(from), toDateInput(today)];
    },
  },
  {
    key: 'thisMonth',
    label: 'هذا الشهر',
    range: () => {
      const today = new Date();
      return [toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), toDateInput(today)];
    },
  },
];

export const SALE_STATUS = {
  COMPLETED: {
    text: 'مكتمل',
    class: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  ROLLED_BACK: {
    text: 'مسترجع',
    class: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  SMS_PENDING: {
    text: 'بانتظار SMS',
    class: 'bg-sky-100 text-sky-800 border-sky-300',
  },
};

export const VERIFICATION_FILTERS = [
  { value: 'all', label: 'كافة السجلات' },
  { value: 'verified', label: '🛡️ معتمدة خادمياً' },
  { value: 'legacy', label: '⏳ قديمة قيد المطابقة' },
];

export const STATUS_FILTERS = [
  { value: 'all', label: 'كافة الحالات' },
  { value: 'COMPLETED', label: 'مكتمل فقط' },
  { value: 'ROLLED_BACK', label: 'مسترجع' },
  { value: 'SMS_PENDING', label: 'بانتظار SMS' },
];
