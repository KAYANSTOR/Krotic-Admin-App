# تسليم إلى الوكيل التالي — لوحة إدارة كروتك برو

> **الغرض:** استلام الحالة من حيث توقّف الوكيل السابق، دون إعادة عمل ولا كسر
> قرارات المالك. اقرأ هذا الملف بالكامل قبل أي تعديل.

**المستودع:** `KAYANSTOR/Krotic-Admin-App` (خاص).
**الفرع العامل:** `feat/local-first-admin` — الرأس المدفوع: `bc4e23d3`.
**قاعدة الدمج:** `origin/main` = `f3a4546`.
**المرجع الحي (قراءة فقط، ممنوع التعديل):** `KAYANSTOR/Krotak-Pro`.
**تاريخ التسليم:** 2026-10-21.

---

## 0) حدود صارمة (لا تُخالف)

1. **المستودع المسموح بتعديله:** `Krotic-Admin-App` فقط. مستودع Android
   (`Krotak-Pro`) للقراءة فقط — لا commit، لا تعديل ملف.
2. **ممنوع:** الدمج إلى `main`، الدفع إلى `main`، النشر إلى الإنتاج، أي ترحيل
   أو حذف بيانات حية، دون موافقة صريحة جديدة من المالك على الإجراء بعينه.
3. **ممنوع** طباعة/تسجيل/نسخ أي سر: مفاتيح Vercel، Firebase، private key،
   service account، رموز مستخدمين. يُسمح بفحص وجود **اسم** المتغير فقط.
4. الكتابة الإدارية عبر صلاحيات الخادم وFirebase Admin. **لا** تجعل المتصفح
   يكتب مجموعات الإدارة/الاستحقاق/القوالب مباشرة على Firestore.
5. **لا** تفترض أن وجود commit = نجاح CI أو نشر Vercel/Firebase. افحص فعليًا،
   وسجّل المجهول `Unknown`.
6. **لا** تعتبر fixtures/الحزم الثابتة بيانات Production.
7. حافظ على حد دوال Vercel (≤ 12). لا تنشئ ملف `api/*.js` جديدًا لمجرد إضافة
   endpoint؛ استخدم نمط `__apiRoute` في `api/settings.js` + rewrite في
   `vercel.json`.
8. لا تخلط بين: قوالب SMS الصادرة، إشعارات FCM، قوالب التحويل الواردة،
   مصادر الرسائل المسمّاة محافظ، والاستحقاقات/leases المدفوعة.
9. لا تحوّل المحافظ إلى محافظ مالية/أرصدة. لا تعدّل منطق المبيعات/العمولات/
   التسويات في هذه المهمة.

---

## 1) الحالة الحالية (Git — مؤكَّدة)

| البند | القيمة |
|---|---|
| الفرع العامل | `feat/local-first-admin` |
| HEAD المحلي والمدفوع | `bc4e23d3` (مطابق تمامًا لـ`origin/feat/local-first-admin`) |
| `origin/main` | `f3a4546` |
| working tree | نظيف (`git status --porcelain` فارغ) |
| فروع أخرى على origin | `main`, `feature/krotak-admin-control-center` (`8f1bae8`), `copilot/vscode-mvium5qy-1ydv` (`52cd237`), `feat/android-default-catalog-ingest-api` (`e68a4db`) |
| دفع لاحق | استخدم `git remote set-url origin "https://${GITHUB_TOKEN}@github.com/KAYANSTOR/Krotic-Admin-App.git"` ثم `GIT_TERMINAL_PROMPT=0 git push origin feat/local-first-admin`، ثم أعد الرابط العادي. |

سلسلة commits على الفرع فوق `main`:

```
bc4e23d3 feat(admin): independent paid-features screen with server-only entitlement write path
0a991f08 feat(admin): wire local-first DB into the app shell
8800cb72 chore: port local-first admin sync foundation onto current main
```

---

## 2) ما أُنجز بالفعل (لا تُعده)

### أ) المزايا المدفوعة (كانت الموضوع الوحيد بلا شاشة وبلا مسار خادمي) — مكتمل
- `server/_lib/paidFeatureEntitlements.js`: قراءة/كتابة `users/{uid}.feature_entitlements`.
  مفاتيح معتمدة فقط (`hotspot_template_editor`, `mikrotik_card_generator`)،
  قيم منطقية فقط، داخل `runTransaction` + سجل `admin_audit_logs`
  (`PAID_FEATURE_ENTITLEMENT_UPDATE`). مدير فقط.
- المسار: `POST /api/paid-features` عبر **نفس** `api/settings.js`
  (`__apiRoute=paid-features`) + rewrite في `vercel.json`. **بلا ملف API جديد.**
- الشاشة: `src/pages/PaidFeaturesPage.jsx` + المسار `/paid-features` في
  `src/App.jsx` + مدخلات في `Sidebar.jsx`/`BottomNav.jsx`/عنوان في `Layout.jsx`
  + مُحمّل في `src/lib/routeLoaders.js`.
- القواعد: `feature_entitlements`, `feature_entitlements_updated_at`,
  `feature_entitlements_updated_by` أُضيفت إلى `accessFields()` في
  `firestore.rules` (حجب كتابة العميل، حتى المدير)، مع تأكيد في
  `scripts/check-rules.mjs`.

### ب) أساس local-first (مُثبَّت على الفرع)
- `src/lib/localDb/` (Dexie/IndexedDB): `db.js`, `syncCore.js`, `syncEngine.js`,
  `useAutoSync.js`, `useLocalQuery.js`, `localQueries.js`, `readMeter.js`,
  `LocalDbContext.jsx`, `syncEvents.js`, `plain.js`, `localData.js`.
- `LocalDbProvider` يلفّ `<AppRoutes/>` في `App.jsx`؛ تفريغ القاعدة المحلية عند
  تسجيل الخروج في `AuthContext.jsx`؛ `AdminShell` + `Outlet` موحّدان؛ `Suspense`
  داخل `Layout.jsx`؛ علامة `v7_startTransition`.

### ج) المرحلة 1 من خطة الأداء — علامات الخادم والقواعد (مُثبَّتة مسبقًا على main)
- `updatedAtMs` موجود في 16 ملفًا خادميًا (منها `api/sales/ingest.js`,
  `server/_lib/networkLedger.js`, `api/settlement.js`, `functions/index.js`,
  `api/migrate.js`, `api/register-network.js`, `api/networks.js`, `api/admins.js`).
- شواهد الحذف: `sync_tombstones` مكتوبة في `api/networks.js:466` ومقروءة في
  `firestore.rules:156`.
- قواعد `collectionGroup`: `firestore.rules:148` (sales) و`:151` (payments).
- سكربت الملء موجود: `scripts/backfill-updated-at.mjs` (dry-run افتراضيًا).

---

## 3) ما تبقّى من الخطة (المهام المطلوبة بالترتيب)

### المهمة 1 — عاجلة/تشخيصية: فشل CI على `main`
- آخر 5 تشغيلات على `main` **فاشلة** (`Admin CI`: مهمتا `build-admin` و
  `validate-functions`).
- محليًا: `functions/npm test` = 18/18 ناجح. لا يوجد Java 21 في البيئة لتشغيل
  `npm run test:rules` (محاكي Firestore).
- **المطلوب:** إعادة إنتاج الفشل بقراءة سجل CI الفعلي (وليس تخمينًا)، وتحديد
  السبب (إعداد Actions/فوترة/Java/محاكي)، وإصلاحه على فرع، أو توثيقه `Unknown`
  وإبلاغ المالك. لا تلمس `main` مباشرة.

### المهمة 2 — المرحلة 3 من خطة الأداء: ترحيل الشاشات إلى القاعدة المحلية
- **الحالة:** الشاشات **ما زالت** تستورد `../lib/adminData`، ولم تُستخدم
  `useLocalQuery` في أي صفحة بعد.
- **الملفات المتبقية (12):** `src/contexts/AuthContext.jsx`,
  `src/components/Layout.jsx`, `src/components/UserBillingModal.jsx`,
  `src/pages/{AdminsPage,DashboardPage,UserProfilePage,AuditPage,SettingsPage,
  PaidFeaturesPage,NotificationsPage,SalesPage,UsersPage}.jsx`.
- **الهدف:** قراءة الصفحات من IndexedDB محليًا (صفر قراءات عند التنقل)، وزر
  تحديث يقرأ التغييرات فقط، وظهور فوري بلا سبينر بعد أول زيارة.
- **قيد:** لا `onSnapshot` على مجموعة كاملة (يوجد 6 استدعاءات `onSnapshot` في
  `src/lib/adminData.js`؛ منها `subscribeNetworkSalesRealtime` و
  `subscribeAdminDataCache`). لا `getDocs` على مجموعة كاملة خارج `syncEngine.js`.
  لا `force` إلا لزر «مزامنة كاملة» اليدوي.
- **قيد:** لا تغيّر منطق العمولة/المال/التسوية.

### المهمة 3 — المرحلة 4: الانتقالات كأنك داخل تطبيق Android
- تحقق من ثبات الهيكل أثناء التنقل (تم جزئيًا بـ`AdminShell`)، وأضف تحسينات
  الانتقال المتبقية من القسم 7.5 في `KROTAK_PERFORMANCE_PLAN_AR.md`.

### المهمة 4 — المرحلة 5: التنظيف والإزالة النهائية
- إزالة طبقة كاش `localStorage` القديمة (`src/lib/adminDataCache.js`) بعد اكتمال
  الترحيل، وإزالة اختبارها `test/adminDataCache.test.js`، وإزالة `onSnapshot`
  على المجموعات الكاملة، وإخراج `backups/*.json` من الفهرس (قرار المالك #5 —
  يحتاج موافقة على حذف التاريخ).

### المهمة 5 — المرحلة 6: التحقق والقبول
- قياس فعلي من Firebase Console → Firestore → Usage قبل/بعد (يتطلب جلسة موثقة).
- تحديث `docs/PERF_BASELINE_AR.md` بالأرقام الحقيقية (حاليًا «لم يُقَس»).

### المهمة 6 — المرحلة 1 (العقود) لتطبيق Android — تحتاج قرار/اعتماد خارجي
- **اكتشاف صدق مهم:** `contracts/schemas/feature-entitlements.schema.json`
  كان يشير إلى مستهلك Android (`lib/domain/entities/paid_feature.dart` /
  `PaidFeature` / `PaidFeatureGate`) **غير موجود في `Krotak-Pro@main`**
  (تحقّق 2026-10-21 عبر GitHub API: صفر نتائج لكل من `PaidFeature`,
  `paid_feature`, `feature_entitlements`, `hotspot_template_editor`,
  `mikrotik_card_generator`). صُحّح التعليق في المخطط، وأُضيفت لافتة صريحة في
  الشاشة: الحفظ إجراء إداري حقيقي لكنه **لا يُثبت أثرًا على أي جهاز** قبل
  اعتماد العقد من وكيل Android.
- **المطلوب:** توثيق عقد ACK versioned (`uid`, `installationId`, `releaseId`,
  `payloadHash`, وقت التطبيق، عدد العناصر، التعارضات، نتيجة parser/renderer)،
  idempotent، بلا أسرار. وحالات التطبيق المنفصلة: `Draft`, `Published`,
  `Fetched`, `Cached`, `Applied locally`, `Parser refreshed`, `Unknown`.
  المخططات/الـfixtures موجودة في `contracts/`؛ راجع
  `docs/ADMIN_CONTROL_CENTER_CONTRACTS_AR.md` و
  `docs/ANDROID_ADMIN_INTEGRATION_CONTRACT_V2_AR.md`.
- **قيد:** لا تدّعِ أن Android جاهز لإرسال ACK. سجّل الاعتماد الخارجي بدقة.

### المهمة 7 — البند المعلّق: مفتاح ثابت للمحافظ
- Android يزرع صفوف `wallets` بمعرّفات وقت التشغيل (`wallet-N`/عشوائية)؛
  المفتاح الثابت الوحيد هو `WalletSpec.key`. **`needs_decision`** — لا تختر
  mapping من عندك.

### المهمة 8 — قرارات المالك المعلّقة (القسم 9 من خطة الأداء)
- مصدر الإجماليات (`admin_aggregates` مقابل إعادة الحساب)؛ قبول قراءة كاملة
  مرة واحدة لكل جهاز؛ تفريغ IndexedDB عند الخروج؛ Spark مقابل Blaze؛ إخراج
  `backups/*.json`. **لا تخمّن أي قرار منها.**

---

## 4) ما لا يمكن التحقق منه في هذه البيئة (سجّله `Unknown`)
- نشر Vercel (سابقًا 403) وحالة `deployments`.
- تشغيل قواعد Firestore على المحاكي (`npm run test:rules`) — لا Java 21.
- قراءة بيانات Production الفعلية (هل العناصر «مزروعة سابقًا»؟) — يحتاج صلاحية.
- أثر تغيير المزايا على جهاز Android فعلي — المستهلك غير موجود بعد.

---

## 5) أوامر التحقق القياسية

```bash
# الحالة
git status --porcelain && git rev-parse HEAD origin/main

# الاختبارات والبناء (لا تحتاج Java)
npm install
npm test                # node --test test/*.test.js  → 334 pass / 0 fail على bc4e23d3
npm run test:rules:static
npm run build

# اختبارات القواعد (تحتاج Java 21 + firebase-tools)
npm run test:rules

# اختبارات الدوال الخادمية
cd functions && npm install && npm test   # 18/18
```

---

## 6) معيار النجاح النهائي (من خطة الأداء)
فتح اللوحة بلا تغييرات ≈ 6 قراءات؛ التنقل صفر قراءات؛ زر التحديث يقرأ التغييرات
فقط؛ الشاشة تظهر من القاعدة المحلية بلا سبينر بعد أول زيارة؛ كل الاختبارات
والبناء ناجحة أو موثّق سبب كل استثناء.

**عند أي شك: توقّف واسأل المالك، ولا تخمّن قرارًا من قراراته.**
