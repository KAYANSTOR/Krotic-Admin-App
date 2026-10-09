import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

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
  SETTINGS_SAVE: { label: 'حفظ الإعدادات', tone: 'brand' },
  APP_STATUS_CHANGE: { label: 'تغيير حالة التطبيق', tone: 'danger' },
  SUBSCRIPTION_BATCH: { label: 'تحديث تواريخ مجمّع', tone: 'danger' },
  USER_PASSWORD_SET: { label: 'تعيين كلمة مرور', tone: 'warning' },
  USER_RESET_LINK: { label: 'إنشاء رابط إعادة تعيين', tone: 'warning' },
  ADMIN_CREATE: { label: 'إنشاء مدير', tone: 'brand' },
  ADMIN_DELETE: { label: 'حذف مدير', tone: 'danger' },
  DEVICE_DELETE: { label: 'حذف جهاز', tone: 'neutral' },
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
