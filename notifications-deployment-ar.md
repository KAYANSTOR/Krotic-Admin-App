# تشغيل الإشعارات الحية

صفحة `/notifications` تضع طلبًا في:

```text
notification_requests/{requestId}
```

وتقوم Cloud Function `dispatchNotificationRequest` بإرسال الطلب عبر FCM.

## التحقق قبل النشر

```bash
cd functions
npm install
node --check index.js
cd ..
firebase use <PROJECT_ID>
firebase deploy --only functions:dispatchNotificationRequest,firestore:rules
```

لا تضع Service Account أو أي مفتاح Admin في Vite أو `.env` الخاص بالمتصفح. صلاحيات الإرسال موجودة فقط في بيئة Cloud Functions.

حالات الطلب:

- `queued`: أُنشئ الطلب وينتظر الوظيفة.
- `sent`: تم الإرسال.
- `partial`: نجح بعض المستلمين وفشل بعضهم.
- `no_devices`: لا توجد أجهزة مسجلة للمستخدم.
- `failed`: وقع خطأ في خدمة FCM.
