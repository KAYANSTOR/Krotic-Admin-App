# دليل مطور لوحة التحكم - Krotak Pro

هذا الدليل يوضح هيكلية قواعد البيانات والمصادقة المطلوبة في **Firebase** لبرمجة لوحة التحكم الخاصة بإدارة تطبيق **Krotak Pro**.

---

## 1. الإعدادات العامة (Global Settings)
مستند واحد للتحكم بحالة التطبيق لجميع المستخدمين، والتحكم بالفترة التجريبية الافتراضية.
- **المسار:** `app_settings/global_config`
- **الحقول الدقيقة:**
  - `is_app_active` (Boolean): إذا تم تعديلها إلى `false`، سيتم إغلاق التطبيق عند جميع المستخدمين فوراً وإظهار شاشة صيانة. (الافتراضي: `true`)
  - `maintenance_message` (String - اختياري): الرسالة التي ستظهر للمستخدمين عند الإغلاق العام للصيانة.
  - `default_trial_days` (Number): عدد الأيام الافتراضية للفترة التجريبية لأي مستخدم جديد يسجل من التطبيق (مثلاً `3` أو `7`).
  - `default_trial_warning` (String): نص رسالة التحذير التي تظهر للمستخدم التجريبي.
  - `default_commission_rate` (Number): نسبة العمولة العامة الافتراضية.
  - `global_official_warning` (String): رسالة التحذير العامة للمستخدمين الرسميين.
  - `warning_days_before_expiry` (Number): عدد الأيام التي يظهر فيها التحذير قبل انتهاء الاشتراك.

---

## 2. إدارة المستخدمين (أصحاب الشبكات)

عندما يقوم مستخدم جديد بإنشاء حساب من التطبيق، سيقوم التطبيق برمجياً بـ:
1. إنشاء حسابه في Firebase Auth.
2. جلب عدد الأيام التجريبية `default_trial_days` من الإعدادات العامة.
3. إنشاء مستند له في مسار `users/{UID}` وحفظ تاريخ انتهاء فترته التجريبية.

**دور لوحة التحكم:**
إدارة هؤلاء المستخدمين (عرضهم، حظرهم، تمديد اشتراكهم، تحويلهم من تجريبي إلى رسمي).

- **المسار:** `users/{UID}`
- **الحقول:**
  - `is_active` (Boolean): حالة حساب العميل. إذا حولتها لـ `false` سيتم طرد العميل من التطبيق.
  - `is_trial` (Boolean): هل المستخدم لا يزال تجريبياً أم رسمياً.
  - `subscription_end_date` (Timestamp): تاريخ انتهاء الاشتراك أو التجربة.
  - `warning_message` (String): رسالة تحذير مخصصة لهذا العميل.
  - `commission_rate` (Number): نسبة عمولة خاصة بهذا الحساب (إن وُجدت).
  - `has_custom_warning` (Boolean): هل يستخدم رسالة تحذير مخصصة.

---

## 3. حفظ بيانات الشبكة (Network Metadata)
- **المسار:** `networks/{UID}/_metadata/info`
- **الحقول:**
  - `networkId` (String): وهو الـ `UID`.
  - `name` (String): اسم الشبكة.
  - `phoneNumber` (String): رقم هاتف صاحب الشبكة.
  - `description` (String): وصف.
  - `createdAt` (Number): تاريخ الإنشاء بصيغة Epoch Milliseconds.

---

## 4. إشعارات النظام

**أ. إشعارات عامة (للجميع):**
- **المسار:** `app_settings/global_config/notifications/{notificationId}`
- **الحقول:** `title`, `message`, `timestamp`

**ب. إشعارات لمستخدم محدد:**
- **المسار:** `users/{UID}/notifications/{notificationId}`
- **الحقول:** `title`, `message`, `timestamp`, `is_read`

---

## 5. سجلات المبيعات
- **المسار:** `networks/{UID}/sales/{saleId}`
- **الحقول:**
  - `saleId`, `categoryId`, `cardId`, `customerId`, `posId`
  - `faceValue` (Number): القيمة الاسمية
  - `commission` (Number): عمولة نقطة البيع
  - `netAmount` (Number): الصافي
  - `status`: `"COMPLETED"` | `"ROLLED_BACK"` | `"SMS_PENDING"`
  - `createdAt` (Number)

---

## 6. المدفوعات (من لوحة التحكم)
- **المسار:** `networks/{UID}/payments/{paymentId}`
- **الحقول:** `amount`, `month` (YYYY-MM), `timestamp`

---

## 7. حسابات المدراء
- **المسار:** `Admins/{UID}`
- **الحقول:** `uid`, `name`, `email`, `phone`, `createdAt`

---

## ملاحظات هامة

- يجب تفعيل **Email/Password** في Firebase Authentication.
- المشروع يعتمد فقط على متغيرات البيئة (ملف `.env`) ولا يحتوي على أي ربط ثابت بمشروع Firebase سابق.
- استخدم التطبيق الثانوي (`secondaryAuth`) عند إنشاء مدراء جدد حتى لا يتم تسجيل خروج المدير الحالي.
