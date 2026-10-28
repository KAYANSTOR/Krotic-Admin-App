export const AUDIENCE = Object.freeze({
  GLOBAL: 'global',
  USER: 'user',
});

export const TABS = Object.freeze({
  COMPOSE: 'compose',
  HISTORY: 'history',
  TEMPLATES: 'templates',
});

export const TAB_STORAGE_KEY = 'krotak:notif-active-tab';
export const TEMPLATE_STORAGE_PREFIX = 'krotak:notification-templates';
export const TITLE_MAX = 120;
export const MESSAGE_MAX = 500;

export const DEFAULT_QUICK_PRESETS = Object.freeze([
  {
    title: 'تحديث جديد لتطبيق كروتك برو',
    message: 'يتوفر الآن تحديث جديد للتطبيق يشمل تحسينات في سرعة الطباعة والاتصال. يرجى التحديث الآن.',
  },
  {
    title: 'تذكير بسداد العمولة الشهرية',
    message: 'نرجو مراجعة كشف الحساب وسداد العمولة المستحقة لضمان استمرار الخدمة دون انقطاع.',
  },
  {
    title: 'صيانة دورية مجدولة',
    message: 'سيتم إجراء صيانة دورية للخوادم الليلة من الساعة 3 فجراً وحتى 4 فجراً. شكراً لتفهمكم.',
  },
  {
    title: 'تنبيه هام للشبكات',
    message: 'يرجى التأكد من مزامنة كروت الشبكة قبل نهاية اليوم لضمان دقة التقارير المالية.',
  },
]);

export const SEND_ERROR_MESSAGES = Object.freeze({
  missing_token: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد.',
  invalid_token: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد.',
  not_admin: 'هذا الحساب لا يملك صلاحية إرسال الإشعارات.',
  no_devices: 'لا توجد أجهزة مسجّلة لهذا المستخدم بعد.',
  server_not_configured: 'خدمة الإشعارات غير مهيأة على الخادم بعد.',
  title_and_body_required: 'يرجى ملء العنوان والنص.',
  admin_check_failed: 'تعذر التحقق من صلاحيات المدير. أعد المحاولة لاحقاً.',
});

export function loadSavedTab() {
  try {
    const value = window.localStorage.getItem(TAB_STORAGE_KEY);
    return Object.values(TABS).includes(value) ? value : TABS.COMPOSE;
  } catch {
    return TABS.COMPOSE;
  }
}

export function saveSavedTab(tab) {
  if (!Object.values(TABS).includes(tab)) return;
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Local persistence is optional.
  }
}
