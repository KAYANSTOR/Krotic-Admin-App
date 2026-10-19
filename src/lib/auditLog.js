import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase.js';

/**
 * سجل تدقيق إداري: يوثّق كل إجراء مؤثر يقوم به المدير.
 * الكتابة best-effort: فشل التسجيل لا يُفشل الإجراء الأصلي.
 */
export const AUDIT_COLLECTION = 'admin_audit_logs';

export const AUDIT_ACTIONS = {
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
  USER_PHONE_VERIFY_MANUAL: { label: 'تفعيل رقم الهاتف يدوياً (دعم فني)', tone: 'success' },
  USER_PHONE_UNVERIFY: { label: 'إلغاء توثيق الهاتف', tone: 'warning' },
  ADMIN_PASSWORD_CHANGE: { label: 'تغيير كلمة مرور المدير', tone: 'brand' },
  // عمليات خادمية ومبيعات وتدقيق متقدم
  SETTLEMENT_RECORD: { label: 'تسوية مبيعات واعتماد عمولة', tone: 'success' },
  NETWORK_REGISTER: { label: 'تسجيل شبكة جديدة', tone: 'brand' },
  NETWORK_RENEW: { label: 'تجديد اشتراك شبكة (خادمي)', tone: 'brand' },
  NETWORK_ACCESS_UPDATE: { label: 'تعديل صلاحيات شبكة (خادمي)', tone: 'neutral' },
  NETWORK_DELETE: { label: 'حذف شبكة وبياناتها', tone: 'danger' },
  SUBSCRIPTION_EXPIRY_CRON: { label: 'فحص انتهاء الاشتراكات (Cron خادمي)', tone: 'warning' },
  TEMPLATE_DRAFT_CREATE: { label: 'إنشاء مسودة قوالب', tone: 'brand' },
  TEMPLATE_DRAFT_UPDATE: { label: 'تعديل مسودة قوالب', tone: 'neutral' },
  TEMPLATE_DRAFT_DELETE: { label: 'حذف مسودة قوالب', tone: 'danger' },
  TEMPLATE_RELEASE_PUBLISH: { label: 'نشر إصدار قوالب نشط', tone: 'success' },
  TEMPLATE_RELEASE_ROLLBACK: { label: 'تراجع عن إصدار قوالب', tone: 'warning' },
  SALE_CONFLICT_DETECTED: { label: 'تعارض في معرّف أو محتوى بيع', tone: 'danger' },
  LEGACY_SALES_RECONCILE: { label: 'تسوية ومطابقة مبيعات قديمة يدوياً', tone: 'warning' },
  COMMISSION_AUDIT_VERIFIED: { label: 'تدقيق واعتماد كشف حساب الشبكة', tone: 'success' },
};

export function auditActionLabel(action) {
  return AUDIT_ACTIONS[action]?.label || action || 'إجراء غير معروف';
}

export function auditActionTone(action) {
  return AUDIT_ACTIONS[action]?.tone || 'neutral';
}

export async function logAdminAction({ action, targetType, targetId, targetLabel, details }) {
  const actor = auth.currentUser;
  try {
    await addDoc(collection(db, AUDIT_COLLECTION), {
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      targetLabel: targetLabel || null,
      details: details || null,
      actorUid: actor?.uid || null,
      actorEmail: actor?.email || null,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    });
    return true;
  } catch (error) {
    // لا نُفشل الإجراء الأصلي بسبب تعذّر التسجيل.
    console.warn('audit log write failed', error);
    return false;
  }
}
