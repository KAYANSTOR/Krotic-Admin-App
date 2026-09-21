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

## الهيكل

- `src/pages` – صفحات اللوحة
- `src/components` – المكونات المشتركة
- `src/contexts` – سياق المصادقة
- `src/firebase.js` – إعداد Firebase (يعتمد فقط على متغيرات البيئة)

---

تم فصل المشروع بالكامل عن أي مشروع Firebase سابق.
