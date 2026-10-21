# المرحلة 0 — تقرير تثبيت خط الأساس

**المستودع:** `KAYANSTOR/Krotic-Admin-App` (خاص).
**تاريخ التقرير:** 2026-10-21.
**الفرع العامل:** `feature/admin-control-center-contracts`.
**نوع المستند:** لقطة خط أساس. لا تغيير على `main`، ولا نشر إنتاجي، ولا قراءة
غير مصرح بها لبيانات المستخدمين.

## 1. حالة المستودع (Git)

| البند | القيمة |
|---|---|
| الفرع الحالي | `feature/admin-control-center-contracts` (أُنشئ من `main`) |
| HEAD قبل الفرع | `61472fcd8d732e396e373553416cce74fe8943dc` |
| `origin/main` | `61472fcd8d732e396e373553416cce74fe8943dc` (مطابق) |
| رأس الإدارة المعروف سابقًا | `61472fc` — لا يزال الرأس الحالي، ولم يتقدّم |
| حالة الشجرة | نظيفة عند الفرع (`.openhands/` غير متعقّب فقط) |
| مستنسخ ضحل | نعم؛ أُجري `git fetch --unshallow` لقراءة السجل |
| رموز الإصدار (tags) | `archive/fa-2026-10-20`, `archive/feature-krotak-admin-control-center-2026-10-20` |
| فروع origin | `main` فقط (فرع الميزة القديم دُمج ثم أُزيل) |

آخر 3 commits على `main`: `61472fc` (persist admin notifications) → `90995d2`
(signed entitlement lease activation) → `8e5024b` (Vercel deployment author).

**لا تغييرات على `main`، ولا دفع، ولا نشر إنتاجي، ولا قراءة بيانات مستخدمين.**

## 2. تعليمات وملفات البناء

- لا يوجد `AGENTS.md` أو `.cursorrules` أو `.agents/skills` في المستودع.
- `package.json`: اسم `krotak-pro-admin`، `type: module`، Node `>=20`، React 18 +
  Vite 5 + Tailwind + firebase-admin 13. سكربتات: `test` (`node --test test/*.test.js`),
  `lint` (`node scripts/check-rules.mjs`), `test:rules` (محاكي Firestore), `build` (vite).
- `.github/workflows/ci.yml`: مهمتان — `build-admin` (install → `npm test` →
  Firebase Rules emulator → `npm run build`) و`validate-functions` (install في
  `functions/` → `npm test` → `node --check index.js`). يشتغل على `main` والفرع القديم.
- `vercel.json`: `rewrites` لإعادة استخدام `api/settings.js` (لـ`/api/template-center`,
  `/api/entitlements/activate`, `/api/entitlements/device-rebind`)، و`api/settlement`
  (لـ`/api/record-payment`)، و`api/manage-user-auth` (OTP + account-notifications).
  يوجد `crons` يومي واحد (`/api/dispatch-notifications`)، و`functions` بحدود
  `maxDuration/memory`. `ignoreCommand` يتخطى النشر عند وجود `[otp-no-deploy]`.
- `firebase.json`: `functions` من `functions/`، `firestore` rules/indexes، ومحاكيات.
- `firestore.indexes.json`: 3 فهارس مركّبة (`sales` status+createdAt، `sales`
  status+faceValue، `notification_requests` status+scheduledAt).
- `firestore.rules`: كل سلطة الإدارة من `Admins/{uid}` أو `admins/{uid}`؛ حقول
  الوصول مملوكة للخادم؛ مجموعات مركز القوالب مغلقة على العميل؛ الدفعات/التسويات
  `write: if false`؛ سجل التدقيق create/read فقط.

## 3. الصفحات والمسارات الخادمية والمجموعات لكل مجال

### 3.1 صفحات اللوحة (`src/App.jsx` + `src/components/Sidebar.jsx`)

`/login`, `/` (لوحة المعلومات), `/settings`, `/users`, `/users/:uid`, `/sales`,
`/notifications`, `/admins`, `/audit`, `/template-center`.

### 3.2 دوال Vercel (`api/`) — 11 دالة (الحد ≤ 12 في اختبار `vercelFunctionLimit.test.js`)

`admin-session.js`, `admins.js`, `dispatch-notifications.js`, `manage-user-auth.js`,
`migrate.js`, `network-secret.js`, `networks.js`, `register-network.js`,
`send-fcm.js`, `settings.js`, `settlement.js`, و`sales/ingest.js` (مجلد فرعي،
يُحتسب ضمن العدد). **لا تُضاف دالة جديدة دون توثيق وتجنّب تجاوز الحد.**

### 3.3 المجموعات (من `firestore.rules`)

`users/{uid}` (+`devices`, `notifications`)، `networks/{networkId}` (+`sales`,
`payments`, `settlements`, `_metadata`)، `Admins`/`admins`, `app_settings`,
`admin_audit_logs`, `admin_aggregates`, `sale_ingest_registry`,
`network_registration_phone_index`, `admin_notification_history`,
`notification_requests`, `notification_deliveries`,
`template_center_drafts`/`template_center_releases`/`template_center_pointers`.

### 3.4 لكل مجال من مجالات المهمة

| المجال | الصفحة الحالية | المسار الخادمي | المجموعات |
|---|---|---|---|
| مركز القوالب (محافظ + وارد + صادر) | `/template-center` (`TemplateCenterPage.jsx`) | `POST /api/template-center` (actions: catalog, list, list-networks, save-draft, delete-draft, simulate-inbound, preview-outbound, publish, rollback, read-active) | `template_center_drafts/releases/pointers` |
| الإشعارات (FCM + جدولة) | `/notifications` (`NotificationsPage.jsx`) | `POST /api/send-fcm`, `GET/POST /api/dispatch-notifications`, `POST /api/manage-user-auth?__apiRoute=account-notifications` | `notification_requests`, `notification_deliveries`, `users/{uid}/notifications`, `admin_notification_history` |
| المستخدمون/الأجهزة | `/users`, `/users/:uid` | `POST /api/manage-user-auth`, `POST /api/networks`, `POST /api/admins` | `users`, `users/{uid}/devices`, `admin_aggregates` |
| الاستحقاق/lease | (لا شاشة مخصصة؛ عرض في ملف المستخدم) | `POST /api/entitlements/activate`, `POST /api/entitlements/device-rebind` | `users/{uid}.entitlementInstallationId`, `users/{uid}/devices` |
| المزايا المدفوعة | **لا شاشة** | **لا مسار** | `users/{uid}.feature_entitlements` (يقرأه Android فقط) |

## 4. ما يمكن فحصه محليًا وما يحتاج بيئة

**قابل للفحص محليًا:**
- `npm test` (اختبارات الوحدة) و`npm run build` و`npm run lint`.
- `npm run test:rules` (محاكي Firestore؛ يحتاج Java + تنزيل firebase-tools).
- التحقق الخادمي للحمولة وكتالوج القوالب (نُفِّذ فعليًا في اختبارات العقود).

**يحتاج Vercel/Firebase أو بيانات بيئة (غير متحقق هنا):**
- حالة النشر الفعلي على Vercel: واجهة `deployments` أعادت `403 Resource not
  accessible by integration` → **Unknown**.
- وجود مسودات/إصدارات حقيقية في `template_center_*`، أو أي عنصر «مزروع سابقًا»:
  **حالة البيانات غير معروفة** (لا صلاحية قراءة إنتاج).
- ضبط المتغيرات `FIREBASE_SERVICE_ACCOUNT`, `KROTAK_HMAC_SECRET`,
  `ENTITLEMENT_PRIVATE_KEY`, `CRON_SECRET`: يمكن التحقق من **اسم** المتغير فقط؛
  لا تُعرض قيمه. لا فحص قيمة في هذا التقرير.

## 5. حالة CI (فحص فعلي)

كل تشغيلات `Admin CI` على `main` منذ التشغيل #268 (2026-10-20T03:45Z) تنتهي
بـ`failure` **بصفر خطوات** (`steps: []`) خلال ~3 ثوان، بما فيها الرأس الحالي
`61472fc` (تشغيل #272). آخر تشغيل ناجح كان #264 على الفرع القديم. ملف
`.github/workflows/ci.yml` **مطابق بايت-ببايت** لما نجح سابقًا (لا فرق مقابل
`3374a28`). لذلك الفشل بنيوي (runner/billing) لا يخصّ الكود. السجلات غير قابلة
للقراءة (أرشيف 22 بايت؛ `check-runs`/annotations تعيد 403). **لا يُدّعى نجاح CI،
ولا يُعدَّل الكود لإصلاحه.** يلزم فحص إعدادات Actions/الفواتير من المالك.

## 6. نتائج خط الأساس (شُغِّلت محليًا)

- `npm install` ثم `npm test`: **196/196 ناجح**.
- `functions/` `npm install` ثم `npm test`: **17/17 ناجح**.
- لم يُشغَّل `npm run test:rules` (محاكي) في هذه الجلسة؛ لم يُدّعَ نجاحه.

## 7. شروط القبول للمرحلة 0

- [x] تسجيل commit IDs الفعلية وحالة الشجرة والفرع.
- [x] قائمة صريحة بالصفحات والمسارات الخادمية والمجموعات لكل مجال.
- [x] لا تغييرات على `main`، ولا نشر إنتاجي، ولا قراءة غير مصرح بها.
- [x] المستودع كان نظيفًا عند البدء (لا تغييرات شخص آخر) فبدأ العمل على فرع مستقل.
