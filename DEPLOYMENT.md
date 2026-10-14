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
| `KROTAK_HMAC_SECRET` | سرّ HMAC للتحقق من `x-verification-receipt` في `/api/sales/ingest` | نعم لمسار الاستقبال |
| `CRON_SECRET` | سرّ حماية Vercel Cron لـ `/api/dispatch-notifications` | نعم |
| `FCM_DEFAULT_TOPIC` | موضوع FCM الافتراضي (اختياري، القيمة الافتراضية `krotak_all_users`) | لا |
| `FCM_ANDROID_CHANNEL_ID` | قناة أندرويد للإشعارات (اختياري) | لا |

**تُدار الأسرار حصراً في Vercel Project → Settings → Environment Variables** (قرار ط2). لا تُوضع في Git مطلقاً.

## 2. البنية الخادمية المعتمدة

- **مرجع الإشعارات المجدولة الوحيد:** Vercel Cron عبر `vercel.json` (`/api/dispatch-notifications`, مؤمَّن بـ `CRON_SECRET`). أُزيلت الدالة المجدولة المكررة من `functions/`.
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

## 6. ملاحظات المهاجرة (مؤجلة، قرار ي)

- تصنيف الحسابات القديمة (تجريبي/رسمي) وإعادة بناء `admin_aggregates` والرصيد التراكمي للشبكات القديمة خطوة لاحقة restartable، ولا تُشغَّل تلقائياً.
- المبيعات القديمة (قبل الاستقبال الخادمي) تُعرض «غير متحقق» ولا تُحتسب ضمن العمولة حتى تصالحها.
