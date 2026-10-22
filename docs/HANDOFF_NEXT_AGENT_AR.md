# تسليم إلى الوكيل التالي — لوحة إدارة كروتك برو

> **الغرض:** استلام الحالة من حيث توقّف الوكيل السابق دون إعادة عمل ولا كسر
> قرارات المالك. اقرأ هذا الملف بالكامل، ثم `docs/CI_TRIAGE_AR.md` و
> `docs/ADMIN_LOCAL_FIRST_ARCHITECTURE_AR.md` و`docs/PERF_BASELINE_AR.md`.

**المستودع:** `KAYANSTOR/Krotic-Admin-App` (خاص).
**الفرع العامل:** `cline/tp5e5bzb` — مبني على `feat/local-first-admin` (`ebc5263f`).
**HEAD عند التسليم:** `8e2cb84` (مدفوع إلى origin).
**قاعدة الدمج:** `origin/main` = `f3a4546` (لم يُلمس، ولا PR، ولا دمج).
**المرجع الحي (قراءة فقط، ممنوع التعديل):** `KAYANSTOR/Krotak-Pro`.
**تاريخ التسليم:** 2026-10-22.

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
7. حافظ على حد دوال Vercel (≤ 12). لا تنشئ ملف `api/*.js` جديدًا؛ استخدم نمط
   `__apiRoute` في `api/settings.js` + rewrite في `vercel.json`.
8. لا تخلط بين: قوالب SMS الصادرة، إشعارات FCM، قوالب التحويل الواردة، مصادر
   الرسائل المسمّاة محافظ، والاستحقاقات/leases المدفوعة.
9. لا تحوّل المحافظ إلى محافظ مالية/أرصدة. لا تعدّل منطق المبيعات/العمولات/
   التسويات في هذه المهمة.

---

## 1) الحالة الحالية (Git — مؤكَّدة)

| البند | القيمة |
|---|---|
| الفرع العامل | `cline/tp5e5bzb` |
| HEAD | `8e2cb84` (مطابق لـ`origin/cline/tp5e5bzb`) |
| `origin/main` | `f3a4546` |
| working tree | نظيف |
| PR | لم يُفتح، ولم يُدمج شيء |

سلسلة commits فوق `ebc5263f`: انظر `git log --oneline ebc5263f..HEAD`.

---

## 2) ما أُنجز (لا تُعده)

### أ) المزايا المدفوعة — مكتمل (من الوكيل السابق)
- `server/_lib/paidFeatureEntitlements.js`: كتابة/قراءة
  `users/{uid}.feature_entitlements` بمفاتيح معتمدة فقط، داخل `runTransaction`
  + `admin_audit_logs` (`PAID_FEATURE_ENTITLEMENT_UPDATE`). مدير فقط.
- المسار `POST /api/paid-features` عبر **نفس** `api/settings.js`؛ بلا ملف API جديد.
- الشاشة `/paid-features` + القواعد تقفل كتابة العميل.

### ب) المرحلة 1 (علامات الخادم والقواعد) — مُثبَّتة على `main` مسبقًا
`updatedAtMs` في 16 ملفًا خادميًا، `sync_tombstones`، قواعد `collectionGroup`،
`scripts/backfill-updated-at.mjs`.

### ج) المرحلة 3 — ترحيل الشاشات إلى القاعدة المحلية: **مكتمل (12/12)**
- الملفات: `AuthContext`, `Layout`, `UserBillingModal`, `AdminsPage`,
  `DashboardPage`, `UserProfilePage`, `AuditPage`, `SettingsPage`,
  `PaidFeaturesPage`, `NotificationsPage`, `SalesPage`, `UsersPage`.
- كلها تقرأ عبر `useLocalQuery` + دوال `src/lib/localDb/localData.js`.
- **حُذف** `src/lib/adminData.js` و`src/lib/adminDataCache.js` و
  `test/adminDataCache.test.js`. لا استيراد لـ`adminData` في `src/`.
- المستمع الوحيد المتبقي: `Layout.jsx` على أحدث مستخدم بـ`limit(1)`
  (تنبيه مستخدم جديد — قراءة واحدة، ليست مجموعة كاملة).
- تنبيه «بيع جديد» في `SalesPage` صار يعتمد على فروق المزامنة المحلية، بلا
  `onSnapshot`.
- تفاصيل المعمارية والقواعد الست: `docs/ADMIN_LOCAL_FIRST_ARCHITECTURE_AR.md`.

### د) المرحلة 4 — انتقالات الهيكل: مكتمل
- `AdminShell` + `Outlet` (كان موجودًا) + `Suspense` حول المحتوى فقط.
- **جديد:** تحميل مسبق خامل لكل الصفحات بعد الدخول
  (`preloadAllRoutes` + `requestIdleCallback` في `App.jsx`)، وتحميل عند
  `pointerdown` في `Sidebar`/`BottomNav`، وتلاشي محتوى 150ms بـ`opacity` فقط
  (بلا layout shift)، وارتفاع ثابت لمنطقة التحميل (`.page-fallback`).

### هـ) المرحلة 5 — التنظيف: مكتمل
- كاش `localStorage` القديم أُزيل. المتبقي في `localStorage` تفضيلات واجهة فقط
  (فلاتر، قنوات الإشعارات، تقدم إصلاح المجاميع) — لا بيانات إدارة.
- لا `getDocs` على مجموعة كاملة خارج `syncEngine.js` (انظر «دين تقني»).
- `backups/*.json` كانت قد أُزيلت من الفهرس في `8800cb7` وأُضيفت إلى
  `.gitignore`؛ الملفات باقية في تاريخ Git وتنتظر قرار المالك بشأن التاريخ.

### و) تشخيص CI — `Unknown` مع أدلة
- كل نقاط Actions API تُرجع **403** لهذا التكامل → السجل غير مقروء من هنا.
- أعدت تنفيذ كل خطوات `ci.yml` محليًا، **بما فيها محاكي Firestore بـJava 21
  (20/20)** وNode 22. كلها ناجحة. التفاصيل والأوامر: `docs/CI_TRIAGE_AR.md`.
- **لم أعدّل `ci.yml`** لأن أي تعديل بلا سجل = تخمين.

---

## 3) ما تبقّى (بالترتيب المقترح)

### المهمة 1 — المرحلة 6: قياس فعلي من Firebase Console
- سجّل `Firestore → Usage → Document reads` قبل/بعد حسب جدول
  `docs/PERF_BASELINE_AR.md` §4، واملأ عمود «المقيس فعليًا».
- الأرقام الحالية في الوثيقة **محسوبة من الكود** وموسومة كذلك؛ لا تستبدلها
  بأرقام Console إلا بعد قياس حقيقي.

### المهمة 2 — عقود ACK: تحتاج اعتماد وكيل Android
- العقد والحالات موثّقة ومختبرة: `contracts/schemas/android-ack.schema.json`،
  `android-application-state.schema.json`، و`docs/ADMIN_CONTROL_CENTER_CONTRACTS_AR.md` §3/§4/§4.2.
- **فجوة مفتوحة:** لا حقل لنتيجة **renderer** في `ackVersion=1` (فقط
  `parserRefreshed`). القرار: حقل اختياري الآن أم `ackVersion=2`؟
- لا تدّعِ أثرًا على جهاز. تحقق 2026-10-21 (وكيل آخر) قال إن مستهلك
  `PaidFeature`/`PaidFeatureGate` غير موجود في `Krotak-Pro@main`؛ محاولتي
  لإعادة التحقق فشلت (404 لهذا التكامل) → الحالة `Unknown`.

### المهمة 3 — `needs_decision`: مفتاح ثابت للمحافظ
- `docs/NEEDS_DECISION_WALLET_KEY_AR.md` — أربعة خيارات وأثر كل خيار.
- **لا تختر mapping** بين `WalletSpec.key` ومعرّفات وقت التشغيل.

### المهمة 4 — قرارات المالك الخمسة (القسم 9 من خطة الأداء)
1. مصدر الإجماليات (`admin_aggregates` أم إعادة الحساب).
2. قبول قراءة كاملة مرة واحدة لكل جهاز جديد.
3. تفريغ IndexedDB عند الخروج (التنفيذ الحالي: **يفرّغها** — تغييرها يحتاج قرارًا).
4. Spark أم Blaze.
5. إخراج `backups/*.json` (مُخرج من الفهرس؛ حذف التاريخ يحتاج موافقة صريحة).

### المهمة 5 — دين تقني معروف (لم يُنفَّذ)
- `src/lib/adminApi.js` لا يزال يحذف الشبكة من العميل (`getDocs` + `deleteDoc`
  على مجموعات فرعية). التحويل إلى `POST /api/networks { action: 'delete' }`
  يمس مسار حذف حسابات — يحتاج مراجعة وموافقة منفصلة.
- `UserDevicesPanel` يقرأ `users/{uid}/devices` بـ`getDocs` (مجموعة فرعية لمستخدم
  واحد) — مرشح للانتقال إلى المزامنة لاحقًا.
- الفحص التزايدي = 10 قراءات (مصدر لكل مجموعة) مقابل هدف ≈6. التحسين يحتاج
  مؤشرًا مجمّعًا (`sync_meta`) وتغييرًا على عقد المزامنة.

---

## 4) ما لا يمكن التحقق منه في هذه البيئة (`Unknown`)
- سجل CI الفعلي على GitHub (403 لكل نقاط Actions).
- نشر Vercel وحالة deployments.
- قراءة بيانات Production الفعلية.
- استهلاك Firebase Console (Usage) قبل/بعد.
- وجود مستهلك المزايا المدفوعة في `Krotak-Pro` (404 لهذا التكامل).
- أثر أي تغيير على جهاز Android فعلي.

---

## 5) أوامر التحقق القياسية (نتائجها في هذا الفرع)

```bash
git status --porcelain && git rev-parse HEAD origin/main

npm install
npm test                 # 315/315 ناجح
npm run test:rules:static # ناجح
npm run build            # ناجح
cd functions && npm install && npm test   # 18/18 ناجح

# اختبارات القواعد تحتاج Java 21 + منفذ 8080 حرًا
npm run test:rules       # 20/20 ناجح (شغّلتها محليًا بـ Temurin 21)
```

> في هذه البيئة كان المنفذ 8080 مشغولًا و`::1` غير متاح، فشغّلت المحاكي بملف
> إعداد محلي غير متعقَّب (`firebase.local-ci.json`، منفذ 8180) مضاف إلى
> `.gitignore`. **لم أغيّر `firebase.json`** لأن Actions لا يعاني هذه المشكلة.

---

## 6) معيار النجاح النهائي
- فتح اللوحة بلا تغييرات: ≈6 قراءات (المنفَّذ حاليًا 10 فحوص — فارق موثّق).
- التنقل: صفر قراءات. ✅ (لا استيراد Firebase في أي شاشة)
- زر التحديث: يقرأ التغييرات فقط. ✅
- الظهور الفوري بلا سبينر بعد أول زيارة. ✅
- كل الاختبارات والبناء ناجحة أو موثّق سبب كل استثناء.

**عند أي شك: توقّف واسأل المالك، ولا تخمّن قرارًا من قراراته.**
