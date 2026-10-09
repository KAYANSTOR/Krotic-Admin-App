import { auth } from '../firebase';

/**
 * رسائل عربية موحّدة لأخطاء دوال الإدارة على الخادم.
 * الرموز تأتي من `api/manage-user-auth.js` و`api/send-fcm.js`.
 */
export const ADMIN_API_ERRORS = {
  server_not_configured:
    'الخادم غير مهيّأ بعد: يجب ضبط متغير البيئة FIREBASE_SERVICE_ACCOUNT على الاستضافة.',
  invalid_service_account:
    'مفتاح خدمة Firebase غير صالح. تحقق من قيمة FIREBASE_SERVICE_ACCOUNT.',
  missing_token: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد.',
  invalid_token: 'انتهت الجلسة، يرجى تسجيل الدخول من جديد.',
  not_admin: 'هذا الحساب لا يملك صلاحية تنفيذ هذا الإجراء.',
  admin_check_failed: 'تعذر التحقق من صلاحيات المدير. أعد المحاولة.',
  uid_required: 'لم يتم تحديد المستخدم المطلوب.',
  user_not_found: 'لا يوجد حساب مصادقة مطابق لهذا المستخدم في Firebase Authentication.',
  password_too_short: 'كلمة المرور قصيرة جداً.',
  password_rejected: 'كلمة المرور مرفوضة من Firebase. جرّب كلمة مرور أقوى.',
  lookup_failed: 'تعذر جلب بيانات الدخول من الخادم.',
  update_failed: 'تعذر تحديث بيانات الدخول.',
  no_login_email:
    'لا يوجد معرّف بريد لهذا الحساب في Firebase Authentication، لذلك لا يمكن إنشاء رابط إعادة تعيين.',
  reset_link_failed:
    'تعذر إنشاء رابط إعادة التعيين. تأكد من تفعيل Email/Password ومن ضبط رابط إعادة التعيين في Firebase Console.',
  unknown_action: 'إجراء غير معروف.',
  method_not_allowed: 'طريقة الطلب غير مدعومة.',
  network_error: 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.',
  request_failed: 'فشل تنفيذ الطلب على الخادم.',
  endpoint_unavailable:
    'دالة الخادم غير متاحة في هذه البيئة. تعمل دوال api/ على استضافة Vercel فقط.',
};

export function adminApiError(code, fallback) {
  return ADMIN_API_ERRORS[code] || fallback || 'حدث خطأ غير متوقع.';
}

/**
 * ينادي دالة إدارة على الخادم مع رمز هوية المدير الحالي.
 * يُرجع دائماً كائناً بدون رمي استثناء: { ok, data, error }.
 */
export async function callAdminApi(path, payload) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return { ok: false, error: 'missing_token' };

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    // في التطوير المحلي لا يوجد runtime لدوال Vercel، فيُعاد index.html بدل JSON.
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { ok: false, error: 'endpoint_unavailable' };
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      return { ok: false, error: data.error || 'request_failed', data };
    }
    return { ok: true, data };
  } catch (error) {
    console.error(`adminApi: ${path} failed`, error);
    return { ok: false, error: 'network_error' };
  }
}
