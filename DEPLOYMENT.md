# دليل النشر والبيئات — Krotak Pro Admin

> مرجع تشغيلي واحد لبيئات النشر والأسرار وبوابة الفحص. لا يحتوي أي قيمة سرية فعلية.

## 1. الأسرار ومتغيرات البيئة

### واجهة الإدارة (Vite — متغيّرات `VITE_*`)
تُقرأ من `.env`/`.env.local` محلياً، ومن إعدادات مشروع Vercel في الإنتاج (انظر `.env.example`):
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`,
`VITE_FIREBASE_MEASUREMENT_ID`.

### دوال الخادم على Vercel (`api/`) — أسرار الخادم فقط
| المتغير | الاستخدام | مطلوب |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | مفتاح خدمة Firebase (JSON أو base64) لتوقيع الطلبات وكتابة Firestore | نعم |
| `KROTAK_HMAC_SECRET` | Master Secret (32 بايت عشوائية على الأقل) لتشفير أسرار HMAC الفردية للشبكات في Firestore؛ لا يوضع في التطبيق | نعم لـ provision وingest |
| `CRON_SECRET` | سرّ حماية Vercel Cron لـ `/api/dispatch-notifications` | نعم |
| `FCM_DEFAULT_TOPIC` | موضوع FCM الافتراضي (اختياري، القيمة الافتراضية `krotak_all_users`) | لا |
| `FCM_ANDROID_CHANNEL_ID` | قناة أندرويد للإشعارات (اختياري) | لا |
| `OTP_HASH_SECRET` | سر عشوائي مستقل (32 بايت على الأقل) لهضم OTP ومعرّفات تحدي/تحديد المعدل | نعم عند تفعيل OTP |
| `META_WHATSAPP_ACCESS_TOKEN` | رمز الوصول الدائم/الخادمي لـWhatsApp Cloud API | نعم عند تفعيل OTP |
| `META_WHATSAPP_PHONE_NUMBER_ID` | معرّف رقم WhatsApp Business المرسل من Meta | نعم عند تفعيل OTP |
| `META_WHATSAPP_TEMPLATE_NAME` | اسم قالب Authentication/Copy Code المعتمد | نعم عند تفعيل OTP |
| `META_WHATSAPP_TEMPLATE_LANGUAGE` | رمز لغة القالب المعتمد، مثل `ar` أو `en_US` | نعم عند تفعيل OTP |
| `META_WHATSAPP_API_VERSION` | نسخة Graph API (الافتراضي `v26.0`) | لا |

**تُدار الأسرار حصراً في Vercel Project → Settings → Environment Variables** (قرار ط2). لا تُوضع في Git مطلقاً.

## 2. البنية الخادمية المعتمدة

- **المجدول اليومي الوحيد:** Vercel Cron عبر `vercel.json` (`/api/dispatch-notifications`, مؤمَّن بـ `CRON_SECRET`). يشغّل فحص الاشتراكات المنتهية ويحوّل المستحقة إلى `LOCKED_EXPIRED` ثم يعالج الإشعارات المجدولة. لا تُضاف مهمة Cron ثانية، ولا تُنشر Cloud Functions للجدولة.
- **الإشعار الفوري:** Cloud Function `dispatchNotificationRequest` (عند إنشاء طلب) — غير مجدولة.
- **المصدر المالي الوحيد:** الرصيد التراكمي على مستند `networks/{networkId}`:
  `totalSalesAmount`, `totalCommissionDue`, `totalPaidAmount`, `outstandingBalance`.
- **الكتابة المالية والتسوية:** خادمية فقط (`/api/record-payment`, `/api/settlement`, `/api/sales/ingest`)؛ قواعد Firestore تمنع العميل.
- للحفاظ على حد Vercel Hobby، يعاد توجيه `/api/record-payment` داخليًا إلى وظيفة `/api/settlement` عبر `vercel.json`. يظل عنوان الطلب وطريقته وبياناته واستجابته متوافقة؛ لا يلزم تحديث تطبيق Android.
- يُعاد توجيه `/api/request-otp` و`/api/verify-otp` داخليًا إلى وظيفة `/api/manage-user-auth`؛ لا تضاف وظائف Vercel جديدة. تُخزّن قيمة OTP كتجزئة HMAC لمدة 5 دقائق فقط، ويُستهلك الرمز بعد تحقق ناجح، مع 5 محاولات كحد أقصى ومحدد معدل لإعادة الإرسال. لا تُكتب قيمة OTP أو رقم الهاتف بنص صريح في مجموعة `auth_otps`.
- **الوصول والتجربة:** خادمي فقط (`/api/networks`)، والقواعد تمنع كتابة العميل على حقول الصلاحية.

### WhatsApp OTP (Meta Cloud API)

- `POST /api/request-otp` يستقبل `{ "phoneNumber": "+967..." }`. يعيد دائمًا ردًا عامًا عند الرقم المسجل أو غير المسجل لتقليل كشف الحسابات. الرمز صالح 5 دقائق، ولا يُرسل إلا لحساب عميل قائم ومفعّل.
- `POST /api/verify-otp` يستقبل `{ "phoneNumber": "+967...", "otp": "123456" }`. عند النجاح يعيد `{ "success": true, "customToken": "...", "uid": "..." }`. على Flutter استخدام `FirebaseAuth.instance.signInWithCustomToken(customToken)`؛ يجب إرسال OTP كنص حتى لا تضيع الأصفار في البداية.
- يربط الخادم الرقم بـUID المسجل في `network_registration_phone_index`، مع بحث فريد احتياطي في `users.phone`. **لا يُستخدم رقم الهاتف كـUID** ولا يُنشأ حساب جديد في هذا المسار.
- أنشئ في Meta قالب **Authentication / Copy Code** معتمدًا، واختر اللغة نفسها المحددة في `META_WHATSAPP_TEMPLATE_LANGUAGE`، واجعل انتهاء القالب 5 دقائق ليطابق تحقق الخادم. يلزم إعداد WhatsApp Business Account ورقم إرسال وaccess token خادمي.
- لا يُعدّل هذا التغيير تطبيق Flutter/Android. بعد إعداد بيانات Meta، اختبر إرسال رمز على حساب حقيقي، ثم يدمج فريق Flutter استدعاء المسارين وتسجيل الدخول بالـcustom token.

## 3. بوابة الفحص قبل النشر (Deploy Gate)

يُمنع أي نشر قبل نجاح الفحوص الآتية (تُشغَّل في CI عبر `.github/workflows/ci.yml`):

```bash
npm ci
npm test                    # اختبارات الوحدات + القواعد الثابتة
npm run test:rules:static   # ثوابت أمان القواعد (بدون Java)
npm run test:rules          # اختبارات محاكي قواعد Firestore (يحتاج Java)
npm run build               # بناء الواجهة
cd functions && npm ci && npm test && node --check index.js
```

- **فحص ثابت للقواعد:** `npm run test:rules:static` يتحقق من: لا مشرف مضمّن، حقول الصلاحية مقفلة، والكتابة الخادمية مغلقة على التسويات/الدفعات/الإعدادات.
- لا يُنشر `firestore.rules` أو `functions/` أو الواجهة إلا بعد نجاح كل ما سبق.

## 4. مشروع Firebase

- قواعد Firestore: `firestore.rules` (نشر: `firebase deploy --only firestore:rules`).
- الفهارس: `firestore.indexes.json`.
- الوظائف: `firebase deploy --only functions`.
- بيئة اختبار محلية: `npm run emulators` + `VITE_USE_FIREBASE_EMULATORS=true` (انظر `README.md`).

## 5. نموذج الإدارة (قرار و)

- كل سلطة الإدارة من العضوية في مجموعة `Admins/{uid}` فقط (مع `data.uid == request.auth.uid`).
- **أُزيل** البايباس المضمّن `isPrimaryAdmin()` من القواعد.
- أول مدير يُنشأ خارج النطاق (out-of-band) بمفاتيح موثوقة؛ بقية المدراء يُنشأون من اللوحة.

## 7. خطوات التفعيل (ماذا تفعل في Firebase وVercel)

### أ) Firebase Console
1. **Firestore Rules:** انسخ محتوى `firestore.rules` والصقه في Console → Firestore → Rules، أو انشر بالأمر:
   ```bash
   firebase deploy --only firestore:rules
   ```
   القواعد الجديدة تمنع كتابة العميل على حقول الصلاحية/التسويات/الدفعات/`app_settings`/`Admins`، وتزيل المشرف المضمّن.
2. **Firestore Indexes:** انشر الفهارس: `firebase deploy --only firestore:indexes` (يحتوي `firestore.indexes.json`).
3. **Authentication:** تأكد من تفعيل **Email/Password**. أنشئ أول مدير يدويًا (Out-of-band): Add user بالبريد/كلمة المرور، ثم أنشئ مستندًا في مجموعة `Admins` بمعرّف = UID الحساب مع الحقول `{ uid, name, email, phone, createdAt }`. بعدها تُدار بقية المدراء من اللوحة عبر `/api/admins`.
4. **Cloud Functions:** انشر الوظائف (اختياري حسب الباقة):
   ```bash
   firebase deploy --only functions
   ```
   لاحظ أن الإشعارات المجدولة تعمل عبر **Vercel Cron** لا عبر الدوال (أُزيلت الدالة المكررة).

### ب) Vercel (المشروع المرتبط)
1. **متغيّرات البيئة** (Settings → Environment Variables) لكل البيئات (Production/Preview):
   - `VITE_FIREBASE_*` (إعدادات الويب من Firebase Console → Project settings → Web app).
   - `FIREBASE_SERVICE_ACCOUNT` = محتوى ملف Service Account JSON كاملًا أو base64 له.
   - `KROTAK_HMAC_SECRET` = Master Secret عشوائي طويل (32 بايت على الأقل) لتشفير `networkSecret` لكل شبكة. لا يُضمّن في APK ولا يُرسل للعميل.
   - `CRON_SECRET` = سرّ عشوائي لحماية `/api/dispatch-notifications`.
   - لاختبار OTP: أنشئ `OTP_HASH_SECRET` مستقلاً (32 بايت على الأقل، مثل ناتج `openssl rand -base64 48`) وبيانات `META_WHATSAPP_*` أعلاه في Vercel Production/Preview. يجب أن يكون اسم القالب ولغته مطابقين لقالب Authentication/Copy Code الذي اعتمدته Meta. لا تضع أي رمز وصول في Git أو تطبيق Flutter.
   - فعّل سياسة Firestore TTL على الحقل `expiresAt` لمجموعة `auth_otps` وعلى الحقل نفسه في `auth_otp_rate_limits` للتنظيف التلقائي؛ التحقق من الانتهاء يتم خادميًا حتى قبل حذف TTL.
2. **مفتاح الشبكة:** `POST /api/networks` مع `action=provision` ينشئ مفتاحًا خاصًا بالشبكة ويحفظ envelope مشفرًا (`networkSecretEncrypted`) بـ AES-256-GCM. بعد مصادقة العميل، يستدعي التطبيق `POST /api/network-secret` لاسترداد المفتاح عبر Firebase ID Token. يخزنه التطبيق في Android Keystore ولا يسجله أو يكتبه في Firestore/الـ APK.
3. **Cron:** `vercel.json` يعرّف مهمة يومية واحدة لـ `/api/dispatch-notifications`. مع `CRON_SECRET` صحيح، تنفّذ فحص الانتهاء ثم إرسال الإشعارات؛ استدعاء المدير اليدوي يرسل الإشعارات فقط.
4. **أعِد النشر (Redeploy)** بعد ضبط المتغيّرات، ثم تحقّق:
   - دخول اللوحة يعمل.
   - إرسال إشعار (اختبار) يعمل.
   - اعتماد تسوية/تسجيل دفعة يعمل ويحدّث الرصيد.
   - بعد إضافة بيانات Meta فقط، جرّب OTP على حساب عميل موجود، ثم تحقق من أن Flutter يسجّل الدخول عبر `signInWithCustomToken`.

### ج) المهاجرة (تُشغَّل يدويًا بعد الموافقة فقط)
بعد ضبط الخادم، استدعِ `POST /api/migrate` برمز مدير موثّق:
1. `{ "action": "classify-users", "limit": 100 }` ثم أعد الاستدعاء بـ`nextCursor` حتى `done: true`.
2. `{ "action": "rebuild-all", "limit": 50 }` ثم أعد الاستدعاء بـ`nextCursor` حتى `done: true` (يعيد بناء أرصدة الشبكات و`admin_aggregates`).
