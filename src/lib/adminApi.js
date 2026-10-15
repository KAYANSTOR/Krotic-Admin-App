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
  uid_invalid: 'معرّف المستخدم غير صالح.',
  amount_invalid: 'المبلغ غير صالح.',
  month_invalid: 'الشهر غير صالح (الصيغة المطلوبة YYYY-MM).',
  extension_days_invalid: 'مدة التمديد يجب أن تكون 0 أو 30 يوماً.',
  idempotency_key_invalid: 'مفتاح العملية غير صالح.',
  payment_conflict: 'توجد دفعة أخرى بنفس مفتاح العملية وبمحتوى مختلف. أعد تحميل السجل.',
  settlement_conflict: 'يوجد اعتماد تسوية بنفس مفتاح العملية وببيانات مختلفة.',
  record_failed: 'تعذر تسجيل الدفعة على الخادم.',
  settlement_failed: 'تعذر اعتماد التسوية على الخادم.',
  settings_failed: 'تعذر حفظ الإعدادات على الخادم.',
  network_action_failed: 'تعذر تنفيذ إجراء الشبكة على الخادم.',
  repair_limit_invalid: 'حجم دفعة إصلاح حالات الوصول غير صالح.',
  owner_uid_invalid: 'معرّف مالك الشبكة غير صالح.',
  access_status_invalid: 'حالة الوصول غير صالحة.',
  subscription_end_invalid: 'تاريخ الانتهاء غير صالح.',
  commission_rate_invalid: 'نسبة العمولة يجب أن تكون بين 0 و100.',
  warning_message_invalid: 'رسالة التحذير غير صالحة.',
  has_custom_warning_invalid: 'قيمة تخصيص التحذير غير صالحة.',
  no_fields: 'لم يتم إرسال أي حقل للتعديل.',
  account_not_found: 'لا يوجد حساب مطابق لهذا المعرّف.',
  hmac_not_configured: 'الخادم غير مهيّأ: أضف KROTAK_HMAC_SECRET إلى بيئة Vercel ثم أعد النشر.',
  network_secret_unavailable: 'تعذر فك مفتاح الشبكة. تحقّق من Master Secret في Vercel قبل إعادة المحاولة.',
  default_trial_days_out_of_range: 'الأيام التجريبية يجب أن تكون بين 0 و30.',
  default_trial_days_invalid: 'الأيام التجريبية يجب أن تكون عدداً صحيحاً.',
  default_commission_rate_out_of_range: 'العمولة العامة يجب أن تكون بين 0 و20.',
  warning_days_before_expiry_out_of_range: 'أيام التحذير يجب أن تكون بين 1 و7.',
  is_app_active_invalid: 'قيمة حالة التطبيق غير صالحة.',
  email_already_in_use: 'هذا البريد الإلكتروني مستخدم بالفعل.',
  email_invalid: 'البريد الإلكتروني غير صالح.',
  name_invalid: 'الاسم غير صالح.',
  phone_invalid: 'رقم الهاتف غير صالح.',
  cannot_modify_self: 'لا يمكنك تعديل أو حذف حسابك الحالي.',
  admin_action_failed: 'تعذر تنفيذ إجراء المدير على الخادم.',
};

/** يسجّل دفعة/تسوية عبر الخادم الآمن idempotent. */
export async function recordPayment({ uid, amount, month, idempotencyKey, note }) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return { ok: false, error: 'missing_token' };
  try {
    const response = await fetch('/api/record-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ uid, amount, month, idempotencyKey, note }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return { ok: false, error: 'endpoint_unavailable' };
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) return { ok: false, error: data.error || 'request_failed', data };
    return { ok: true, data };
  } catch (error) {
    console.error('recordPayment failed', error);
    return { ok: false, error: 'network_error' };
  }
}

function newIdempotencyKey(prefix = 'admin') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
}

export function createAdminIdempotencyKey(prefix) {
  return newIdempotencyKey(prefix);
}

export async function approveSettlement({ uid, amountMinor, month, extensionDays = 0, note = '', idempotencyKey }) {
  return callAdminApi('/api/settlement', {
    uid,
    amountMinor,
    month,
    extensionDays,
    note,
    idempotencyKey: idempotencyKey || newIdempotencyKey(`settlement-${uid}`),
  });
}

/** يحدّث الإعدادات العامة عبر المسار الخادمي المقيّد POST /api/settings. */
export async function updateSettings(patch) {
  return callAdminApi('/api/settings', patch);
}

/** إجراءات إدارة الشبكة والوصول عبر POST /api/networks (خادمي فقط). */
export async function provisionNetwork(ownerUid) {
  return callAdminApi('/api/networks', { action: 'provision', ownerUid });
}

export async function updateNetworkAccess(payload) {
  return callAdminApi('/api/networks', { action: 'update-access', ...payload });
}

export async function renewNetwork(uid, extensionDays = 30) {
  return callAdminApi('/api/networks', { action: 'renew', uid, extensionDays });
}

export async function batchExpiry(subscriptionEndsAt) {
  return callAdminApi('/api/networks', { action: 'batch-expiry', subscriptionEndsAt });
}

/** إصلاح دفعة واحدة من سجلات الوصول القديمة، مع متابعة cursor إلى أن ينتهي الترحيل. */
export async function repairAccessPage(cursor = null, limit = 100) {
  return callAdminApi('/api/networks', { action: 'repair-access', cursor, limit });
}

/** إدارة المدراء عبر POST /api/admins (قرار و3: خادمي فقط). */
export async function createAdminAccount(payload) {
  return callAdminApi('/api/admins', { action: 'create', ...payload });
}

export async function listAdminAccounts() {
  return callAdminApi('/api/admins', { action: 'list' });
}

export async function updateAdminAccount(uid, patch) {
  return callAdminApi('/api/admins', { action: 'update', uid, ...patch });
}

export async function deleteAdminAccount(uid) {
  return callAdminApi('/api/admins', { action: 'delete', uid });
}

export function adminApiError(code, fallback) {
  return ADMIN_API_ERRORS[code] || fallback || 'حدث خطأ غير متوقع.';
}

/**
 * يشغّل إرسال الإشعارات المجدولة المستحقة عند فتح اللوحة (best-effort).
 * البديل المجاني للمُجدوِل في Cloud Functions (يحتاج Blaze)، ويكمل Cron اليومي
 * على باقة Vercel Hobby المحدودة بمرة واحدة يومياً. لا يرمي استثناء أبداً.
 */
export async function triggerScheduledDispatch() {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return null;
    const response = await fetch('/api/dispatch-notifications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
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
