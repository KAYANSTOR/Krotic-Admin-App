# تشغيل الإشعارات الحية (FCM عبر Vercel)

إرسال الإشعارات يعمل الآن مباشرة من لوحة التحكم عبر **Vercel Serverless Function**
داخل نفس المشروع ونفس الرابط — بدون Cloud Functions وبدون أي خادم إضافي.

## كيف تعمل المنظومة؟

```text
لوحة التحكم (/notifications)
        │  POST /api/send-fcm  +  Firebase ID Token للمدير
        ▼
api/send-fcm.js  (Vercel Function)
        │  1) يتحقق من صحة التوكن
        │  2) يتأكد أن المستخدم موجود في مجموعة Admins
        │  3) يرسل عبر FCM:
        │       • إشعار عام → Topic (افتراضياً krotak_all_users)
        │       • مستخدم محدد → أجهزته المسجلة في users/{uid}/devices
        ▼
Firebase Cloud Messaging ──► أجهزة الأندرويد
        │
        └─ يُسجَّل الإرسال في notification_deliveries (سجل تدقيقي)
```

## الإعداد المطلوب (مرة واحدة فقط)

مفتاح الخدمة **لا يوضع في الكود ولا في GitHub أبداً** (المستودع عام). أضِفه في:

Vercel → مشروع krotak-pro → Settings → Environment Variables

| المتغير | القيمة |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | محتوى ملف Service Account JSON كاملاً، أو صيغة base64 للنص نفسه |

للحصول على الملف: Firebase Console → ⚙️ Project settings → Service accounts → **Generate new private key**.

متغيرات اختيارية:

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `FCM_DEFAULT_TOPIC` | `krotak_all_users` | قناة الإشعارات العامة |
| `FCM_ANDROID_CHANNEL_ID` | `krotak_admin` | قناة إشعارات أندرويد |

## مهم لتطبيق الأندرويد

حتى تصل الإشعارات، يجب أن يشترك التطبيق في نفس القناة:

```dart
await FirebaseMessaging.instance.subscribeToTopic('krotak_all_users');
```

ويُفضَّل تعريف قناة أندرويد باسم `krotak_admin` لعرض الإشعارات بالشكل الصحيح.

## استجابات الدالة

| الحالة | المعنى |
| --- | --- |
| `200` + `success: true` | تم الإرسال (يعرض عدد النجاح/الفشل) |
| `200` + `no_devices` | المستخدم المحدد لا يملك أجهزة مسجلة |
| `400` + `title_and_body_required` | العنوان أو النص فارغ |
| `401` + `missing_token` / `invalid_token` | التوكن مفقود أو غير صالح |
| `403` + `not_admin` | المستخدم ليس مديراً |
| `503` + `server_not_configured` | متغير FIREBASE_SERVICE_ACCOUNT غير مضبوط |
| `500` + `send_failed` | فشل الإرسال عبر FCM |

## ملاحظات

- Cloud Function القديمة في `functions/` لم تعد مستخدمة (تبقى كمرجع فقط).
- لم تعد الصفحة تكتب في `notification_requests` — الإرسال مباشر الآن.
- لا تضع أي مفتاح Service Account داخل `src/` أو `.env` الخاص بالواجهة.
