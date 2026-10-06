# كروتك برو — Krotak Pro Admin
> لوحة تحكم إدارية عربية لإدارة المستخدمين والمبيعات والعمولات والإشعارات وإعدادات التطبيق.

## 📖 نظرة عامة

هذا المستودع يحتوي على واجهة لوحة إدارة مبنية كتطبيق React أحادي الصفحة (SPA).
اسم الحزمة المعلن هو `krotak-pro-admin`، والنسخة المعلنة `1.0.0`.
الدخول يتم بالبريد الإلكتروني وكلمة المرور عبر Firebase Authentication.
بعد الدخول يتحقق التطبيق من وجود مستند المدير الموافق لـ Firebase Auth UID.

المسارات المرئية في التطبيق هي:

- `/login` — تسجيل الدخول.
- `/` — لوحة المعلومات.
- `/settings` — الإعدادات العامة.
- `/users` — إدارة المستخدمين والفوترة.
- `/sales` — المبيعات والعمولات.
- `/notifications` — الإشعارات.
- `/admins` — إدارة المدراء.

الدليل: `src/App.jsx` و`public/manus-routes.json`.

لا يعرّف المستودع جمهوراً تجارياً مفصلاً أو وصفاً مستقلاً للمنتج خارج النصوص الموجودة في الواجهة؛ لذلك أي معلومات من هذا النوع: «غير موثّق في المستودع».

## 🎯 المشكلة والحل

- المشكلة التجارية أو متطلبات أصحاب المصلحة: **غير موثّق في المستودع**.
- الحل المثبت في التنفيذ: واجهة مركزية تعرض مؤشرات المستخدمين والمبيعات، وتتيح تعديل حالات الحسابات والفوترة والإعدادات وإرسال الإشعارات للمدير الموثق (`src/pages/DashboardPage.jsx`, `src/pages/UsersPage.jsx`, `src/pages/SettingsPage.jsx`, `src/pages/NotificationsPage.jsx`).
- مصدر البيانات المستخدم فعلياً هو Cloud Firestore، مع Firebase Authentication للمصادقة (`src/firebase.js`, `src/contexts/AuthContext.jsx`).

## ✨ الميزات الرئيسية

- ✅ تسجيل دخول المدير بالبريد الإلكتروني وكلمة المرور مع رفض الحساب الذي لا يملك مستند `Admins/{UID}` (`src/pages/LoginPage.jsx`, `src/contexts/AuthContext.jsx`).
- ✅ حماية مسارات اللوحة وإعادة المستخدم غير الموثق إلى `/login` (`src/components/ProtectedRoute.jsx`, `src/App.jsx`).
- ✅ عرض إجمالي المستخدمين والنشطين والتجريبيين والمحظورين وعمليات البيع المكتملة والمبيعات وأرباح الإدارة (`src/pages/DashboardPage.jsx`).
- ✅ عرض حالة التطبيق ووضع الصيانة ورسالة الصيانة عند قراءة `app_settings/global_config` (`src/pages/DashboardPage.jsx`).
- ✅ البحث في المستخدمين بالاسم أو الهاتف أو UID، والتصفية حسب تجريبي أو رسمي أو مديون أو محظور (`src/pages/UsersPage.jsx`).
- ✅ تفعيل المستخدم أو حظره، وتحويل الحساب التجريبي إلى رسمي، وتجديد تاريخ الانتهاء بسرعة (`src/pages/UsersPage.jsx`).
- ✅ تعديل تاريخ الاشتراك والعمولة الخاصة ورسالة التحذير الخاصة بالمستخدم (`src/pages/UsersPage.jsx`, `src/components/UserEditModal.jsx`).
- ✅ حساب المستحق والمدفوع والمتبقي لكل شبكة، مع إضافة دفعة مرتبطة بشهر (`src/components/UserBillingModal.jsx`).
- ✅ إرسال إشعار FCM للجميع أو لمستخدم محدد، مع تسجيل التاريخ في Firestore بعد الإرسال (`src/pages/NotificationsPage.jsx`, `api/send-fcm.js`).
- ✅ إرسال إشعار دفع العمولة للمستخدم المستهدف وتسجيله في صندوق إشعاراته (`src/components/UserBillingModal.jsx`).
- ✅ تصفية المبيعات حسب الحالة والتاريخ، وتجميعها لكل شبكة مع جدول قابل للتوسيع (`src/pages/SalesPage.jsx`).
- ✅ دعم حالات البيع `COMPLETED` و`ROLLED_BACK` و`SMS_PENDING` في واجهة المبيعات (`src/pages/SalesPage.jsx`).
- ✅ تعديل حالة التطبيق، العمولة العامة، رسائل التحذير، وعدد الأيام التجريبية (`src/pages/SettingsPage.jsx`).
- ✅ تحديث تاريخ الانتهاء دفعة واحدة للحسابات الرسمية فقط (`src/pages/SettingsPage.jsx`).
- ✅ إنشاء مدير جديد باستخدام Firebase Auth ثانوي حتى لا تُغلق جلسة المدير الحالي، مع منع حذف المدير الحالي من الواجهة (`src/contexts/AuthContext.jsx`, `src/pages/AdminsPage.jsx`).
- ✅ واجهة RTL عربية، تنقل جانبي للشاشات الكبيرة وتنقل سفلي للشاشات الصغيرة (`src/components/Sidebar.jsx`, `src/components/BottomNav.jsx`, `src/index.css`).
- ✅ قابلية تثبيت كتطبيق PWA عبر manifest وحدث `beforeinstallprompt`، مع service worker لصفحة التنقل الاحتياطية (`public/manifest.webmanifest`, `src/components/Layout.jsx`, `public/service-worker.js`).
- ✅ توليد نسخ الأيقونات أثناء `predev` و`prebuild` من أصول محلية قابلة للتكرار (`package.json`, `scripts/generate-icons.js`).

## 🛠️ التقنيات

| المجال | التقنية | دليلها |
|---|---|---|
| الواجهة | React 18 | `package.json` يعتمد `react` و`react-dom` بالإصدار `^18.2.0` |
| البناء والتطوير | Vite 5 | `package.json` و`vite.config.js` |
| لغة ملفات الواجهة | JavaScript / JSX | ملفات `src/**/*.jsx` و`package.json` مع `type: module` |
| التنسيق | Tailwind CSS 3 وPostCSS وAutoprefixer | `package.json`, `tailwind.config.js`, `postcss.config.js` |
| التوجيه | React Router DOM 6 | `package.json`, `src/App.jsx` |
| المصادقة والبيانات | Firebase Web SDK: Auth وFirestore | `package.json`, `src/firebase.js` |
| خدمات الخادم | Firebase Admin SDK | `package.json`, `api/send-fcm.js`, `functions/package.json` |
| الإشعارات | Firebase Cloud Messaging (FCM) | `api/send-fcm.js`, `src/pages/NotificationsPage.jsx` |
| الوظيفة السحابية | Firebase Functions v2 for Firestore | `functions/index.js`, `functions/package.json` |
| واجهة الرموز | Lucide React | `package.json` وملفات الصفحات والمكونات |
| التنبيهات | React Hot Toast | `package.json`, `src/App.jsx` |
| التثبيت | Web App Manifest وService Worker | `public/manifest.webmanifest`, `public/service-worker.js` |
| نسخة Node | Node.js 20 أو أحدث للتطبيق، وNode 20 للوظائف | `package.json`, `functions/package.json` |

## 🏗️ هيكل المشروع

```text
.
├── package.json                 # scripts واعتماديات واجهة الإدارة
├── package-lock.json            # قفل اعتماديات الواجهة
├── vite.config.js               # Vite والمنفذ 3000
├── tailwind.config.js           # ألوان وتخطيط RTL
├── postcss.config.js
├── vercel.json                  # rewrite وتهيئة api/send-fcm.js
├── firebase.json                # مصدر Functions وقواعد Firestore
├── firestore.rules              # قواعد الوصول إلى Firestore
├── .env.example                 # أسماء إعدادات Firebase للواجهة
├── index.html
├── api/
│   └── send-fcm.js              # Vercel Serverless Function للإرسال
├── functions/
│   ├── package.json
│   ├── package-lock.json
│   └── index.js                 # dispatchNotificationRequest
├── public/
│   ├── manifest.webmanifest
│   ├── manus-routes.json
│   └── service-worker.js
├── scripts/
│   ├── generate-icons.js
│   └── icon-assets/              # الأصول المحلية للأيقونات
└── src/
    ├── App.jsx
    ├── firebase.js
    ├── index.css
    ├── main.jsx
    ├── contexts/AuthContext.jsx
    ├── lib/{cn,format}.js
    ├── pages/                    # Login وDashboard وUsers وSales وNotifications وSettings وAdmins
    └── components/               # Layout والتنقل والحماية وUI والنوافذ
```

لا توجد في الشجرة ملفات `models/` أو `schema/` أو `migrations/`.
ولا توجد مجلدات `app/` أو `pages/` في الجذر؛ صفحات التطبيق داخل `src/pages/`.

## 🚀 التشغيل المحلي

### المتطلبات المثبتة

- Node.js بإصدار `>=20` للتطبيق (`package.json`).
- مجلد `functions/` يعلن Node `20` (`functions/package.json`).
- إعدادات Firebase التي يقرأها `src/firebase.js` من متغيرات Vite.

### واجهة الإدارة

الأوامر التالية هي الأوامر المعلنة في `package.json` أو المستخدمة في CI:

```bash
npm ci
npm run dev
```

يستخدم Vite المنفذ `3000` وفق `vite.config.js`، و`npm run dev` يشغّل hook اسمه `predev` قبل الأمر.

لبناء نسخة الإنتاج والتحقق منها:

```bash
npm run build
npm run preview
```

`npm run build` يشغّل `prebuild` أولاً، وكلا الـhooks ينفذان `node scripts/generate-icons.js`.

### اعتماديات الوظائف والتحقق النحوي

```bash
cd functions
npm ci
node --check index.js
```

هذه الخطوات كما هي في `.github/workflows/ci.yml`؛ لا يعرّف المستودع script مستقلّاً داخل `functions/package.json`.

لا يوجد أمر Emulator أو أمر تشغيل محلي آخر معرف في manifests أو workflow؛ لذلك: «غير موثّق في المستودع».

## 🔐 متغيرات البيئة

المتغيرات التالية مطابقة حرفياً للأسماء الموجودة في `.env.example`، ولا يحتوي المثال على قيم:

| الاسم | الغرض المثبت | مطلوب/اختياري |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | قيمة إعداد Firebase Web `apiKey` | مطلوب وفق فحص التهيئة في `src/firebase.js` |
| `VITE_FIREBASE_AUTH_DOMAIN` | قيمة إعداد Firebase Web `authDomain` | غير موثّق في المستودع |
| `VITE_FIREBASE_PROJECT_ID` | قيمة إعداد Firebase Web `projectId` | مطلوب وفق فحص التهيئة في `src/firebase.js` |
| `VITE_FIREBASE_STORAGE_BUCKET` | قيمة إعداد Firebase Web `storageBucket` | غير موثّق في المستودع |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | قيمة إعداد Firebase Web `messagingSenderId` | غير موثّق في المستودع |
| `VITE_FIREBASE_APP_ID` | قيمة إعداد Firebase Web `appId` | غير موثّق في المستودع |
| `VITE_FIREBASE_MEASUREMENT_ID` | قيمة إعداد Firebase Web `measurementId` | غير موثّق في المستودع |

الدليل على المطابقة والاستخدام: `.env.example` و`src/firebase.js`.
يظهر فحص مبكر لغياب `VITE_FIREBASE_API_KEY` أو `VITE_FIREBASE_PROJECT_ID` في `src/firebase.js`.

### متغيرات الخادم المذكورة خارج `.env.example`

هذه الأسماء مستخدمة فعلياً في API، لكنها ليست ضمن جدول `.env.example`:

| الاسم | الغرض المثبت | المصدر |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | بيانات Service Account بصيغة JSON أو base64 لتهيئة Firebase Admin | `api/send-fcm.js` |
| `FCM_DEFAULT_TOPIC` | topic الافتراضي؛ القيمة الاحتياطية في الكود `krotak_all_users` | `api/send-fcm.js` |
| `FCM_ANDROID_CHANNEL_ID` | Android notification channel؛ القيمة الاحتياطية في الكود `krotak_admin_v2` | `api/send-fcm.js` |

لا تُدرج أي قيمة سرية هنا؛ قيمة `FIREBASE_SERVICE_ACCOUNT`: **غير موثّقة في المستودع**.

## 📜 الأوامر المتاحة

| الأمر | ما يفعله وفق التعريف/الملفات |
|---|---|
| `npm run icons` | ينفذ `node scripts/generate-icons.js` لنسخ الأيقونات إلى `public/icons/` وfavicon. |
| `npm run dev` | ينفذ hook `predev` ثم `vite`. |
| `npm run build` | ينفذ hook `prebuild` ثم `vite build`. |
| `npm run preview` | ينفذ `vite preview`. |
| `npm ci` | تثبيت اعتماديات الواجهة كما يستخدمه CI؛ لا يوجد وصف مخصص آخر له في المستودع. |
| `cd functions && npm ci` | تثبيت اعتماديات الوظائف كما في workflow. |
| `cd functions && node --check index.js` | فحص صياغة ملف وظائف Firebase كما في workflow. |

لا توجد اختبارات معرفة في `tests/` أو `__tests__/`، ولا script اختبار في `package.json`؛ لذلك الاختبارات: «غير موثّق في المستودع».

## 🌐 النشر

- `vercel.json` يوجه كل المسارات غير `api/` إلى `/index.html`، ويضبط `api/send-fcm.js` بحد أقصى 30 ثانية وذاكرة 512 MB (`vercel.json`).
- `firebase.json` يعلن `functions/` كمصدر Firebase Functions ويستخدم `firestore.rules` لقواعد Firestore (`firebase.json`).
- CI يعمل عند push وpull request إلى `main`، وبطلب يدوي، ويبني الواجهة ويفحص صياغة الوظيفة (`.github/workflows/ci.yml`).
- لا يحتوي المستودع على رابط `vercel.app` أو `netlify.app` أو `firebaseapp.com` منشور يمكن اعتماده؛ رابط Demo أو live: **غير موثّق في المستودع**.
- أمر نشر رسمي أو إعداد مشروع Vercel/Firebase محدد: **غير موثّق في المستودع**.

### تدفق الإشعارات في الخادم

`POST /api/send-fcm` يتحقق من Bearer Firebase ID token ومن مستند `Admins/{uid}`، ثم يرسل إلى topic أو إلى أجهزة `users/{uid}/devices` ويسجل التسليم في `notification_deliveries` (`api/send-fcm.js`).

يوجد أيضاً trigger باسم `dispatchNotificationRequest` عند إنشاء `notification_requests/{requestId}` (`functions/index.js`). وجود هذه الوظيفة مثبت، أما استخدامها في النشر الحالي: «غير موثّق في المستودع».

## 🔒 الأمان

- المصادقة عبر `signInWithEmailAndPassword`، والتحقق من مستند `Admins/{UID}` قبل تثبيت جلسة المدير (`src/contexts/AuthContext.jsx`).
- المسارات الإدارية ملفوفة بـ`ProtectedRoute`، وأي حساب لا يثبت كمدير تُنهى جلسته (`src/App.jsx`, `src/components/ProtectedRoute.jsx`).
- قواعد Firestore تفصل بين المدير والمستخدم المالك، وتقيّد القراءة والكتابة حسب UID (`firestore.rules`).
- إنشاء مستند المدير الذاتي يشترط تطابق UID، وتفرض قواعد التسجيل التجريبي `trial_days` بين 0 و30 وتاريخاً ضمن 30 يوماً (`firestore.rules`).
- المستخدم يحدّث حقولاً غير حساسة محددة فقط؛ تظل حالة التفعيل وحالة التجربة وتواريخ الاشتراك للمدير (`firestore.rules`).
- دفعات `networks/{userId}/payments` يكتبها المدير فقط، بينما القراءة للمدير أو مالك الحساب (`firestore.rules`).
- API الإشعارات يرفض HTTP غير `POST`، ويتحقق من التوكن، ويتحقق من عضوية `Admins` قبل الإرسال (`api/send-fcm.js`).
- مفاتيح Service Account ليست في المصدر؛ `.gitignore` يستثني ملفات service account و`.env` (`.gitignore`, `api/send-fcm.js`).
- لا يوجد middleware مستقل أو طبقة RLS أو ملف سياسة خصوصية في الشجرة المفحوصة؛ هذه الآليات: «غير موثّق في المستودع».
- لا توجد آلية rate limiting أو اختبارات أمنية ظاهرة في المصدر؛ «غير موثّق في المستودع».

## 📄 الترخيص

لم يُعثر على ملف `LICENSE` أو `LICENSE.*` أو `COPYING*` في المستودع.
نوع الترخيص وحقوق النشر: **غير موثّق في المستودع**.
