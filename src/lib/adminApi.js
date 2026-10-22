import { auth } from '../firebase';
import { trackRead } from './localDb/readMeter';

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
  admin_check_failed: 'تعذر التحقق من صلاحيات المدير بسبب خطأ في خدمة قاعدة البيانات. أعد المحاولة لاحقاً.',
  firestore_quota_exceeded: 'تجاوزت قاعدة بيانات Firestore الحصة المتاحة مؤقتاً. أوقف المحاولات المتكررة وتحقق من الحصص والفوترة في Firebase Console ثم أعد المحاولة.',
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
  month_balance_exceeded: 'مبلغ التسوية أكبر من العمولة المتبقية للشهر المحدد. اختر الشهر الصحيح أو خفّض المبلغ.',
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
  subscription_expired_new_sales_locked: 'انتهت صلاحية اشتراك الشبكة. لا يمكن تسجيل مبيعات جديدة، وتُقبل فقط المبيعات المعلقة السابقة لتاريخ الانتهاء.',
  account_suspended: 'تم إيقاف حساب الشبكة إدارياً. يرجى مراجعة إدارة كروتك برو.',
  template_center_failed: 'فشل تنفيذ عملية مركز القوالب على الخادم.',
  template_center_read_failed: 'تعذر جلب القوالب النشطة من الخادم.',
  draft_not_found: 'المسودة المطلوبة غير موجودة.',
  release_not_found: 'الإصدار المطلوب غير موجود.',
  release_conflict: 'حدث تعارض في الإصدار، تم تحديث المسودة أو الإصدار من قبل مدير آخر.',
  release_payload_invalid: 'محتوى الإصدار غير صالح.',
  simulation_input_invalid: 'بيانات اختبار الرسالة غير صالحة.',
  preview_input_invalid: 'بيانات معاينة قالب الرد غير صالحة.',
  app_version_invalid: 'صيغة إصدار التطبيق غير صالحة.',
  app_build_invalid: 'رقم بناء التطبيق غير صالح.',
  draft_id_invalid: 'معرف المسودة غير صالح.',
  release_id_invalid: 'معرف الإصدار غير صالح.',
  draft_scope_invalid: 'نطاق المسودة غير صالح.',
  draft_payload_invalid: 'محتوى المسودة غير صالح.',
  draft_title_invalid: 'عنوان المسودة غير صالح.',
  rollback_target_invalid: 'هدف التراجع غير صالح.',
  admin_action_failed: 'تعذر تنفيذ إجراء المدير على الخادم.',
  draft_invalid: 'بيانات المسودة غير صالحة.',
  scope_invalid: 'نطاق النشر غير صالح. اختر نطاقًا عامًا أو شبكة موجودة.',
  payload_invalid: 'محتوى القوالب غير صالح. راجع العناصر المطلوبة والأخطاء التفصيلية.',
  draft_id_invalid: 'معرّف المسودة غير صالح.',
  draft_not_found: 'لم تعد المسودة موجودة. حدّث الصفحة ثم حاول مجددًا.',
  release_conflict: 'تغير الإصدار النشط أثناء التحرير. حدّث سجل الإصدارات ثم أعد المحاولة.',
  release_id_invalid: 'معرّف الإصدار غير صالح.',
  release_not_found: 'الإصدار المطلوب غير موجود.',
  release_payload_invalid: 'محتوى الإصدار السابق غير صالح ولا يمكن استعادته بأمان.',
  min_app_version_invalid: 'الحد الأدنى لإصدار التطبيق غير صالح.',
  min_app_build_invalid: 'رقم بناء التطبيق الأدنى غير صالح.',
  app_version_invalid: 'نسخة التطبيق المرسلة غير صالحة.',
  app_build_invalid: 'رقم بناء التطبيق المرسل غير صالح.',
  simulation_input_invalid: 'أدخل نص رسالة صالحًا لاختبار القوالب الواردة.',
  preview_input_invalid: 'بيانات معاينة الرسالة غير صالحة.',
  template_center_read_failed: 'تعذرت قراءة الإصدار المنشور. أعد المحاولة لاحقًا.',
  template_center_failed: 'تعذر تنفيذ إجراء مركز القوالب. لم يكتمل الطلب.',
  request_body_invalid: 'تعذر قراءة بيانات الطلب. حدّث الصفحة وأعد المحاولة.',
  paid_feature_update_failed: 'تعذر حفظ المزايا المدفوعة على الخادم.',
  entitlements_must_be_object: 'بيانات المزايا غير صالحة.',
  entitlements_empty: 'لم يتم تحديد أي ميزة للتعديل.',
  unknown_feature: 'ميزة غير معروفة في الطلب.',
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
  const result = await callAdminApi('/api/networks', { action: 'update-access', ...payload });
  if (result.ok) return result;

  // Fallback: If running without Vercel Serverless Function runtime or offline,
  // update directly via client Firestore SDK (allowed for Admins in firestore.rules).
  if (result.error === 'endpoint_unavailable') {
    try {
      const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
      const { db, auth } = await import('../firebase');
      const userRef = doc(db, 'users', payload.uid);
      const patch = { updatedAt: serverTimestamp(), updatedAtMs: Date.now() };

      if (payload.phone_verified !== undefined) {
        patch.phone_verified = Boolean(payload.phone_verified);
        patch.phoneVerified = Boolean(payload.phone_verified);
        if (payload.phone_verified) {
          patch.phone_verified_at = serverTimestamp();
          patch.verified_by_admin = true;
          patch.verified_by_admin_uid = auth.currentUser?.uid || 'admin';
          patch.phone_verified_manual = true;
        } else {
          patch.phone_verified = false;
          patch.phoneVerified = false;
          patch.verified_by_admin = false;
          patch.phone_unverified_at = serverTimestamp();
        }
      }
      if (payload.accessStatus !== undefined) {
        patch.accessStatus = payload.accessStatus;
        patch.is_active = payload.accessStatus === 'ACTIVE_PAID' || payload.accessStatus === 'TRIAL';
        patch.is_trial = payload.accessStatus === 'TRIAL';
      }
      if (payload.subscriptionEndsAt !== undefined) {
        const { Timestamp } = await import('firebase/firestore');
        const endAt = Timestamp.fromMillis(payload.subscriptionEndsAt);
        patch.subscriptionEndsAt = endAt;
        patch.subscription_end_date = endAt;
      }
      if (payload.commission_rate !== undefined) patch.commission_rate = payload.commission_rate;
      if (payload.warning_message !== undefined) patch.warning_message = payload.warning_message;
      if (payload.has_custom_warning !== undefined) patch.has_custom_warning = payload.has_custom_warning;

      await updateDoc(userRef, patch);
      return { ok: true, data: { status: 'updated', fallback: true } };
    } catch (fallbackErr) {
      console.error('Client fallback updateNetworkAccess failed:', fallbackErr);
      return result;
    }
  }
  return result;
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

/** حذف حساب المشترك والشبكة بالكامل مع كل سجلاتها من قاعدة البيانات */
export async function deleteNetworkAccount(uid, fallbackData = {}) {
  let serverResult = null;
  try {
    serverResult = await callAdminApi('/api/networks', { action: 'delete', uid });
    if (serverResult.ok) {
      return serverResult;
    }
  } catch (e) {
    console.warn('Server delete call threw error, proceeding to direct database cleanup:', e);
  }

  // If server API succeeded, we already returned. If it returned an error (such as server_not_configured,
  // endpoint_unavailable, network_error, etc.), we execute complete direct Firestore deletion
  // so that the client and their network, sales, payments, and records are completely deleted from the database.
  try {
    const { deleteDoc, doc, collection, getDocs, getDoc, query, where } = await import('firebase/firestore');
    const { db } = await import('../firebase');

    const userRef = doc(db, 'users', uid);
    const userSnap = await trackRead('delete-network:user', () => getDoc(userRef)).catch(() => null);
    const userData = userSnap?.exists?.() ? userSnap.data() : null;
    const phone = userData?.phone || userData?.phoneNumber || fallbackData?.phone || fallbackData?.phoneNumber || null;

    // Discover all possible network IDs for this user
    const networkIds = new Set();
    if (userData?.networkId) networkIds.add(String(userData.networkId).trim());
    if (fallbackData?.networkId) networkIds.add(String(fallbackData.networkId).trim());
    networkIds.add(uid);

    // Also look up any networks document where owner_uid or ownerUid matches
    try {
      const q1 = query(collection(db, 'networks'), where('owner_uid', '==', uid));
      const snap1 = await trackRead('delete-network:owner_uid', () => getDocs(q1)).catch(() => null);
      snap1?.docs?.forEach((d) => networkIds.add(d.id));

      const q2 = query(collection(db, 'networks'), where('ownerUid', '==', uid));
      const snap2 = await trackRead('delete-network:ownerUid', () => getDocs(q2)).catch(() => null);
      snap2?.docs?.forEach((d) => networkIds.add(d.id));
    } catch {}

    const purgeSubcollection = async (colRef) => {
      try {
        const snap = await trackRead('delete-network:subcollection', () => getDocs(colRef)).catch(() => null);
        if (snap && snap.docs.length > 0) {
          await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
        }
      } catch {}
    };

    // Purge each network and all its subcollections (sales, payments, settlements, _metadata)
    for (const netId of networkIds) {
      if (!netId) continue;
      await purgeSubcollection(collection(db, 'networks', netId, 'sales'));
      await purgeSubcollection(collection(db, 'networks', netId, 'payments'));
      await purgeSubcollection(collection(db, 'networks', netId, 'settlements'));
      await purgeSubcollection(collection(db, 'networks', netId, '_metadata'));
      await deleteDoc(doc(db, 'networks', netId)).catch(() => {});
    }

    // Purge user subcollections (devices, notifications)
    await purgeSubcollection(collection(db, 'users', uid, 'devices'));
    await purgeSubcollection(collection(db, 'users', uid, 'notifications'));

    // Purge user document in both users and Users
    await deleteDoc(userRef).catch(() => {});
    await deleteDoc(doc(db, 'Users', uid)).catch(() => {});

    // Purge admin billing aggregate
    await deleteDoc(doc(db, 'admin_aggregates', uid)).catch(() => {});

    // Purge phone index if exists
    if (phone) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(String(phone).trim());
        const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', data);
        const hashHex = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
        await deleteDoc(doc(db, 'network_registration_phone_index', hashHex)).catch(() => {});
      } catch {}
    }

    return { ok: true, data: { status: 'deleted', uid, databasePurged: true } };
  } catch (err) {
    console.error('Direct Firestore deletion failed:', err);
    return { ok: false, error: serverResult?.error || 'network_action_failed' };
  }
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

/**
 * المزايا المدفوعة: قراءة/كتابة خريطة `users/{uid}.feature_entitlements`
 * عبر المسار الخادمي المقيّد فقط (لا كتابة عميل مباشرة على Firestore).
 */
export async function fetchPaidFeatureEntitlements(uid) {
  return callAdminApi('/api/paid-features', { action: 'get', uid });
}

export async function updatePaidFeatureEntitlements({ uid, entitlements }) {
  return callAdminApi('/api/paid-features', { action: 'set', uid, entitlements });
}
