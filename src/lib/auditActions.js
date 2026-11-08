/** تعريفات إجراءات سجل التدقيق — وحدة نقية بلا Firebase. */
/**
 * بيانات العرض لكل إجراء. المفتاح هو القيمة المخزنة في `action`.
 * الخادم يكتب المفاتيح نفسها (مثل NETWORK_ACCESS_UPDATE).
 */
export const AUDIT_ACTION_META = Object.freeze({
  USER_ACTIVATE: { label: 'تفعيل مستخدم', tone: 'success' },
  USER_BLOCK: { label: 'حظر مستخدم', tone: 'danger' },
  USER_MAKE_OFFICIAL: { label: 'تحويل إلى رسمي', tone: 'brand' },
  USER_RENEW: { label: 'تجديد اشتراك', tone: 'brand' },
  USER_EDIT: { label: 'تعديل بيانات مستخدم', tone: 'neutral' },
  PAYMENT_ADD: { label: 'إضافة دفعة', tone: 'success' },
  NOTIFICATION_SEND: { label: 'إرسال إشعار', tone: 'warning' },
  NOTIFICATION_DELETE: { label: 'حذف إشعار', tone: 'danger' },
  NOTIFICATION_SCHEDULE: { label: 'جدولة إشعار', tone: 'brand' },
  SETTINGS_SAVE: { label: 'حفظ الإعدادات', tone: 'brand' },
  APP_STATUS_CHANGE: { label: 'تغيير حالة التطبيق', tone: 'danger' },
  SUBSCRIPTION_BATCH: { label: 'تحديث تواريخ مجمّع', tone: 'danger' },
  USER_PASSWORD_SET: { label: 'تعيين كلمة مرور', tone: 'warning' },
  USER_RESET_LINK: { label: 'إنشاء رابط إعادة تعيين', tone: 'warning' },
  ADMIN_CREATE: { label: 'إنشاء مدير', tone: 'brand' },
  ADMIN_DELETE: { label: 'حذف مدير', tone: 'danger' },
  DEVICE_DELETE: { label: 'حذف جهاز', tone: 'neutral' },
  USER_DELETE: { label: 'حذف حساب شبكة/عميل', tone: 'danger' },
  // أُزيل توثيق الهاتف؛ تبقى التسميتان لعرض سجلات التدقيق التاريخية فقط.
  USER_PHONE_VERIFY_MANUAL: { label: 'تفعيل رقم الهاتف يدوياً (إجراء قديم)', tone: 'neutral' },
  USER_PHONE_UNVERIFY: { label: 'إلغاء توثيق الهاتف (إجراء قديم)', tone: 'neutral' },
  ADMIN_PASSWORD_CHANGE: { label: 'تغيير كلمة مرور المدير', tone: 'brand' },
  // عمليات خادمية ومبيعات وتدقيق متقدم
  SETTLEMENT_RECORD: { label: 'تسوية مبيعات واعتماد عمولة', tone: 'success' },
  NETWORK_REGISTER: { label: 'تسجيل شبكة جديدة', tone: 'brand' },
  NETWORK_RENEW: { label: 'تجديد اشتراك شبكة (خادمي)', tone: 'brand' },
  NETWORK_ACCESS_UPDATE: { label: 'تعديل صلاحيات شبكة (خادمي)', tone: 'neutral' },
  NETWORK_DELETE: { label: 'حذف شبكة وبياناتها', tone: 'danger' },
  NETWORK_SECRET_ROTATE: { label: 'تدوير مفتاح شبكة (خادمي)', tone: 'warning' },
  ENTITLEMENT_DEVICE_REBIND: { label: 'موافقة إدارية على استبدال جهاز الاستحقاق', tone: 'brand' },
  SUBSCRIPTION_EXPIRY_CRON: { label: 'فحص انتهاء الاشتراكات (Cron خادمي)', tone: 'warning' },
  TEMPLATE_DRAFT_CREATE: { label: 'إنشاء مسودة قوالب', tone: 'brand' },
  TEMPLATE_DRAFT_UPDATE: { label: 'تعديل مسودة قوالب', tone: 'neutral' },
  TEMPLATE_DRAFT_DELETE: { label: 'حذف مسودة قوالب', tone: 'danger' },
  TEMPLATE_RELEASE_PUBLISH: { label: 'نشر إصدار قوالب نشط', tone: 'success' },
  TEMPLATE_RELEASE_ROLLBACK: { label: 'تراجع عن إصدار قوالب', tone: 'warning' },
  SALE_CONFLICT_DETECTED: { label: 'تعارض في معرّف أو محتوى بيع', tone: 'danger' },
  SALE_CANCELLED_BY_DEVICE: { label: 'إلغاء بيع من جهاز المالك', tone: 'warning' },
  LEGACY_SALES_RECONCILE: { label: 'تسوية ومطابقة مبيعات قديمة يدوياً', tone: 'warning' },
  COMMISSION_AUDIT_VERIFIED: { label: 'تدقيق واعتماد كشف حساب الشبكة', tone: 'success' },
  PAID_FEATURE_ENTITLEMENT_UPDATE: { label: 'تعديل المزايا المدفوعة لحساب', tone: 'brand' },
  NETWORK_PROVISION: { label: 'تهيئة شبكة (خادمي)', tone: 'brand' },
  ENTITLEMENT_DEVICE_SELF_TRANSFER: { label: 'نقل ذاتي للترخيص إلى تثبيت جديد', tone: 'warning' },
  NETWORK_SELF_REGISTER: { label: 'تسجيل ذاتي لشبكة من التطبيق', tone: 'brand' },
  ACCESS_COMPATIBILITY_REPAIR: { label: 'إصلاح توافق حقول الوصول', tone: 'neutral' },
  ADMIN_UPDATE: { label: 'تعديل مدير', tone: 'neutral' },
  MIGRATE_LEGACY_SALES: { label: 'ترحيل مبيعات قديمة', tone: 'warning' },
  MIGRATION_CLASSIFY_USERS: { label: 'تصنيف المستخدمين (ترحيل)', tone: 'neutral' },
  MIGRATION_REBUILD_NETWORK: { label: 'إعادة بناء شبكة (ترحيل)', tone: 'warning' },
  TEMPLATE_DEFAULT_CATALOG_IMPORT: { label: 'استيراد كتالوج القوالب الافتراضي', tone: 'brand' },
});

/** مفاتيح الإجراءات: `AUDIT_ACTIONS.USER_RENEW === 'USER_RENEW'`. هذا ما يُخزَّن. */
export const AUDIT_ACTIONS = Object.freeze(
  Object.fromEntries(Object.keys(AUDIT_ACTION_META).map((key) => [key, key])),
);

const LABEL_TO_KEY = new Map(Object.entries(AUDIT_ACTION_META).map(([key, meta]) => [meta.label, key]));

/**
 * يحوّل قيمة `action` المخزنة إلى مفتاح نصي. سجلات قديمة كُتبت بالكائن
 * `{label, tone}` بدل المفتاح؛ تُطابق بالتسمية، وإلا تُعرض التسمية كما هي.
 */
export function normalizeAuditAction(action) {
  if (typeof action === 'string') return action;
  if (action && typeof action === 'object' && typeof action.label === 'string') {
    return LABEL_TO_KEY.get(action.label) || action.label;
  }
  return '';
}

export function auditActionLabel(action) {
  const key = normalizeAuditAction(action);
  return AUDIT_ACTION_META[key]?.label || key || 'إجراء غير معروف';
}

export function auditActionTone(action) {
  return AUDIT_ACTION_META[normalizeAuditAction(action)]?.tone || 'neutral';
}
