# Krotak Pro Admin

لوحة التحكم الإدارية لتطبيق **Krotak Pro**.

## المتطلبات

- Node.js 18+
- مشروع Firebase جديد (Authentication + Firestore)

## الإعداد السريع

1. انسخ ملف البيئة:
```bash
cp .env.example .env
```

2. افتح `.env` وأدخل بيانات مشروع Firebase الجديد الخاص بك.

3. ثبت الحزم وشغّل المشروع:
```bash
npm install
npm run dev
```

## ربط Firebase جديد

1. أنشئ مشروعاً جديداً في [Firebase Console](https://console.firebase.google.com)
2. فعّل **Authentication** → طريقة Email/Password
3. أنشئ قاعدة بيانات **Firestore**
4. أضف تطبيق Web وانسخ الإعدادات إلى ملف `.env`
5. (اختياري) عدّل قواعد الأمان حسب احتياجاتك

## إصلاح خطأ صلاحيات تسجيل دخول المدير

يجب أن يكون مستند المدير في Firestore بهذا الشكل:

- المسار: `Admins/{Firebase Auth UID}`
- الحقل الإلزامي: `uid` وقيمته هي نفس UID

قواعد الأمان الجاهزة موجودة في `firestore.rules`. لتطبيقها على مشروع Firebase:

```bash
firebase login
firebase use <FIREBASE_PROJECT_ID>
firebase deploy --only firestore:rules
```

إذا كان مستند المدير الحالي يحمل البريد الإلكتروني أو أي قيمة أخرى بدل UID، أنشئ/أعد تسمية المستند إلى `Admins/{UID}` مع إبقاء الحقل `uid` مساويًا للـ UID. لا تضع قواعد Firestore مفتوحة للعامة.

## الهيكل

- `src/pages` – صفحات اللوحة
- `src/components` – المكونات المشتركة
- `src/contexts` – سياق المصادقة
- `src/firebase.js` – إعداد Firebase (يعتمد فقط على متغيرات البيئة)

---

تم فصل المشروع بالكامل عن أي مشروع Firebase سابق.

> مهم: نشر Vercel يحدّث واجهة الموقع فقط، ولا يحدّث قواعد Firestore. يجب تنفيذ أمر `firebase deploy --only firestore:rules` مرة واحدة من جهاز لديه صلاحية مشروع Firebase، ثم إعادة تحميل الموقع.

## إشعارات FCM (عبر Vercel Serverless)
- الإرسال يتم من صفحة `/notifications` عبر `POST /api/send-fcm` (الملف `api/send-fcm.js`).
- يتطلب متغير البيئة `FIREBASE_SERVICE_ACCOUNT` في إعدادات مشروع Vercel — لا يوضع المفتاح في الكود أبداً.
- راجع [notifications-deployment-ar.md](notifications-deployment-ar.md) للتفاصيل الكاملة.
