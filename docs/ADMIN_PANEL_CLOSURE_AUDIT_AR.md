# تدقيق إغلاق لوحة الإدارة — 2026-10-23

> **الغرض:** هذه هي الوثيقة المرجعية لـ«إغلاق موضوع لوحة الإدارة» قبل الانتقال إلى
> تطبيق Android. تفصل بوضوح بين: (1) ما هو منفَّذ ومُختبَر في الكود، (2) ما أُصلح
> في هذه الجولة، (3) ما لا يمكن إغلاقه من الكود لأنه يحتاج قرار مالك أو نشرًا أو
> بيانات إنتاج، (4) ما ينتقل إلى مرحلة Android.
>
> **الفرع:** `cline/4xdamfpg` (من `cline/f0d32hzt`). لا دمج إلى `main` ولا نشر
> إنتاجي ضمن هذا التدقيق.

---

## 1) ملخص تنفيذي

لوحة الإدارة **مكتملة وظيفيًا في نطاق الكود المتفق عليه**:

- كل الشاشات الإدارية تقرأ من القاعدة المحلية (IndexedDB) عبر `useLocalQuery`،
  والمزامنة التزايدية وحدها تقرأ Firestore.
- كل الكتابات الإدارية الحساسة (الوصول، الحذف، المدراء، الإعدادات، المدفوعات،
  القوالب، مزايا الحساب) تمر عبر مسارات خادمية محمية، وقواعد Firestore تمنع
  كتابة العميل عليها.
- مركز القوالب (محافظ/وارد/صادر/إصدارات/تسوية) يعمل عبر `/api/template-center`
  مع نشر وتراجع وإصدارات غير قابلة للتعديل وACK لكل جهاز.
- مزايا الحساب تعمل عبر `account_features` فقط، والكتابة ذرّية مع تدقيق.

لكن **لا يجوز إعلان «الإغلاق الإنتاجي»** قبل تنفيذ بوابات النشر والترحيل
والتحقق الحي في القسم 4. هذه البوابات ليست عملًا برمجيًا متبقيًا، لكنها شروط
قبول لا يمكن تنفيذها من هذه البيئة (تحتاج حساب Firebase/Vercel وموافقة صريحة).

**النتيجة الآلية لهذه الجولة:**

| الفحص | النتيجة |
|---|---|
| `npm test` | **327/327 ناجح** |
| `npm run lint` (قواعد ثابتة) | ناجح |
| `npm run build` | ناجح (تحذير حجم حزمة Firebase فقط) |
| `cd functions && npm test` | **20/20 ناجح** |
| `npm run test:rules` (محاكي) | **لم يُشغَّل**: لا يوجد Java 21 في هذه البيئة |
| فحص `no-undef` للخادم | لا أخطاء حقيقية (بعد إصلاح `DEVICE_ACKS`) |

---

## 2) ما أُصلح في هذه الجولة (عيوب حقيقية)

### 2.1 `device-acks` كان يستخدم ثابتًا غير معرّف

- **الملف:** `server/_lib/templateCenterApi.js`
- **العطل:** `db.collection(DEVICE_ACKS)` و`DEVICE_ACKS` غير معرّف، وأي نداء
  لهذا الإجراء كان سيرمي استثناءً في الإنتاج.
- **الإصلاح:** صار يستخدم `collectionGroup('template_acks')` مع فلترة
  `applied_version_id` وتمرير النتائج عبر `ackAdminView`.
- **الحارس:** اختبار جديد في `test/templateCenterApi.test.js`.

### 2.2 الإشعار العام لم يكن يحمل `updatedAtMs`

- **الملفات:** `api/send-fcm.js` و`functions/index.js`
- **العطل:** سجل `notification_deliveries` للإرسال العام (Topic) كان يُكتب بدون
  `updatedAtMs`، والمزامنة التزايدية تقرأ بهذا الحقل فقط. النتيجة: الإشعارات
  العامة لا تظهر أبدًا في «سجل الإشعارات» المحلي.
- **الإصلاح:** دالة بناء سجل موحّدة في المسارين (`buildDeliveryHistory` /
  `buildDeliveryRecord`) تضيف `timestamp` و`createdAtMs` و`updatedAtMs`.
- **الحارس:** اختباران في `test/sendFcm.test.js` واختباران في
  `functions/test/notificationDelivery.test.js`.

### 2.3 سجل العمليات المكتوب من المتصفح لم يكن يحمل `updatedAtMs`

- **الملف:** `src/lib/auditLog.js`
- **العطل:** كل حدث تدقيق يُسجّله المدير من الواجهة (حظر مستخدم، حذف جهاز، إنشاء
  مدير، حذف إشعار...) كان يُكتب بدون `updatedAtMs`، فلا يدخل القاعدة المحلية
  ولا يظهر في شاشة «سجل العمليات».
- **الإصلاح:** إضافة `updatedAtMs: now` مع `createdAtMs`.
- **الحارس:** حارس في `test/localFirstGuards.test.js`.

### 2.4 حذف سجل الإشعار كان يحاول الكتابة المباشرة رغم منع القواعد

- **الملف:** `src/pages/NotificationsPage.jsx`
- **العطل:** بعد نجاح الحذف الخادمي كان الكود يحاول `deleteDoc` مباشرة على
  `notification_deliveries` (ممنوع بقاعدة `allow write: if false`)، ويفشل بصمت،
  ثم يعرض «تم الحذف» حتى لو فشل الخادم.
- **الإصلاح:** الحذف عبر `/api/send-fcm` فقط، والتحقق من `response.ok` و
  `result.success` قبل إظهار النجاح/كتابة التدقيق.
- **الحارس:** حارس يمنع `deleteDoc` في شاشة الإشعارات.

### 2.5 سكربت ترحيل `updatedAtMs` كان لا يغطي كل مصادر المزامنة

- **الملف:** `scripts/backfill-updated-at.mjs`
- **العطل:** كان يغطي `users/networks/sales/payments/admin_aggregates/app_settings`
  فقط، بينما المزامنة تقرأ أيضًا `admin_audit_logs` و`notification_deliveries`
  و`Admins`. الوثائق القديمة في هذه المجموعات تبقى غير مرئية إلى الأبد.
- **الإصلاح:** إضافة المجموعات الثلاث.
- **الحارس:** اختبار يقارن مجموعات `syncEngine.js` بأهداف السكربت.

### 2.6 زر «مزامنة كاملة» كان موثّقًا وغير موجود

- **الملف:** `src/pages/SettingsPage.jsx`
- **العطل:** `resetSyncCursors` موجودة لكنها غير مستخدمة، والوثائق تذكر زرًا في
  الإعدادات. بعد ترحيل `updatedAtMs`، أي جهاز سبق أن زامن قبل الترحيل يحتاج
  إعادة قراءة كاملة، ولم تكن هناك طريقة من الواجهة.
- **الإصلاح:** بطاقة «إعادة المزامنة الكاملة» مع تأكيد كتابي (`تأكيد`)، تستدعي
  `resetSyncCursors(localDb)` ثم `runSync({ reason: 'manual' })`.
- **الحارس:** حارس في `test/localFirstGuards.test.js`.

### 2.7 قراءة إضافية للمصادر الفارغة

- **الملف:** `src/lib/localDb/syncCore.js`
- **العطل:** كل مصدر فارغ (أو لم يُرحَّل بعد) كان يكلّف قراءتين: فحص `latestMs`
  ثم استعلام سحب يعود فارغًا، في كل مزامنة.
- **الإصلاح:** إذا كان `latestMs === 0` يُتخطى السحب مع إبقاء المؤشر صفرًا، حتى
  تظهر وثائق فعلية (بما فيها التي يعطيها الترحيل `updatedAtMs = 1`).
- **الحارس:** اختبار في `test/syncEngine.test.js`.

### 2.8 تنظيف استيرادات ميتة

- `src/contexts/AuthContext.jsx`: إزالة `createUserWithEmailAndPassword` و`setDoc`
  و`secondaryAuth`/`secondarySignOut` غير المستخدمة.
- `src/pages/SettingsPage.jsx`: إزالة استيرادات Firestore و`billingHelpers` التي
  لم تبقَ مستخدمة بعد الترحيل الخادمي.

### 2.9 وثيقة المالك الأساسي في `Admins` كانت بلا `updatedAtMs`

- **الملفات:** `server/_lib/firebaseAdmin.js` و`api/admin-session.js`
- **العطل:** مسار bootstrap يكتب `Admins/{uid}` بدون `updatedAtMs`، فلا يظهر
  المالك الأساسي في قائمة المدراء المحلية.
- **الإصلاح:** إضافة `createdAtMs` و`updatedAtMs` في المسارين.
- **الحارس:** اختبار في `test/adminBootstrap.test.js`.

### 2.10 المدير القديم في `admins` كان يُرفض خادميًا

- **الملف:** `server/_lib/firebaseAdmin.js`
- **العطل:** `AuthContext` وقواعد Firestore يقبلان `Admins` و`admins`، لكن فحص
  الخادم `isAdminUid` كان يقرأ `Admins` فقط. مدير قديم في `admins` يستطيع الدخول
  ثم تفشل كل إجراءاته الخادمية بـ`403`.
- **الإصلاح:** fallback إلى `admins` عند غياب `Admins`، مع إضافة حقول المزامنة
  لوثيقة المالك الأساسي في مسار self-heal.
- **الحارس:** اختبار في `test/admins.test.js`.

### 2.11 تعارض قناة Android بين مساري الإرسال

- **الملف:** `functions/index.js`
- **العطل:** مسار Vercel يستخدم `krotak_admin_v2` افتراضيًا، بينما الدالة كانت
  تستخدم `krotak_admin`. على جهاز يعرّف قناة واحدة فقط، قد لا يظهر الإشعار.
- **الإصلاح:** توحيد الافتراضي إلى `krotak_admin_v2` مع احترام
  `FCM_ANDROID_CHANNEL_ID`.
- **الحارس:** اختبار يقارن الملفات الثلاثة في `test/sendFcm.test.js`.


---

## 3) حالة الشاشات والنطاق (تدقيق وظيفي)

| النطاق | الحالة | الدليل |
|---|---|---|
| تسجيل الدخول والجلسة | ✅ | `AuthContext` يتحقق من `Admins/{uid}` (أو `admins`) وخادم `admin-session` |
| لوحة المعلومات | ✅ | `DashboardPage` + `loadLocalDashboard` + إصلاح المجاميع عبر `/api/migrate` |
| المستخدمون والفلاتر والإصدارات | ✅ | `UsersPage` + `mergeUsersWithNetworks` + `appVersion` |
| ملف المستخدم والفوترة | ✅ | `UserProfilePage` + `loadLocalBillingHistory` + `recordPayment`/`approveSettlement` |
| المبيعات والعمولات | ✅ | `SalesPage` + `salesForNetwork` مع مسار UID القديم |
| الإشعارات (فوري/عام/مجدول/سجل) | ✅ | `NotificationsPage` + `/api/send-fcm` + `/api/dispatch-notifications` |
| الإعدادات العامة | ✅ | `SettingsPage` + `/api/settings` بعد الترحيل الخادمي |
| إدارة المدراء | ✅ | `AdminsPage` + `/api/admins` (إنشاء/حذف/كلمة مرور) |
| سجل العمليات | ✅ | `AuditPage` + `audit_logs` (صار يشمل أحداث المتصفح بعد 2.3) |
| مركز القوالب (5 تبويبات) | ✅ | `/api/template-center`: مسودات، نشر، تراجع، إصدارات، ACK |
| مزايا الحساب | ✅ | `/api/admin/account-features` + `account_features` |
| المحافظ كمصادر رسائل | ⚠️ | المحرر يعمل، لكن **مفتاح المحفظة الثابت** قرار مالك |
| حالة التطبيق على الأجهزة | ⚠️ | تبقى `Unknown` حتى يرسل Android ACK؛ لا ادعاء تطبيق |
| مخزون الكروت | ⚠️ | «غير متاح» عمدًا؛ لا مصدر مركزي حسب قرار Spark |
| مزامنة كاملة يدوية | ✅ | أُضيفت في هذه الجولة (2.6) |

---

## 4) ما تبقّى لإغلاق اللوحة فعليًا (ليس كودًا)

### 4.1 بوابة النشر (بالترتيب)

1. **Firestore Rules**:
   `firebase deploy --only firestore:rules`
   بدونها تفشل قراءة `collectionGroup('sales'/'payments')` وتبدو اللوحة فارغة.
2. **Firestore Indexes**:
   - خذ نسخة: `firebase firestore:indexes > indexes.production.json`
   - قارن، ثم `firebase deploy --only firestore:indexes`
   - انتظر `Enabled` على `sales.updatedAtMs` و`payments.updatedAtMs`، وفهارس
     `template_acks` على `synced_at` و`applied_version_id` (Collection Group).
3. **Vercel**: نشر الواجهة + rewrites الجديدة
   (`/api/admin/account-features`, `/api/template-center`).
   - فحص سريع: `POST /api/admin/account-features` بلا توكن يجب أن يعيد `401`،
     وليس `404`.
4. **Cloud Functions** (اختياري حسب قرار Spark/Blaze):
   `firebase deploy --only functions` — ضروري فقط إن أردت تحديث
   `admin_aggregates.updatedAtMs` من الدوال بدل زر الإصلاح.

### 4.2 بوابة الترحيل (قبل أول استخدام جدي)

1. شغّل dry-run:
   `GOOGLE_CLOUD_PROJECT=<project> GOOGLE_APPLICATION_CREDENTIALS=<sa.json> node scripts/backfill-updated-at.mjs`
2. راجع الأعداد (`scanned/missing/noDate`) وأرسلها للمالك.
3. بعد موافقة صريحة:
   `... node scripts/backfill-updated-at.mjs --apply --confirm-project=<project>`
4. **مهم:** إن كان جهاز مدير قد زامن قبل الترحيل، اضغط «إعادة المزامنة الكاملة»
   في الإعدادات بعد الترحيل. بدون ذلك يبقى مؤشر المزامنة متقدمًا على الوثائق
   التي أخذت `updatedAtMs` صغيرًا.

### 4.3 بوابة القبول الحي

- افتح اللوحة بحساب مدير وتأكد من: المستخدمون، المبيعات، الإشعارات، القوالب،
  مزايا الحساب.
- افتح `?debug=reads` وسجّل: أول فتح، تنقل بين الصفحات، تحديث بلا تغييرات،
  تحديث بعد تغيير معروف.
- املأ عمود «المقيس فعليًا» في `docs/PERF_BASELINE_AR.md` من Firebase Console.
- اختبر مسار ACK من جهاز Android تجريبي (أو طلب اصطناعي موثّق) وتأكد أن الحالة
  تنتقل من «غير معروف» إلى «مطابق».

### 4.4 قرارات المالك المفتوحة (لا يخمّنها الوكيل)

| # | القرار | الأثر إن بقي معلقًا |
|---|---|---|
| 1 | **مفتاح المحفظة الثابت** (`WalletSpec.key` مقابل معرّف وقت التشغيل) | لا مطابقة آلية بين اللوحة وجهاز Android؛ تبقى `needs_decision` |
| 2 | مصدر الإجماليات: `admin_aggregates` أم إعادة حساب | أرقام اللوحة تعتمد على المجاميع الخادمية الحالية |
| 3 | قبول قراءة كاملة أولى لكل جهاز | سلوك المزامنة الحالي: قراءة كاملة مرة واحدة |
| 4 | تفريغ IndexedDB عند الخروج | السلوك الحالي: **يُفرَّغ** (تغييره يحتاج قرارًا) |
| 5 | Spark أم Blaze | يحدد نشر Functions وCron والجدولة |
| 6 | `backups/*.json` | التاريخ أُخرج من الفهرس فقط، والحذف يحتاج موافقة |
| 7 | كتابة Android المباشرة للمبيعات (`status=COMPLETED`) | القواعد تسمح بها انتقاليًا؛ إغلاقها يحتاج قرارًا + تحديث Android |
| 8 | وحدة المال (`amountMinor` مقابل الوحدات الكبرى) | يبقى خطر اختلاف في التسويات القديمة |
| 9 | إشعارات مجدولة: من ينفّذها ومتى | Vercel Hobby يقيّد Cron بمرة يوميًا |

---

## 5) الدين التقني المعروف (مقصود، ليس عطلًا)

1. **`UserDevicesPanel`** يقرأ `users/{uid}/devices` بـ`getDocs` مباشرة. مجموعة
   فرعية لمستخدم واحد، وموثّقة كدين. نقلها إلى المزامنة يحتاج مصدر
   `collectionGroup('devices')` + قاعدة + فهرس + ترقية مخطط IndexedDB.
2. **الفحص التزايدي = 10 قراءات** (مصدر لكل مجموعة) مقابل هدف ≈6. التحسين
   الكامل يحتاج مؤشرًا مجمعًا (`sync_meta`) وتغييرًا على عقد المزامنة.
   تحسين المصادر الفارغة في 2.7 يقلل الاستهلاك لكنه لا يغيّر العدد النظري.
3. **مركز القوالب ليس محليًا أولًا** — عمدًا: قواعد Firestore تمنع قراءة
   المسودات/الإصدارات من العميل، وكل القراءة عبر API خادمي.
4. **لا شاشة لعرض/إلغاء الطلبات المجدولة** قبل تنفيذها؛ السجل يعرض ما أُرسل فقط.
5. **حالة تطبيق Android** تبقى `Unknown` حتى يصل ACK موثوق؛ هذا سلوك مقصود.

---

## 6) ما ينتقل إلى مرحلة Android (بعد إغلاق اللوحة)

يجب أن يطبّق تطبيق Android، وبالترتيب:

1. **قراءة الإصدار النشط**: `POST /api/template-center` مع
   `action: "read-active"` و`appVersion/appBuild`، واحترام `minAppVersion/Build`.
2. **ربط الجهاز**: `POST /api/entitlements/activate` لحجز
   `users/{uid}.entitlementInstallationId` (شرط قبول ACK).
3. **تطبيق الحمولة محليًا** في Drift دون تعطيل المعالجة المحلية، والاحتفاظ بآخر
   نسخة سليمة عند فشل التحميل.
4. **إرسال ACK**: `action: "ack"` بالحقول الدقيقة في
   `contracts/schemas/template-center-ack-request.schema.json`، ثم لا يدّعي
   التطبيق النجاح قبل استجابة الخادم.
5. **استهلاك `users/{uid}.account_features`** (المفاتيح الأربعة) بدل
   `feature_entitlements` القديمة.
6. **مفتاح المحفظة**: لا يبدأ أي ترحيل قبل قرار المالك (بند 1 في 4.4).
7. **عدم كتابة مبيعات مكتملة مباشرة** بعد اعتماد الاستقبال الخادمي (بند 7).

---

## 7) معيار إغلاق لوحة الإدارة (Checklist)

- [x] الكود: جميع الشاشات والمسارات الخادمية موجودة ومختبرة.
- [x] الاختبارات: 327/327 + 20/20 للدوال ناجحة.
- [x] البناء: `npm run build` ناجح.
- [x] القواعد الثابتة: `npm run lint` ناجح.
- [ ] قواعد Firestore منشورة ومختبرة على Emulator/الإنتاج.
- [ ] الفهارس منشورة و`Enabled`.
- [ ] Vercel منشور والـrewrites تعيد `401` لا `404`.
- [ ] `updatedAtMs` dry-run ثم apply بموافقة المالك.
- [ ] Full sync بعد الترحيل + قبول حي على بيانات إنتاج.
- [ ] قرارات المالك التسعة أعلاه محسومة أو مؤجلة رسميًا.
- [ ] مراجعة بشرية نهائية للعقد والأمن.

عند اكتمال البنود أعلاه، تصبح لوحة الإدارة **مغلقة** وينتقل العمل إلى Android
وفق القسم 6.

---

## 8) أوامر التحقق المستخدمة

```bash
cd /workspace
npm test                 # 327/327
npm run lint             # ناجح
npm run build            # ناجح
cd functions && npm test # 20/20
npx --yes eslint@10 --no-config-lookup -c scripts/eslint-no-undef.config.mjs src/
npx --yes eslint@10 --no-config-lookup -c <node-config> server api
```

**غير قابل للتحقق هنا:** نشر Rules/Indexes/Vercel/Functions، بيانات الإنتاج،
Firebase Usage، سجل CI على GitHub، وسلوك جهاز Android فعلي.
