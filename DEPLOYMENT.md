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

**تُدار الأسرار حصراً في Vercel Project → Settings → Environment Variables** (قرار ط2). لا تُوضع في Git مطلقاً.

## 2. البنية الخادمية المعتمدة

- **المجدولات اليومية:** Vercel Cron عبر `vercel.json` لـ`/api/dispatch-notifications` و`/api/whatsapp/delivery/dispatch`. كلتاهما يوميتان؛ لا تحققان مهلة تأكيد WhatsApp لعشر ثوانٍ ولا تعدان بجدولة فورية. لا تُستخدمان كبديل لخدمة WhatsApp دائمة.
- **الإشعار الفوري:** Cloud Function `dispatchNotificationRequest` (عند إنشاء طلب) — غير مجدولة.
- **المصدر المالي الوحيد:** الرصيد التراكمي على مستند `networks/{networkId}`:
  `totalSalesAmount`, `totalCommissionDue`, `totalPaidAmount`, `outstandingBalance`.
- **الكتابة المالية والتسوية:** خادمية فقط (`/api/record-payment`, `/api/settlement`, `/api/sales/ingest`)؛ قواعد Firestore تمنع العميل.
- **الوصول والتجربة:** خادمي فقط (`/api/networks`)، والقواعد تمنع كتابة العميل على حقول الصلاحية.

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
2. **مفتاح الشبكة:** `POST /api/networks` مع `action=provision` ينشئ مفتاحًا خاصًا بالشبكة ويحفظ envelope مشفرًا (`networkSecretEncrypted`) بـ AES-256-GCM. بعد مصادقة العميل، يستدعي التطبيق `POST /api/network-secret` لاسترداد المفتاح عبر Firebase ID Token. يخزنه التطبيق في Android Keystore ولا يسجله أو يكتبه في Firestore/الـ APK.
3. **Cron:** `vercel.json` يعرّف مجدول `/api/dispatch-notifications` اليومي ومجدول `/api/whatsapp/delivery/dispatch` للاسترداد اليومي. لا يوفر Cron مهلة استجابة WhatsApp لعشر ثوانٍ؛ مسار الإشعارات محمي بـ`CRON_SECRET`، وبوابة WhatsApp بسر الخدمة الخاص بها.
4. **أعِد النشر (Redeploy)** بعد ضبط المتغيّرات، ثم تحقّق:
   - دخول اللوحة يعمل.
   - إرسال إشعار (اختبار) يعمل.
   - اعتماد تسوية/تسجيل دفعة يعمل ويحدّث الرصيد.

### ج) المهاجرة (تُشغَّل يدويًا بعد الموافقة فقط)
بعد ضبط الخادم، استدعِ `POST /api/migrate` برمز مدير موثّق:
1. `{ "action": "classify-users", "limit": 100 }` ثم أعد الاستدعاء بـ`nextCursor` حتى `done: true`.
2. `{ "action": "rebuild-all", "limit": 50 }` ثم أعد الاستدعاء بـ`nextCursor` حتى `done: true` (يعيد بناء أرصدة الشبكات و`admin_aggregates`).


## 8. واجهات WhatsApp الخادمية (فرع المزايا)

قبل تفعيل WhatsApp على Vercel، راجع [خطة تنفيذ واجهات WhatsApp](docs/WHATSAPP_API_IMPLEMENTATION_AR.md). أضف `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`, و`WHATSAPP_SECRETS_KEK` كمتغيرات server-only في كل بيئة مطلوبة. لا تضعها في `VITE_*` أو ملف `.env` منشور. اربط Meta Webhook على `/api/whatsapp/meta/webhook`، ثم انشر `firestore.rules` التي تمنع وصول العميل إلى `whatsapp_message_requests`.

الإرسال الحي لـ Cloud API يظل معطلاً حتى اعتماد اختبار Meta؛ لا تضبط `WHATSAPP_LIVE_SEND=1` قبل ذلك. QR معطل افتراضياً ويحتاج خدمة Node دائمة خارج Vercel، عنوان `WHATSAPP_GATEWAY_URL` ورمز `WHATSAPP_GATEWAY_SERVICE_TOKEN`، وPoC ناجح لإعادة التشغيل والعزل وإرسال رسالة. لا تضبط `WHATSAPP_GATEWAY_ENABLED=true` قبل نشر/اختبار الخدمة. المسارات على Vercel مجرد واجهة وسيطة وليست محرك جلسة.

تحقق أولاً على Preview: تبادل رمز Meta تجريبي، تحقق Webhook، استجابة QR من الخدمة الدائمة، اختبار `deliveryId` المكرر، قواعد Firestore، ثم بناء الواجهة. هذه الإضافة لا تنشر المشروع ولا تغير أسرار/إعدادات Vercel تلقائياً.
