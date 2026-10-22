# الخطة التنفيذية: تقليل قراءات Firestore وتسريع لوحة كروتك برو

**المشروع:** مجلد `لوحه` (لوحة إدارة كروتك برو، React + Vite + Firebase)
**الفرع المرجعي:** `feature/krotak-admin-control-center` (آخر commit معروف في الوثائق: `61472fc`)
**الهدف باختصار:** كل البيانات تُخزَّن محلياً في IndexedDB، ولا تُقرأ من Firebase إلا التغييرات الجديدة، والتنقل بين الصفحات يكون فورياً بدون تحميل.

---

## 0. ملاحظة صدق قبل البدء

- لم أعدّل أي ملف في المشروع. كل ما فعلته: فحص الكود، وقراءة الوثائق، وتحليل النسخة الاحتياطية (عدد الوثائق فقط، بدون نسخ بياناتها)، وفحص الصياغة (`node --check`) لملفات الخادم والبيانات، وتشغيل اختبار `adminDataCache.test.js` (18/18 ناجح).
- لم أستطع تشغيل `npm install` ولا `npm run build` لأن الشبكة معطلة في بيئتي ولا توجد `node_modules`.
- الأرقام في القسم 2 **تقديرات مبنية على قراءة الكود** وعدد الوثائق في النسخة الاحتياطية، وليست قياساً من Firebase. المرحلة 0 في الخطة تقيس الأرقام الحقيقية.
- لا يوجد مجلد `.git` داخل الملف المرفوع، لذلك لا أستطيع عرض فرق التعديلات بدقة. الأمر المقترح في القسم 4.

---

## 1. الخلاصة بلغة بسيطة

المشكلة ليست في حجم البيانات الآن (النسخة الاحتياطية فيها 5 مستخدمين و251 عملية بيع فقط)، المشكلة في **طريقة القراءة**:

1. **كل شاشة تسحب كل البيانات من السيرفر** (كل المستخدمين، كل الشبكات، كل المبيعات) بأمر `getDocs`، وهذا يُحسب قراءة لكل وثيقة في كل مرة.
2. **توجد مستمعات حيّة (`onSnapshot`) على كل المبيعات** تعمل من الصفحة الرئيسية، وتتكرر فتحها في كل صفحة تقريباً.
3. **زر التحديث وسحب الشاشة وعودة الإنترنت كلها تفرض قراءة كاملة** (`force: true`).
4. **الكاش الحالي ليس قاعدة بيانات**: هو `localStorage` بحد 5 ميغابايت، يحفظ كل شيء كنص JSON كبير، ويفشل بصمت عند كبر البيانات.
5. **كل تعديل يمسح الكاش** فتصبح الزيارة التالية قراءة كاملة من جديد.
6. **الشاشة تنتظر اكتمال كل المستمعات قبل أن تظهر** (`DashboardPage.jsx:123`)، ولذلك تشعر بالبطء حتى مع وجود بيانات محلية.

**الحل:** قاعدة محلية (IndexedDB عبر مكتبة Dexie) + مزامنة تزايدية تسأل سؤالاً واحداً: "ما الذي تغيّر منذ آخر مزامنة؟" + إزالة كل المستمعات على المجموعات الكاملة + شاشات تقرأ من القاعدة المحلية فقط.

**النتيجة المتوقعة:**
- فتح اللوحة بدون تغييرات جديدة: حوالي 6 قراءات بدلاً من مئات.
- التنقل بين الصفحات: صفر قراءات، وظهور فوري.
- زر التحديث: قراءة التغييرات فقط.
- الجهاز الجديد: قراءة كاملة **مرة واحدة** فقط.

---

## 2. التشخيص بالأدلة (مرتب حسب الأثر)

الأرقام تشير إلى ملفات المشروع داخل المجلد `لوحه`.

| # | المشكلة | الموقع | الأثر |
|---|---|---|---|
| 1 | مستمع حي على **كل المبيعات لكل الشبكات** يُشغَّل من `Layout` وبالتالي في كل الصفحات | `src/components/Layout.jsx:119` ← `src/lib/adminData.js:661` (الدالة `subscribeNetworkSalesRealtime`) و`startSalesSubscription` في `:733` | أكبر مستهلك. كل عملية بيع في كل الشبكات تُحسب قراءة، والتحميل الأولي يقرأ كل المبيعات |
| 2 | نفس الدالة تُستدعى من 4 صفحات أيضاً، فتفتح كل صفحة اشتراكاتها الخاصة | `DashboardPage.jsx:145`، `SalesPage.jsx:129`، `UsersPage.jsx:169`، `UserProfilePage.jsx:118` | تكرار الاشتراكات وتكرار البيانات المقروءة وبطء كل صفحة |
| 3 | مستمع حي على **كامل مجموعة `users`** في 3 أماكن | `Layout.jsx:69`، `UsersPage.jsx:215`، و`adminData.js:796` داخل الدالة نفسها | ثلاث نسخ من الاشتراك على نفس المجموعة |
| 4 | قراءة كاملة للمبيعات لكل الشبكات للتقارير | `fetchNetworkSales` في `adminData.js:641` وطلبها من `SalesPage.jsx:104` | كل تحديث أو سحب للشاشة يقرأ كل المبيعات من جديد |
| 5 | قراءات لكل مستخدم بشكل منفصل (fan-out): وثيقة المستخدم + وثيقة الشبكة + الملخص + الإعدادات | `fetchNetworkMeta` في `adminData.js:220`، و`fetchAggregate` في `:517`، و`enrichUserForBilling` في `:561`، و`fetchUsersWithBilling` في `:576`، و`fetchDashboardStats` في `:618` | عدد القراءات يتضاعف مع عدد المستخدمين عند كل تحميل |
| 6 | إذا كان ملخص المستخدم (`admin_aggregates`) مفقوداً، تُقرأ **كل** المبيعات المكتملة لذلك المستخدم | `fetchAggregateFromFirestore` في `adminData.js:465` | قراءة ثقيلة وغير متوقعة |
| 7 | إجبار التحديث (`force`) في كل مكان تقريباً | سحب الشاشة `Layout.jsx:389`، عودة الإنترنت `Layout.jsx:168`، `useAppRefresh` في 7 صفحات، وتسجيل مستخدم جديد يعيد تحميل كل شيء `UsersPage.jsx:225` | كل إجراء صغير يتحول إلى قراءة كاملة. اتصال الجوال المتقطع يضاعف القراءات |
| 8 | كل تعديل يمسح الكاش عبر `invalidateAdminUserData` | `adminData.js:28` | التعديل الواحد يعيد قراءة كل شيء في الزيارة التالية |
| 9 | الكاش المحلي هو `localStorage` يُكتب كاملاً كنص JSON، بحد حوالي 5 ميغابايت، والفشل صامت | `src/lib/adminDataCache.js` (دالة `writeLocal` في `:85`) | مع نمو المبيعات يتوقف الكاش عن العمل بصمت، ويصبح كل فتح قراءة كاملة، والكتابة المتكررة تسبب تجمّد الواجهة |
| 10 | الشاشة لا تظهر البيانات حتى تكتمل مستمعات **كل** الشبكات | `DashboardPage.jsx:123` (شرط `salesRealtimeReady`) | سبب مباشر لبطء ظهور الشاشة |
| 11 | `Suspense` يغطي كل المسارات، فأي صفحة لم تُحمَّل بعد تخفي الهيكل كله (الشريط الجانبي والسفلي) وتعرض سبينر | `App.jsx:34` | إحساس "الشاشة تتحمل" عند كل صفحة جديدة |
| 12 | حذف الحساب وتعديله يتمان من المتصفح بعدة `deleteDoc` و`updateDoc`، بينما يوجد حذف خادمي جاهز في `api/networks.js` (action: `delete`) | `src/lib/adminApi.js:199` و`:238` إلى `:300` | حذف غير ذري، وقراءات إضافية، وتكرار للمنطق |
| 13 | الخادم يعدّل المبيعات الموجودة عند التسوية (`settlement_status`، `paidMinor`، `settledAt`) **دون علامة تغيير** | `server/_lib/networkLedger.js:89` | أي مزامنة تعتمد على تاريخ الإنشاء ستفوّت التسويات |
| 14 | الحذف الفعلي (hard delete) لا يُرى من المزامنة التزايدية | `api/networks.js` (`deleteSubcollection`، `purgeDocAndAllSubcollections`) و`adminApi.js` | المحذوف يبقى في القاعدة المحلية للأبد ما لم تُضف شواهد حذف (tombstones) |
| 15 | قواعد Firestore لا تسمح بقراءة `collectionGroup('sales')` أو `collectionGroup('payments')` | `firestore.rules` (المطابقة الموجودة `networks/{networkId}/sales/{saleId}` في `:216` فقط) | المزامنة الموحدة لكل المبيعات ستُرفض دون إضافة قاعدة |
| 16 | `Layout` و`Suspense` وهيكل المسارات غير موحدين (كل مسار يلف نفسه بـ`Layout`) | `App.jsx:51`، `:61`، `:71` | يمنع مشاركة الهيكل وانتقال سلس، ويعقّد إعادة الهيكلة |
| 17 | نسخ احتياطية لـ Firestore كاملة داخل المستودع، فيها بيانات مدراء ومستخدمين شخصية | `backups/default_database-backup.json` و`backups/named_database-backup.json` | خطر خصوصية وتسريب بيانات، والمستودع يتشارك مع الوكيل |
| 18 | الوثائق تقول إن `adminDataCache.test.js` يفشل بـ`Maximum call stack size exceeded`، لكنه ينجح عندي (18/18 على Node 22) | `docs/REVIEW_AND_CHANGELOG_AR.md` | يجب التأكد من CI، والأفضل حذف هذا الاختبار بعد إزالة الكاش القديم |

**الأولويات:** البنود 1 إلى 9 هي سبب نفاد الحصة. البنود 10 و11 هي سبب بطء الانتقال. البنود 13 إلى 16 شروط أساسية قبل بناء الحل (بدونها تفشل المزامنة أو تفوّت البيانات).

### 2.1 تقدير القراءات الحالية والمستقبلية

رمزان:
- **S** = عدد عمليات البيع الكلي.
- **N** = عدد المستخدمين/الشبكات.

تقدير تقريبي لعدد القراءات:

| الإجراء | الوضع الحالي (تقدير) | بعد الخطة (تقدير) |
|---|---|---|
| فتح اللوحة بعد فترة بدون تغييرات | حوالي `S + 3N` قراءة أو أكثر (مستمعات + fan-out) | حوالي 6 قراءات (استعلامات فحص) |
| التنقل بين الصفحات | قراءات جديدة لكل صفحة تفتح مستمعاتها | صفر |
| سحب الشاشة / زر التحديث | `S + 3N` كاملة | 6 فحوصات + التغييرات فقط |
| تسجيل مستخدم جديد | إعادة تحميل كاملة تقريباً | تغييره فقط |
| جهاز جديد أول مرة | نفس الأرقام كل مرة | `S + N` مرة واحدة، ثم كما أعلاه |

مع النمو: إذا وصل S إلى 10,000 عملية، فكل تحديث كامل يساوي حوالي 10,000 قراءة. الخطة الحالية تجعل هذا الرقم يساوي تقريباً عدد العمليات الجديدة فقط.

> الحصة المجانية (Spark) لـ Firestore معلنة بحدود يومية، والتحقق من الرقم الحالي في صفحة الخطة داخل Firebase Console. إذا وصلت إلى الحد، تتوقف الشاشة عن القراءة حتى منتصف الليل بتوقيت المحيط الهادئ.

---

## 3. الهدف المعماري (الحالة المستهدفة)

```
┌──────────────────────┐   فحص: "ما الذي تغيّر بعد المؤشر؟"   ┌────────────────────────────┐
│ Firestore (السيرفر)  │ ─────────────────────────────────────▶│ IndexedDB محلية (Dexie)    │
│ users / networks /   │   تنزيل التغييرات فقط (صفحات 300)    │ لكل مدير (قاعدة منفصلة)    │
│ sales / payments /   │ ◀────────────────────────────────────│ users, networks, sales,    │
│ admin_aggregates     │                                      │ payments, aggregates,      │
└──────────────────────┘                                      │ sync_state, meta           │
        ▲                                                     └─────────────┬──────────────┘
        │ الكتابة تمر عبر API الخادم فقط                                     │ useLiveQuery
        │ (تعديل، دفعة، حذف، إرسال)                                         ▼
┌───────┴──────────────┐                                      ┌────────────────────────────┐
│ واجهة الإدارة        │ ◀────── تقرأ من IndexedDB فقط ───────│ الصفحات والجداول والملخصات │
└──────────────────────┘                                      └────────────────────────────┘
```

**المبادئ الستة:**
1. **القراءة من المحلي دائماً.** الشاشة لا تنتظر الشبكة أبداً إذا كانت البيانات موجودة محلياً.
2. **المزامنة = سؤال واحد لكل مجموعة:** "هل يوجد شيء أحدث من المؤشر؟" إذا لا، لا تُقرأ وثائق.
3. **لا مستمعات (`onSnapshot`) على مجموعة كاملة** ولا على كل المبيعات.
4. **الإجبار (`force`) ممنوع إلا لزر "مزامنة كاملة" يدوي في الإعدادات**، وحتى هو يعمل كمزامنة تزايدية.
5. **كل كتابة على الخادم تضع علامة `updatedAtMs`**، وكل حذف يترك شاهد حذف (tombstone).
6. **مصدر واحد للإجماليات**: ملخصات `admin_aggregates` التي تحدّثها Cloud Functions (بعد موافقة المالك، انظر القسم 9).

---

## 4. ما تم تعديله سابقاً وما المتبقي

### 4.1 التعديلات الموجودة في الملف (آخر دفعة تعديل: 2026-10-22 الساعة 04:09)

الملفات التالية تغيّرت في الدفعة الأخيرة (حسب تواريخ الملفات داخل الأرشيف)، وتشمل ميزات جديدة وإصلاحات. تركيزي هنا على ما يؤثر في الأداء:

| الجزء | الملفات | ما فعلته الدفعة | ملاحظة على الأداء |
|---|---|---|---|
| مركز القوالب والمحافظ | `src/pages/template-center/*`، `src/pages/TemplateCenterPage.jsx`، `server/_lib/templateCenter*.js`، `src/lib/androidSeedCatalog.js`، `api/settings.js` | صفحات RTL كاملة للمحافظ والقوالب، مع مسودات وإصدارات ومحاكاة | وزن كبير في الحزمة (`templateCenterApi.js` حوالي 21 كيلوبايت، وكتالوج الزرع حوالي 18 كيلوبايت)، لكنها محمّلة كسولاً |
| الاستحقاق والتفعيل | `server/_lib/entitlement*.js`، `server/_lib/accessStatus.js`، `api/settings.js` | تفعيل وربط أجهزة وعقود استحقاق | لا تأثير مباشر على قراءات اللوحة |
| استقبال المبيعات من الأجهزة | `api/sales/ingest.js` | سياسة مال نسخة 2، وسجل تعارضات، و`verifiedAt` و`ingestedAtMs` | **يجب إضافة `updatedAtMs` هنا** (البند 13 في القسم 2) |
| التدقيق والإشعارات | `src/pages/AuditPage.jsx`، `src/lib/auditLog.js`، `api/dispatch-notifications.js`، `api/send-fcm.js`، `api/manage-user-auth.js` | سجل تدقيق بتعارضات المبيعات، وإشعارات محفوظة | `AuditPage` يقرأ مباشرة بالصفحات |
| **واجهة الإدارة (الأهم للأداء)** | `src/components/Layout.jsx`، `src/lib/adminData.js`، `src/lib/adminApi.js`، `src/pages/SalesPage.jsx`، `src/pages/UsersPage.jsx`، `src/pages/UserProfilePage.jsx`، `src/components/UserBillingModal.jsx`، `src/components/Sidebar.jsx` | تنبيهات حية، سحب للتحديث، تجميع الشبكات، مستمعات المبيعات الحية، كاش localStorage | **هنا معظم مشكلة الأداء** (البنود 1 إلى 12 في القسم 2) |
| قواعد Firestore والفهارس | `firestore.rules`، `firestore.indexes.json` | قواعد مركز القوالب، وقواعد منع كتابة العميل | يجب إضافة قواعد `collectionGroup` (البند 15) |

**لمعرفة الفرق الدقيق لكل سطر:** نفّذ هذا الأمر في نسخة المستودع الأصلية (التي تحتوي `.git`):

```bash
git diff 61472fc -- src/components/Layout.jsx src/lib/adminData.js src/lib/adminApi.js src/pages/ api/sales/ingest.js firestore.rules
```

### 4.2 المتبقي (من الوثائق نفسها)

| البند | الحالة | المسؤول |
|---|---|---|
| CI على GitHub يفشل بصفر خطوات منذ التشغيل #268 | مفتوح، والسبب في إعدادات Actions أو الفوترة وليس الكود | المالك |
| قرارات المالك المعلقة: أ1، ب1، ب2، ج1، ج2، د1، هـ1، و1، ط1 | مفتوحة | المالك |
| توحيد مصدر الإجماليات (قرار 9 في `DECISIONS_REQUIRED_AR.md`) | مفتوح، وهو مطلوب لتصميم اللوحة المحلية (انظر القسم 9) | المالك |
| تطبيق Android: لا يرسل ACK، ولا يبلغ عن طراز الجهاز وإصدار Android، ولا توجد شاشة للمزايا المدفوعة | مفتوح، ولا يؤثر على هذه الخطة | وكيل Android |
| المحافظ والقوالب: لا استيراد آلي للتعريفات القديمة، ولا تكامل مع Drift، ولا اختبار نشر وتراجع على بيئة تجريبية | مفتوح | الفريق |
| نشر Vercel: واجهة `deployments` أعادت 403، والحالة غير معروفة | مفتوح | المالك |
| اختبارات قواعد Firestore على المحاكي (`npm run test:rules`) لم تُشغَّل في آخر مرحلة | مفتوح | الوكيل |
| بيانات شخصية في `backups/*.json` داخل المستودع | مفتوح، خطر أمني | المالك والوكيل |

---

## 5. الخطة التنفيذية بالمراحل

كل مرحلة لها: الهدف، ما الذي يُكتب، وما الذي يُحذف، ومعيار القبول. **لا تنتقل إلى المرحلة التالية قبل تحقيق معيار القبول وتقديم تقرير.**

### المرحلة 0: القياس قبل التغيير (نصف يوم)

**الهدف:** معرفة الأرقام الحقيقية قبل أي تعديل، لنقيس التحسن لاحقاً.

**ماذا يُكتب:**
- ملف `src/lib/localDb/readMeter.js` (عداد قراءات، مرفق في القسم 7.8).
- تغليف كل استدعاء `getDocs` و`getDoc` و`onSnapshot` الحالي بعدّاد اسمه (مثل `"dashboard:fetchAllUsers"`).
- لوحة تشخيص مخفية تظهر فقط إذا فُتح الرابط بـ `?debug=reads`.

**ماذا يُعمل خارج الكود:**
- من Firebase Console → Firestore → Usage، سجّل عدد القراءات لمدة 3 أيام، وقسّمها على أوقات استخدام اللوحة.
- افتح اللوحة، وانتقل بين 5 صفحات، واحسب القراءات من العداد.

**إنشاء نقطة استعادة:**
```bash
git checkout feature/krotak-admin-control-center
git tag pre-perf-2026-10-22
git checkout -b perf/local-first-admin
```

**معيار القبول:** جدول فيه: الصفحة، عدد القراءات عند الفتح الأول، وعند التنقل، وعند التحديث. يُحفظ في `docs/PERF_BASELINE_AR.md`.

---

### المرحلة 1: علامات التغيير على الخادم والقواعد (يوم)

**الهدف:** كل وثيقة مهمة تحمل `updatedAtMs`، وكل حذف يترك شاهداً، وقواعد تسمح بقراءة المجموعات الفرعية للمدير.

**ماذا يُكتب / يُعدّل:**

| الملف | السطر التقريبي | التعديل |
|---|---|---|
| `firestore.rules` | قبل `match /networks/{networkId}` (حوالي `:207`) | إضافة قواعد `collectionGroup` و`sync_tombstones` (انظر القسم 7.1) |
| `api/sales/ingest.js` | `:199` و`:217` | إضافة `updatedAtMs: now` و`createdAtMs: payload.createdMs` (القسم 7.6) |
| `server/_lib/networkLedger.js` | `:89` (تحديث المبيعات) و`:102` (تحديث الشبكة) | إضافة `updatedAtMs: Date.now()` لكل كتابة |
| `api/settlement.js` | `:92` (إنشاء الدفعة) | إضافة `updatedAtMs: Date.now()` |
| `functions/index.js` | `:427` (تحديث `admin_aggregates`) | إضافة `updatedAtMs: Date.now()` |
| `api/migrate.js` | `:166` و`:167` | إضافة `updatedAtMs: Date.now()` |
| `api/register-network.js` | `:117` و`:182` و`:189` و`:196` | إضافة `updatedAtMs: Date.now()` لكل كتابة على `users` و`networks` |
| `api/networks.js` | دوال الحذف (`deleteSubcollection` و`purgeDocAndAllSubcollections` حول `:455` إلى `:510`) | قبل كل `batch.delete` أضف شاهد حذف (القسم 7.6) |
| `src/lib/adminApi.js` | `:199` (`updateDoc(userRef, patch)`) | إضافة `updatedAtMs: Date.now()` إلى `patch` (مؤقتاً، ثم تنتقل الكتابة للخادم في المرحلة 5) |
| `src/pages/SettingsPage.jsx` | عمليات `setDoc` الخاصة بـ`app_settings` | إضافة `updatedAtMs` |
| `scripts/backfill-updated-at.mjs` | جديد | سكربت لملء `updatedAtMs` للوثائق القديمة (القسم 7.7) |

**تشغيل السكربت:**
1. أولاً: `node scripts/backfill-updated-at.mjs` بدون معاملات، وهذا وضع **تجريبي** يعدّ الوثائق المفقودة فقط.
2. ثانياً: بعد موافقة المالك على التقرير، `node scripts/backfill-updated-at.mjs --apply`.
3. يُشغَّل مرة واحدة فقط، وهو آمن للتكرار لأنه يتخطى الوثائق التي لديها الحقل.

**معيار القبول:**
- تقرير السكربت يُظهر `missing = 0` لكل مجموعة بعد التشغيل.
- اختبار جديد يثبت أن `api/sales/ingest.js` و`networkLedger.js` يكتبان `updatedAtMs`.
- اختبار قواعد Firestore على المحاكي: المدير يقرأ `collectionGroup('sales')`، والعميل العادي يُرفض.

---

### المرحلة 2: القاعدة المحلية ومحرك المزامنة (2 إلى 3 أيام)

**الهدف:** بناء القلب: قاعدة IndexedDB لكل مدير، ومحرك مزامنة تزايدي.

**ماذا يُثبَّت:** `npm install dexie@^4 dexie-react-hooks@^1`

**ماذا يُكتب (ملفات جديدة):**

| الملف | المحتوى |
|---|---|
| `src/lib/localDb/db.js` | تعريف الجداول والفهارس (القسم 7.2) |
| `src/lib/localDb/plain.js` | تحويل `Timestamp` إلى أرقام ملّي ثانية (القسم 7.3) |
| `src/lib/localDb/syncEngine.js` | الفحص والتنزيل التزايدي وشواهد الحذف (القسم 7.3) |
| `src/lib/localDb/useAutoSync.js` | تشغيل المزامنة عند الدخول وعند عودة التبويب والإنترنت (القسم 7.4) |
| `src/lib/localDb/LocalDbContext.jsx` | مزوّد يُنشئ القاعدة لكل `uid` ويحذفها عند الخروج |
| `src/lib/localDb/readMeter.js` | العدّاد من المرحلة 0 |

**قواعد صارمة في هذه المرحلة:**
- اسم قاعدة IndexedDB يحتوي `uid` ورقم الإصدار: `krotak-admin-v1-<uid>`.
- عند تسجيل الخروج: `db.close()` ثم `Dexie.delete(name)`. بيانات الإدارة لا تبقى على الجهاز بعد الخروج.
- محرك المزامنة يحفظ المؤشر (`cursorMs`) **بعد** نجاح كتابة الصفحة في القاعدة، فإذا انقطع الاتصال تُعاد القراءة دون فقدان ولا تكرار غير ضروري.

**معيار القبول (اختبارات وحدة باستخدام `test/helpers/fakeFirestore.js` الموجود):**
1. المزامنة الأولى تنزّل كل الوثائق وتضع المؤشرات.
2. المزامنة الثانية بدون تغييرات تقرأ الفحوصات فقط (عدد القراءات = عدد المجموعات).
3. مبيعة تغيّرت حالتها (تسوية) تُحدَّث محلياً.
4. مبيعة حُذفت (شاهد حذف) تُزال محلياً.
5. انقطاع في منتصف الصفحات يعيد القراءة من المؤشر دون فقدان.
6. بدون إنترنت تعرض القاعدة المحلية البيانات كما هي.

---

### المرحلة 3: ترحيل الشاشات إلى القاعدة المحلية (2 إلى 3 أيام)

**الهدف:** كل شاشة تقرأ من IndexedDB فقط، وتُزال كل المستمعات والقراءات المباشرة.

**ما يُحذف في كل صفحة:**

| الملف | ما يُحذف | ما يُكتب بدلاً منه |
|---|---|---|
| `src/components/Layout.jsx` | `onSnapshot` على `users` (`:66` إلى `:115`) و`subscribeNetworkSalesRealtime` (`:119` إلى `:162`) | تنبيهات مبيعات جديدة ومستخدمين جدد تُشتق من نتائج المزامنة (حدث `newRows` يطلقه محرك المزامنة)، و`PullToRefresh` يستدعي `syncAll({reason:'manual'})` بدلاً من `emitAppRefresh` |
| `src/components/Layout.jsx` | `handleOnline` (`:168`) | يستدعي `syncAll({reason:'online'})` |
| `src/pages/DashboardPage.jsx` | `subscribeNetworkSalesRealtime` (`:145`) والشرط `salesRealtimeReady` (`:123`) وكل `load()` المعتمد على `fetchDashboardStats` | `useLiveQuery` على `aggregates` و`users`، مع حساب الإجماليات والمخطط الشهري محلياً |
| `src/pages/SalesPage.jsx` | `subscribeNetworkSalesRealtime` (`:129`) و`fetchNetworkSales` (`:104`) | `useLiveQuery` على `sales` بفهرس `createdAtMs`، مع ترقيم بـ`offset/limit` للقوائم |
| `src/pages/UsersPage.jsx` | `onSnapshot` (`:215`) و`subscribeNetworkSalesRealtime` (`:169`) و`fetchData` بالإجبار (`:225`، `:234`، `:493`) | `useLiveQuery` تجمع `users` و`networks` و`aggregates` محلياً، و`PAGE_SIZE` يبقى 24 |
| `src/pages/UserProfilePage.jsx` | `subscribeNetworkSalesRealtime` (`:118`) و`fetchUsersWithBilling` (`:97`) | قراءة محلية بفهرس `networkId` |
| `src/components/UserBillingModal.jsx` | `fetchUserBillingHistory` (`:101` و`:339`) | قراءة محلية من `sales` و`payments` بفهرس `networkId`، بدون `force` |
| `src/pages/NotificationsPage.jsx` | `fetchUsersForSelect` (`:136`) | قراءة محلية من `users` |
| `src/pages/AuditPage.jsx` | القراءة المباشرة (`:194`) | تخزين آخر 200 سجل محلياً، والصفحات الأقدم تُحمَّل عند الطلب فقط |
| `src/pages/SettingsPage.jsx` | `fetchConfig({force:true})` (`:170`) | قراءة `app_settings` من القاعدة المحلية ومزامنتها عبر المحرك |
| `src/pages/AdminsPage.jsx` | `fetchAdmins({force:true})` (`:89`) | قراءة من القاعدة، أو مزامنة عند الطلب فقط |

**ملاحظة على الكود:** التحويل من `Timestamp` إلى أرقام ملّي ثانية يكسر الاستدعاءات `.toMillis?.()`. ابحث عنها بالأمر `grep -rn "toMillis" src/` (توجد في 4 ملفات، وعددها 8 تقريباً، منها `Layout.jsx`، و`adminData.js`، و`NotificationsPage.jsx`، و`accessStatus.js`) واستبدلها بالحقل الرقمي المقابل (`createdAtMs`).

**تجميع الإجماليات (مصدر واحد):** الإجماليات تُحسب من جدول `aggregates` المحلي (المحدَّث بواسطة Cloud Function). يجب أن يوافق المالك على هذا (القسم 9، القرار 1). الدالة المطلوبة هي `summarizeAggregates(rows)` التي تجمع `totalFaceValue` و`totalTransactions` و`totalCommissionDue` و`totalPaid` وتدمج `monthly` للأشهر الستة الأخيرة.

**معيار القبول لكل صفحة:**
- لا يوجد `onSnapshot` و`getDocs` خارج `syncEngine.js`، بالبحث `grep -rn "onSnapshot\|getDocs\|getDoc(" src/ | grep -v localDb`، والنتيجة يجب أن تكون صفراً أو مبررة مكتوبة في التقرير.
- الصفحة تُظهر البيانات من القاعدة في أقل من 300 مللي ثانية عند التكرار، وبدون سبينر إذا كانت القاعدة مملوءة.
- عدد القراءات عند فتح الصفحة (من العداد): حوالي 6 بعد الاكتمال الأول.

---

### المرحلة 4: الانتقالات كأنك داخل تطبيق Android (يوم)

**الهدف:** الشريط الجانبي والسفلي يبقيان ثابتين، ومحتوى الصفحة فقط يتبدل، والصفحات المحمّلة لا تُعاد تحميلها.

**ماذا يُعدَّل:**

| الملف | التعديل |
|---|---|
| `src/App.jsx` | تحويل المسارات إلى مسار تخطيط واحد بـ`<Outlet/>` (القسم 7.5)، ونقل `Suspense` داخل `Layout` حول المحتوى فقط، وإضافة `future={{ v7_startTransition: true }}` إلى `Router` |
| `src/components/Layout.jsx` | يعرض `children` داخل `<Suspense fallback={<RouteSkeleton/>}>`، ويحافظ على الشريط الجانبي والسفلي |
| `src/lib/routeLoaders.js` | بعد تسجيل الدخول: تحميل كل الصفحات في وقت الخمول (`requestIdleCallback`)، ولا يُعرض سبينر كامل الشاشة أبداً بعد أول مرة |
| `src/components/BottomNav.jsx` و`Sidebar.jsx` | تحميل الصفحة عند `pointerdown` و`focus` (موجود جزئياً، يُوسَّع لكل الروابط) |
| `src/index.css` | ظهور المحتوى بتلاشٍ خفيف 150 مللي ثانية، بدون تحريك الهيكل (`layout shift`) |
| القوائم الطويلة (اختياري) | تقسيم القوائم إلى صفحات أو `virtualization` عند تجاوز 200 صف |

**معيار القبول:**
- التنقل بين الصفحات الأربع الرئيسية (الرئيسية، الحسابات، التقارير، الإشعارات): المحتوى يظهر في أقل من 100 مللي ثانية، بدون سبينر بعد أول زيارة، وبدون أي قراءة جديدة.
- الشريط الجانبي والسفلي لا يختفيان أبداً أثناء التنقل.

---

### المرحلة 5: التنظيف والإزالة النهائية (يوم)

**ماذا يُحذف:**
- `src/lib/adminDataCache.js` بالكامل، و`test/adminDataCache.test.js`.
- كل دوال `subscribe*` و`fetch*` القديمة في `src/lib/adminData.js` (تُستبدل بـ`syncEngine` والاستعلامات المحلية).
- كل مسارات `force` و`getDocsFromServer` و`getDocFromServer` خارج `syncEngine.js`، باستثناء زر "مزامنة كاملة" في الإعدادات.
- `emitAppRefresh` و`useAppRefresh` (تُستبدل بالمزامنة).
- الاستدعاء التلقائي لـ`sync-auth-users` داخل `fetchAllUsers` (`adminData.js:417`). يصبح زراً يدوياً في صفحة المستخدمين.

**الحذف من المتصفح إلى الخادم:**
- في `src/lib/adminApi.js` استبدل الدوال من `:238` إلى `:300` بطلب إلى `/api/networks` بـ`action: 'delete'` (موجود بالفعل في `api/networks.js:61`). بعدها تُحذف كل سلسلة `deleteDoc` من المتصفح.

**الأمن والخصوصية:**
- انقل `backups/*.json` خارج المستودع، وأضفه إلى `.gitignore`. إذا أراد المالك حذفها من التاريخ، يُستخدم `git filter-repo` بعد موافقته.
- أضف سياسة حماية: بعد 15 دقيقة من عدم النشاط، تُقفل الواجهة وتُمسح من الذاكرة (اختياري، بموافقة المالك).

**توثيق:** إنشاء `docs/ADMIN_LOCAL_FIRST_ARCHITECTURE_AR.md` يصف الهيكل الجديد: القاعدة المحلية، المؤشرات، شواهد الحذف، والقواعد الستة.

**معيار القبول:**
- `npm run lint` ناجح.
- `grep -rn "adminDataCache\|localStorage" src/` لا يعيد نتائج مرتبطة بالبيانات.

---

### المرحلة 6: التحقق والقبول (يوم)

**الأوامر:**
```bash
npm test
npm run lint
npm run build
npm run emulators   # في نافذة منفصلة
npm run test:rules  # على المحاكي
```

**بيانات الاختبار:** ولّد بيانات **اصطناعية** بالحجم المطلوب (مثلاً 10,000 عملية، و50 شبكة). **لا تستخدم النسخ الاحتياطية الحقيقية في الاختبارات.**

**قائمة القبول النهائية:**

| الاختبار | المعيار |
|---|---|
| فتح اللوحة بعد اكتمال المزامنة وبدون تغييرات | حوالي 6 قراءات |
| التنقل بين 8 صفحات | صفر قراءات |
| زر التحديث بعد إضافة 5 مبيعات | 6 فحوصات + 5 قراءات |
| تسجيل مستخدم جديد | قراءة المستخدم الجديد فقط |
| تسوية مبيعات من الخادم | تظهر في الشاشة عند المزامنة التالية |
| حذف شبكة | تختفي من القاعدة المحلية عند المزامنة |
| جهاز جديد | قراءة كاملة مرة واحدة، ثم تزايدية |
| خروج من الحساب | لا توجد بيانات في IndexedDB |
| بدون إنترنت | تعمل اللوحة بآخر بيانات محلية وتُظهر شريط "لا يوجد اتصال" |
| `npm test` و`lint` و`build` | ناجحة، أو كل استثناء مكتوب مع سببه |

**مراقبة ما بعد النشر:** راقب Usage في Firebase لمدة 3 أيام، وقارن بالمرحلة 0.

---

## 6. خريطة التعديلات: أين يُصحَّح وماذا يُكتب

| الملف | السطر التقريبي | نوع التعديل | المرحلة |
|---|---|---|---|
| `firestore.rules` | `:207` | إضافة قواعد `collectionGroup` و`sync_tombstones` | 1 |
| `firestore.indexes.json` | عام | لا تغيير متوقع (الفهارس المفردة تُنشأ تلقائياً). إذا طلبت Firebase فهرساً مركباً، أضفه هنا | 1 |
| `api/sales/ingest.js` | `:199`، `:217` | `updatedAtMs` و`createdAtMs` | 1 |
| `server/_lib/networkLedger.js` | `:89`، و`:102` | `updatedAtMs` عند تحديث المبيعات والشبكة | 1 |
| `api/settlement.js` | `:92` | `updatedAtMs` عند إنشاء الدفعة | 1 |
| `functions/index.js` | `:427` | `updatedAtMs` مع `admin_aggregates` | 1 |
| `api/migrate.js` | `:166`، `:167` | `updatedAtMs` | 1 |
| `api/register-network.js` | `:117`، `:182`، `:189`، `:196` | `updatedAtMs` على `users` و`networks` | 1 |
| `api/networks.js` | `:455` إلى `:545` | شواهد حذف قبل كل `batch.delete` | 1 |
| `scripts/backfill-updated-at.mjs` | جديد | سكربت ملء مرة واحدة | 1 |
| `package.json` | `dependencies` | إضافة `dexie` و`dexie-react-hooks` | 2 |
| `src/lib/localDb/*` | جديد | القاعدة والمزامنة والعدّاد والمزوّد | 2 |
| `src/lib/adminDataCache.js` | كامل | حذف | 5 |
| `src/lib/adminData.js` | كامل تقريباً | استبدال بالاستعلامات المحلية، ثم حذف القديم | 3 و5 |
| `src/lib/adminApi.js` | `:199`، `:238` إلى `:300` | `updatedAtMs` مؤقتاً، ثم حذف الحذف من المتصفح واستخدام الخادم | 1 و5 |
| `src/components/Layout.jsx` | `:66` إلى `:162`، `:168`، `:389` | إزالة المستمعات، والمزامنة بدلاً من الإجبار | 3 |
| `src/pages/DashboardPage.jsx` | `:106`، `:123`، `:145` | إزالة المستمعات، وقراءة محلية | 3 |
| `src/pages/SalesPage.jsx` | `:104`، `:129` | قراءة محلية مع ترقيم | 3 |
| `src/pages/UsersPage.jsx` | `:169`، `:215` إلى `:234`، `:493` | قراءة محلية، وإزالة الإجبار | 3 |
| `src/pages/UserProfilePage.jsx` | `:97`، `:100`، `:118` | قراءة محلية | 3 |
| `src/components/UserBillingModal.jsx` | `:101`، `:339` | قراءة محلية | 3 |
| `src/pages/NotificationsPage.jsx` | `:136` | قراءة محلية | 3 |
| `src/pages/AuditPage.jsx` | `:194` إلى `:226` | قراءة محلية لآخر 200 سجل | 3 |
| `src/pages/SettingsPage.jsx` | `:170` | قراءة محلية | 3 |
| `src/pages/AdminsPage.jsx` | `:89` | قراءة محلية | 3 |
| `src/App.jsx` | `:2`، `:34`، `:51`، `:61`، `:71`، ... | مسار تخطيط واحد، `Outlet`، `future`، ونقل `Suspense` | 4 |
| `src/lib/routeLoaders.js` | كامل | تحميل مسبق في وقت الخمول | 4 |
| `src/components/BottomNav.jsx`، `Sidebar.jsx` | روابط التنقل | تحميل عند `pointerdown` و`focus` | 4 |
| `src/index.css` | الانتقالات | تلاشٍ خفيف للمحتوى | 4 |
| `backups/*.json` | كامل | إخراج من المستودع | 5 |
| `.gitignore` | نهاية الملف | إضافة `backups/` | 5 |
| `test/adminDataCache.test.js` | كامل | حذف | 5 |
| `test/` | جديد | اختبارات المزامنة وقواعد المجموعات الفرعية | 2 و6 |

---

## 7. الكود المرجعي (نماذج جاهزة للوكيل)

> هذه نماذج واضحة وصحيحة للبنية. الوكيل يكيّفها مع أسماء الحقول الحالية ويتأكد منها بالاختبارات.

### 7.1 قواعد Firestore الإضافية

أضفها داخل `match /databases/{database}/documents { ... }`، قبل `match /networks/{networkId}`:

```
    // قراءة المجموعات الفرعية للمدير فقط: مطلوبة للمزامنة التزايدية الموحدة
    match /{path=**}/sales/{saleId} {
      allow read: if isAdmin();
    }
    match /{path=**}/payments/{paymentId} {
      allow read: if isAdmin();
    }

    // شواهد الحذف: يكتبها الخادم فقط (Admin SDK)، ويقرأها المدير
    match /sync_tombstones/{tombstoneId} {
      allow read: if isAdmin();
      allow write: if false;
    }
```

### 7.2 تعريف القاعدة المحلية `src/lib/localDb/db.js`

```js
import Dexie from 'dexie';

export const SCHEMA_VERSION = 1;

export function dbNameFor(uid) {
  return `krotak-admin-v${SCHEMA_VERSION}-${uid}`;
}

export function createAdminDb(uid) {
  const db = new Dexie(dbNameFor(uid));
  db.version(SCHEMA_VERSION).stores({
    users: 'uid, networkId, updatedAtMs',
    networks: 'networkId, updatedAtMs',
    // المفتاح المركب يمنع تداخل مبيعات شبكتين لهما نفس المعرّف
    sales: '[networkId+id], networkId, createdAtMs, updatedAtMs, status',
    payments: '[networkId+id], networkId, updatedAtMs',
    aggregates: 'uid, updatedAtMs',
    sync_state: 'key',   // مؤشر كل مجموعة: cursorMs
    meta: 'key',         // lastSyncAt وغيرها
  });
  return db;
}
```

### 7.3 تحويل البيانات ومحرك المزامنة

`src/lib/localDb/plain.js`:

```js
// يحوّل Timestamp إلى رقم ملّي ثانية، لأن IndexedDB لا تحفظ كائنات Firestore بشكلها الأصلي
export function plain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
}
```

`src/lib/localDb/syncEngine.js`:

```js
import {
  collection, collectionGroup, getDocs, limit, orderBy, query, startAfter, where,
} from 'firebase/firestore';
import { db as firestore } from '../../firebase';
import { plain } from './plain';

const PAGE_SIZE = 300;
const MIN_AUTO_INTERVAL_MS = 60_000;

// كل مصدر: مجموعة على السيرفر + جدول محلي + طريقة تحويل الوثيقة
const SOURCES = [
  {
    key: 'users', table: 'users',
    ref: () => collection(firestore, 'users'),
    map: (d) => ({ ...plain(d.data()), uid: d.id }),
  },
  {
    key: 'networks', table: 'networks',
    ref: () => collection(firestore, 'networks'),
    map: (d) => ({ ...plain(d.data()), networkId: d.id }),
  },
  {
    key: 'sales', table: 'sales',
    ref: () => collectionGroup(firestore, 'sales'),
    map: (d) => ({ ...plain(d.data()), networkId: d.ref.parent.parent.id, id: d.id }),
  },
  {
    key: 'payments', table: 'payments',
    ref: () => collectionGroup(firestore, 'payments'),
    map: (d) => ({ ...plain(d.data()), networkId: d.ref.parent.parent.id, id: d.id }),
  },
  {
    key: 'aggregates', table: 'aggregates',
    ref: () => collection(firestore, 'admin_aggregates'),
    map: (d) => ({ ...plain(d.data()), uid: d.id }),
  },
  {
    key: 'tombstones', table: null,  // خاص: يطبّق الحذف بدل الكتابة
    ref: () => collection(firestore, 'sync_tombstones'),
    map: (d) => ({ ...plain(d.data()), id: d.id }),
  },
];

// فحص واحد: أحدث تغيير في المجموعة (قراءة واحدة)
async function latestMs(src) {
  const snap = await getDocs(query(src.ref(), orderBy('updatedAtMs', 'desc'), limit(1)));
  return snap.empty ? 0 : Number(snap.docs[0].data().updatedAtMs) || 0;
}

// تنزيل كل ما تغيّر منذ المؤشر، على صفحات، مع تخطي ما سبق قراءته بـ startAfter
async function pullSince(src, cursorMs, onRows) {
  let last = null;
  let maxMs = cursorMs;
  for (;;) {
    const constraints = [where('updatedAtMs', '>=', cursorMs), orderBy('updatedAtMs', 'asc')];
    if (last) constraints.push(startAfter(last));
    constraints.push(limit(PAGE_SIZE));
    const snap = await getDocs(query(src.ref(), ...constraints));
    if (snap.empty) break;
    await onRows(snap.docs.map(src.map));
    last = snap.docs[snap.docs.length - 1];
    maxMs = Math.max(maxMs, Number(last.data().updatedAtMs) || 0);
    if (snap.size < PAGE_SIZE) break;
  }
  return maxMs;
}

async function applyRows(localDb, src, rows) {
  if (src.key === 'tombstones') {
    for (const t of rows) {
      if (t.collection === 'sales' && t.networkId && t.id) await localDb.sales.delete([t.networkId, t.id]);
      else if (t.collection === 'payments' && t.networkId && t.id) await localDb.payments.delete([t.networkId, t.id]);
      else if (t.collection === 'users' && t.id) await localDb.users.delete(t.id);
      else if (t.collection === 'networks' && t.id) await localDb.networks.delete(t.id);
    }
    return;
  }
  // bulkPut idempotent: إعادة كتابة نفس الوثيقة آمنة
  await localDb.table(src.table).bulkPut(rows);
}

async function syncSource(localDb, src) {
  const state = (await localDb.sync_state.get(src.key)) || { key: src.key, cursorMs: 0 };
  const latest = await latestMs(src);                    // قراءة واحدة
  if (state.cursorMs > 0 && latest <= state.cursorMs) {
    return { key: src.key, changed: 0 };                 // لا شيء جديد
  }
  let changed = 0;
  const nextCursor = await pullSince(src, state.cursorMs, async (rows) => {
    await applyRows(localDb, src, rows);
    changed += rows.length;
  });
  // المؤشر يتحرك بعد نجاح الكتابة فقط
  await localDb.sync_state.put({ key: src.key, cursorMs: nextCursor, syncedAt: Date.now() });
  return { key: src.key, changed };
}

let inFlight = null;
let lastFinishedAt = 0;

/** مزامنة واحدة في كل وقت. التلقائي محدود بفاصل دقيقة، واليدوي دائماً ينفذ. */
export function syncAll(localDb, { reason = 'auto' } = {}) {
  if (inFlight) return inFlight;
  if (reason !== 'manual' && Date.now() - lastFinishedAt < MIN_AUTO_INTERVAL_MS) {
    return Promise.resolve(null);
  }
  inFlight = (async () => {
    const results = [];
    for (const src of SOURCES) results.push(await syncSource(localDb, src));
    await localDb.meta.put({ key: 'lastSyncAt', value: Date.now(), reason });
    return results;
  })().finally(() => {
    lastFinishedAt = Date.now();
    inFlight = null;
  });
  return inFlight;
}
```

> ملاحظة: إذا تساوى `updatedAtMs` لعدة وثائق عبر حد الصفحة، يضمن `startAfter(last)` عدم تكرارها أو تخطيها. المؤشر يبدأ من `>=` فيعيد قراءة بعض الحدود، وهذا مقصود وآمن لأن الكتابة idempotent.

### 7.4 الخطاف (Hook) لتشغيل المزامنة

`src/lib/localDb/useAutoSync.js`:

```js
import { useEffect } from 'react';
import { syncAll } from './syncEngine';

export function useAutoSync(localDb) {
  useEffect(() => {
    if (!localDb) return undefined;
    const run = (reason) => syncAll(localDb, { reason })
      .catch((error) => console.warn('Local sync failed:', error));

    run('enter');
    const onVisible = () => { if (document.visibilityState === 'visible') run('visible'); };
    const onOnline = () => run('online');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [localDb]);
}
```

### 7.5 شكل المسارات بعد التوحيد (`src/App.jsx`)

```jsx
import { Outlet } from 'react-router-dom';

function AdminShell() {
  return (
    <ProtectedRoute>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  );
}

// داخل AppRoutes:
<Routes>
  <Route path="/login" element={currentUser ? <Navigate to="/" replace /> : <LoginPage />} />
  <Route element={<AdminShell />}>
    <Route path="/" element={<DashboardPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/users" element={<UsersPage />} />
    <Route path="/users/:uid" element={<UserProfilePage />} />
    <Route path="/sales" element={<SalesPage />} />
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route path="/admins" element={<AdminsPage />} />
    <Route path="/audit" element={<AuditPage />} />
    <Route path="/template-center/*" element={<TemplateCenterPage />} />
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>

// في App:
<Router future={{ v7_startTransition: true }}>
```

وداخل `Layout.jsx` تُلَفّ المنطقة الرئيسية بـ`Suspense` حتى يبقى الهيكل ظاهراً أثناء تحميل الصفحة:

```jsx
<main className="app-main" id="main-content" tabIndex={-1}>
  <Suspense fallback={<RouteSkeleton />}>
    {children}
  </Suspense>
</main>
```

### 7.6 التعديلات على الكتابة في الخادم

`api/sales/ingest.js` (داخل `transaction.set(saleRef, {...})` عند `:199`):

```js
updatedAtMs: now,              // جديد: علامة التغيير للمزامنة
createdAtMs: payload.createdMs, // جديد: للفرز المحلي بدون تحويل Timestamp
```

و`transaction.set(networkRef, {...})` عند `:217`:

```js
updatedAtMs: now,
```

`server/_lib/networkLedger.js` (داخل `transaction.update(sale.ref, {...})` عند `:89`):

```js
updatedAtMs: Date.now(),  // جديد: التسوية تغيّر المبيعة، فيجب أن تظهر في المزامنة
```

شاهد الحذف (يُضاف في `api/networks.js` قبل كل `batch.delete`):

```js
function addTombstone(db, batch, { collection, networkId = null, id }) {
  batch.set(db.collection('sync_tombstones').doc(), {
    collection,
    networkId,
    id,
    updatedAtMs: Date.now(),
  });
}
// مثال داخل الحلقة:
// addTombstone(db, batch, { collection: 'sales', networkId, id: d.id });
// batch.delete(d.ref);
```

### 7.7 سكربت الملء مرة واحدة `scripts/backfill-updated-at.mjs`

```js
// تشغيل: node scripts/backfill-updated-at.mjs           (تجريبي: يعدّ فقط)
//       node scripts/backfill-updated-at.mjs --apply    (يكتب بعد موافقة المالك)
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const PAGE = 400;

const targets = [
  { name: 'users', query: () => db.collection('users') },
  { name: 'networks', query: () => db.collection('networks') },
  { name: 'sales', query: () => db.collectionGroup('sales') },
  { name: 'payments', query: () => db.collectionGroup('payments') },
  { name: 'admin_aggregates', query: () => db.collection('admin_aggregates') },
];

// أفضل تاريخ متاح للوثيقة. إذا لم يوجد أي تاريخ نضع 1 لتُزامَن مرة واحدة ويُسجَّل العدد
function bestMs(data) {
  for (const value of [data.updatedAt, data.createdAt, data.verifiedAt, data.timestamp]) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
  }
  if (Number.isFinite(data.ingestedAtMs)) return data.ingestedAtMs;
  return 1;
}

for (const target of targets) {
  let last = null;
  let scanned = 0;
  let missing = 0;
  let noDate = 0;
  for (;;) {
    let q = target.query().orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      scanned += 1;
      if (doc.get('updatedAtMs') !== undefined) continue;
      missing += 1;
      const ms = bestMs(doc.data());
      if (ms === 1) noDate += 1;
      if (APPLY) batch.update(doc.ref, { updatedAtMs: ms });
    }
    if (APPLY && missing > 0) await batch.commit();
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  console.log(`${target.name}: scanned=${scanned} missing=${missing} noDate=${noDate} ${APPLY ? '(applied)' : '(dry-run)'}`);
}
```

**ملاحظة:** السكربت يستخدم `applicationDefault()`، أي بيانات الاعتماد من `GOOGLE_APPLICATION_CREDENTIALS`. لا تطبعها ولا تضعها في السجل، ولا تشغّل `--apply` على الإنتاج دون موافقة المالك.

### 7.8 عداد القراءات `src/lib/localDb/readMeter.js`

```js
const counters = { total: 0, byLabel: {} };

/** كل استعلام يحسب قراءة واحدة على الأقل، حتى لو لم ترجع وثائق */
export function countReads(label, docCount) {
  const count = Math.max(1, Number(docCount) || 0);
  counters.total += count;
  counters.byLabel[label] = (counters.byLabel[label] || 0) + count;
  if (import.meta.env.DEV) console.debug(`[reads] ${label} +${count} (total ${counters.total})`);
}

export function readCounters() {
  return counters;
}
```

---

## 8. قواعد صارمة للوكيل (ممنوعات)

1. **لا** `onSnapshot` على مجموعة كاملة أو `collectionGroup` كاملة، ولا في أي صفحة.
2. **لا** `getDocs` على مجموعة كاملة خارج `syncEngine.js`. أي قراءة جديدة تمر بالمؤشر.
3. **لا** `force` أو `getDocsFromServer` إلا في زر "مزامنة كاملة" اليدوي.
4. **لا** تغيير في منطق العمولة والمال والتسوية والحسابات. هذه قرارات المالك في `DECISIONS_REQUIRED_AR.md`. الخطة تضيف حقولاً فقط، ولا تغيّر حساباً.
5. **لا** حذف أي حقل قائم (القاعدة من `docs/KROTAK_ADMIN_ROADMAP_AR.md`، القسم 0).
6. **لا** تشغيل `backfill --apply` على الإنتاج دون موافقة مكتوبة من المالك.
7. **لا** `push` إلى `main`، ولا دمج، ولا نشر. العمل على الفرع `perf/local-first-admin` المنشأ من `feature/krotak-admin-control-center`.
8. **لا** بيانات حقيقية في الاختبارات أو الأمثلة. استخدم بيانات اصطناعية فقط.
9. **لا** تحذف `backups/` من التاريخ أو تنقلها دون موافقة المالك، لكن يجب إضافتها إلى `.gitignore` وإخراجها من الفهرس.
10. **لا** إسكات الأخطاء بـ`catch {}` فارغ. كل فشل يُسجَّل برسالة واضحة.
11. **تعارض مع README:** يقول README إن الوكيل لا يشغّل الاختبارات والبناء محلياً، ويعتمد على GitHub Actions. اطلب من المالك صراحة السماح بالتشغيل المحلي لهذه المهمة، أو اكتب في التقرير أن التحقق محلي لم يُجرَ.

---

## 9. القرارات التي تحتاجها منك (خمسة فقط)

| # | القرار | التوصية |
|---|---|---|
| 1 | مصدر إجماليات اللوحة: `admin_aggregates` (التي تحدّثها Cloud Functions) أم إعادة الحساب من السجلات؟ | `admin_aggregates`، لأنها تُحدَّث تلقائياً ومتوافقة مع فكرة المصدر الواحد. هذا يحسم البند 9 في `DECISIONS_REQUIRED_AR.md` |
| 2 | هل تقبل قراءة كاملة مرة واحدة عند أول فتح على كل جهاز جديد؟ | نعم، تكلفتها `S + N` مرة واحدة فقط لكل جهاز ومتصفح |
| 3 | بعد تسجيل الخروج: هل تُمسح بيانات IndexedDB تلقائياً؟ | نعم، ومن الأفضل إضافة قفل تلقائي بعد عدم النشاط |
| 4 | خطة Firebase: هل تبقى على Spark (المجانية) أم تنتقل إلى Blaze (الدفع حسب الاستخدام) مع تنبيه ميزانية؟ | Blaze مع تنبيه ميزانية شهري، لأن الخطة الجديدة تقلل الاستهلاك كثيراً لكن النمو يحتاج حصة مرنة |
| 5 | إخراج `backups/*.json` من المستودع: موافق؟ | نعم، وإذا أردت حذفها من التاريخ يُنفَّذ بعد موافقتك الصريحة |

---

## 10. كيف تتأكد بنفسك دون كود

1. **Firebase Console → Firestore → Usage:** سجّل عدد القراءات اليومي قبل التغيير، ثم بعد كل مرحلة. الهدف أن ينخفض بشكل واضح بعد المرحلة 3.
2. **افتح اللوحة، ثم DevTools → Network، وفلتر على `firestore.googleapis.com`.** بعد التعديل يجب أن ترى عند الفتح عدداً صغيراً من الطلبات (فحوصات)، ولا ترى طلبات `Listen` مستمرة لكل المبيعات.
3. **افصل الإنترنت وافتح اللوحة:** يجب أن تظهر البيانات من الجهاز مع شريط "لا يوجد اتصال".
4. **سجّل الخروج ثم ادخل من جديد:** يجب أن تظهر البيانات بعد مزامنة سريعة، وليس بعد تحميل كامل.
5. **راقب تقرير المرحلة 0 والمرحلة 6** وقارن الأرقام. إذا لم يتحسن الرقم، توقّف وأبلغ قبل المتابعة.

---

## 11. نص جاهز للصق للوكيل

> انسخ ما بين الخطين إلى الوكيل:

---
أنت تنفذ خطة `KROTAK_PERFORMANCE_PLAN_AR.md` على مشروع `لوحه` (لوحة كروتك برو).

**الهدف:** كل البيانات محلية (IndexedDB عبر Dexie)، والمزامنة تنزّل التغييرات فقط، ولا مستمعات على مجموعات كاملة، والتنقل فوري.

**ابدأ بالترتيب:**
1. أنشئ فرع `perf/local-first-admin` من `feature/krotak-admin-control-center`، وأنشئ tag `pre-perf-2026-10-22`.
2. نفّذ المرحلة 0 (القياس) وسلّم `docs/PERF_BASELINE_AR.md`. لا تكمل قبل ذلك.
3. نفّذ المراحل 1 إلى 6 بالترتيب. بعد كل مرحلة: قدّم تقريراً قصيراً بما تغيّر، والملفات، ونتائج الاختبارات، وما لم يُنجز.

**قواعد لا تُكسر:**
- لا `onSnapshot` على مجموعات كاملة. لا `getDocs` على مجموعات كاملة خارج `syncEngine.js`. لا `force` إلا لزر المزامنة الكاملة.
- لا تغيّر منطق العمولة أو المال أو التسوية أو الحسابات. الخطة تضيف حقولاً فقط.
- لا تحذف أي حقل قائم.
- لا تشغّل `backfill --apply` على الإنتاج. شغّل التجريبي فقط وسلّم تقريره.
- لا `push` إلى `main`، ولا دمج، ولا نشر.
- لا بيانات حقيقية في الاختبارات. استخدم بيانات اصطناعية.
- لا تطبع أسرار أو مفاتيح خدمة، ولا تضعها في السجلات أو الوثائق.

**عند أي شك:** توقّف واسأل، ولا تخمّن قراراً من قرارات المالك في القسم 9.

**معيار النجاح النهائي:** فتح اللوحة بدون تغييرات حوالي 6 قراءات، التنقل صفر قراءات، زر التحديث يقرأ التغييرات فقط، الشاشة تظهر من القاعدة المحلية بدون سبينر بعد أول زيارة، وكل الاختبارات والبناء ناجحة أو موثّق سبب كل استثناء.
---

---

## 12. الملخص التنفيذي للمالك

- **المشكلة:** اللوحة تقرأ كل البيانات من Firebase مرات كثيرة، وتفتح مستمعات حيّة على كل المبيعات، وتجبر التحديث الكامل عند كل إجراء صغير.
- **الحل:** قاعدة محلية، ومزامنة تنزل التغييرات فقط، وشاشات تقرأ من القاعدة المحلية، وانتقالات بدون تحميل.
- **المدة التقديرية:** حوالي 8 إلى 11 يوم عمل للوكيل مع المراجعة، موزعة على 7 مراحل. التقدير يُعاد ضبطه بعد المرحلة 0.
- **المخاطر:** تغيير هيكل البيانات بإضافة حقول، وسكربت الملء الأولي، وتعديل كبير في الواجهة. الحماية: القياس، والتجريبي قبل التطبيق، والاختبارات، والفرع المنفصل بدون دمج.
- **ما لا تغيّره هذه الخطة:** الحسابات المالية، وقرارات العمولة، ومنطق الاشتراكات، وتطبيق Android.
