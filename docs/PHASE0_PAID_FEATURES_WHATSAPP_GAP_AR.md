# تقرير فجوة المرحلة 0 — مزايا الحساب وتكامل WhatsApp

**التاريخ:** 2026-10-30  
**الفرع:** `تكامل-مزايا-المدفوعة`  
**المستودع:** `KAYANSTOR/Krotic-Admin-App`  
**القاعدة:** لا تُخترع مسارات API ولا مفاتيح ولا عقود غير معتمدة.

---

## 1) ما هو منفَّذ ومختبر فعلياً (مزايا الحساب)

### 1.1 المفاتيح المعتمدة (عقد الإدارة فقط — 4 مفاتيح)

المصدر: `docs/ACCOUNT_FEATURES_ACK_CONTRACT_AR.md` + `server/_lib/accountFeatures.js` + `contracts/fixtures/account-features-catalog.sample.json`

| المفتاح | الوصف | الافتراضي |
|---|---|---|
| `mikrotik_card_generator` | توليد وطباعة الكروت | `false` |
| `hotspot_template_editor` | محرر صفحات الهوتسبوت | `false` |
| `sms_auto_parser` | تحليل رسائل المحافظ والحوالات | `false` |
| `advanced_analytics` | التقارير المالية المتقدمة | `false` |

**لا يوجد مفتاح خامس معتمد** في أي عقد منشور في `Krotic-Admin-App` أو `Krotak-Pro` وقت الفحص.

### 1.2 مخطط البيانات المعتمد

```text
app_settings/account_features_catalog
  schema_version: 1
  updated_at_ms: number
  features: [{ key, label_ar, description_ar, default: false, status: active|retired, min_app_build }]

users/{uid}
  account_features: { [key]: boolean }   // Fail-Closed: غياب المفتاح = false
  account_features_version: 1
  account_features_updated_at_ms: number
  account_features_updated_by: adminUid
  account_features_source: "admin_api"
  updatedAtMs: number

users/{uid}/account_feature_audit/{id}
  previous, next, changed_keys, actor_uid, account_uid, created_at_ms
```

### 1.3 مسار API الفعلي

- `POST /api/admin/account-features` → rewrite إلى `api/settings.js?__apiRoute=account-features`
- الإجراءات: `catalog` | `get` | `set`
- التحقق: `authenticateAdmin` قبل أي قراءة/كتابة
- رفض الحساب غير الموجود: `404 account_not_found`
- قبول مفاتيح الكتالوج النشطة وقيم Boolean فقط
- الكتابة ذرّية + أثر تدقيق في `account_feature_audit`

### 1.4 الواجهة الإدارية

- المسار: `/paid-features` (العنوان الظاهر: مزايا الحساب)
- الملف: `src/pages/PaidFeaturesPage.jsx`
- الكتابة عبر `updateAccountFeatures` في `src/lib/adminApi.js` فقط (لا كتابة عميل مباشرة)

### 1.5 الأمان (Firestore Rules)

- `account_features` و`account_features_*` محظورة من كتابة العميل
- `account_feature_audit` كتابة خادمية فقط (Admin SDK)
- فحص `scripts/check-rules.mjs` يتأكد من وجود هذه القيود

### 1.6 الاختبارات الموجودة

- `test/accountFeatures.test.js` — catalog / get / set / صلاحيات / fail-closed / حساب غير موجود
- `test/contracts.test.js` — تطابق مفاتيح الكتالوج مع العقد
- `security-tests/firestore-rules.test.js` (عند توفر المحاكي)

---

## 2) ما يمنع إغلاق المرحلة 0 كما طُلبت

### 2.1 عقود WhatsApp غير موجودة

طُلب الرجوع إلى:

1. `Krotak-Pro/docs/contracts/whatsapp-delivery-and-recharge-policy.md`
2. `Krotak-Pro/docs/PAID_FEATURES_WHATSAPP_SMART_ROUTING_PHONE_RECHARGE_AR.md`

**النتيجة بعد الفحص على `Krotak-Pro` (main @ 0fd373a):** الملفان **غير موجودين**.  
لا يوجد مجلد `docs/contracts/`، ولا أي ذكر لمسارات Webhook Meta أو Local Gateway أو `providerId + inboundMessageId` في كود الإدارة.

### 2.2 المفتاح الخامس

طلب المالك «خمس ميزات». العقد المنشور يعتمد **أربعة** مفاتيح فقط.  
إضافة مفتاح خامس (مثل ربط WhatsApp) **يتطلب عقداً مكتوباً ومعتمداً** قبل تغيير `ACCOUNT_FEATURE_CATALOG`.

### 2.3 بنية WhatsApp الخادمية

لا يوجد في `Krotic-Admin-App` حالياً:

- تخزين مشفّر لأسرار Meta
- تحقق توقيع Webhooks الواردة من Meta
- استقبال أحداث Local Gateway مع تحقق المصدر
- idempotency على `providerId + inboundMessageId`
- فصل استقبال الأحداث عن معالجة سلفني/إصدار الكرت
- اختيار مزود WhatsApp الأساسي لكل شبكة

**بناء أي مسار دون العقد يُعتبر اختراعاً مرفوضاً صراحة.**

---

## 3) متطلبات خارجية لإغلاق المرحلة 0

| # | المطلوب من المالك / عقد Android | الحالة |
|---|---|---|
| 1 | نشر عقد `whatsapp-delivery-and-recharge-policy.md` في `Krotak-Pro` | ❌ غائب |
| 2 | نشر وثيقة `PAID_FEATURES_WHATSAPP_SMART_ROUTING_PHONE_RECHARGE_AR.md` | ❌ غائبة |
| 3 | اعتماد اسم المفتاح الخامس (إن وُجد) نصاً في العقد | ❌ غير معتمد |
| 4 | تحديد مسارات Webhook / Gateway / حقول idempotency في العقد | ❌ غير معتمدة |
| 5 | تحديد خوارزمية تشفير أسرار Meta وموقع التخزين الخادمي | ❌ غير معتمدة |
| 6 | قرار: هل تبقى المزايا 4 أم تصبح 5 بعد العقد | ⏳ بانتظار المالك |

---

## 4) ما يمكن اعتباره مكتملاً ضمن نطاق العقود الحالية

| بند إغلاق المرحلة 0 | الحالة |
|---|---|
| كتالوج ميزات معتمد في `app_settings/account_features_catalog` | ✅ منفَّذ (4 مفاتيح) |
| لوحة إدارة تكتب `users/{uid}.account_features` | ✅ منفَّذ |
| صلاحيات مسؤول + منع تعديل العميل | ✅ منفَّذ + قواعد |
| Fail-Closed عند غياب البيانات | ✅ `normalizeAccountFeatures` |
| تدقيق التفعيل/التعطيل | ✅ `account_feature_audit` |
| تخزين مشفّر لأسرار Meta | ❌ محظور بلا عقد |
| تحقق Webhooks Meta | ❌ محظور بلا عقد |
| أحداث Gateway + منع التكرار | ❌ محظور بلا عقد |

**خلاصة:** لا تُعلن المرحلة 0 مكتملة. شق مزايا الحساب (4 مفاتيح) جاهز ضمن العقد الحالي. شق WhatsApp **موقوف** حتى نشر العقود المطلوبة في `Krotak-Pro` واعتماد المفتاح الخامس إن لزم.

---

## 5) إجراء مقترح بعد اعتماد العقود

1. تثبيت ملفات العقد في `Krotak-Pro/docs/...`.
2. إن وُجد مفتاح خامس: تحديث `ACCOUNT_FEATURE_CATALOG` + الـ fixture + الاختبارات + شاشة `/paid-features`.
3. تنفيذ مسارات Webhook/Gateway **فقط** بالأسماء والحقول الواردة في العقد.
4. اختبارات: توقيع خاطئ، تكرار حدث، فشل خادم، عدم تسريب أسرار، fail-closed.
5. لا نشر إنتاج ولا لمس `main` دون موافقة صريحة.
