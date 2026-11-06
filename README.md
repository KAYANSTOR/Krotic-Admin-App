# Krotic Admin App

لوحة إدارة كروتك وواجهة API الخادمية (Vercel Functions) فوق Firebase (`kroty-434e3`).

- خط الأساس والقرارات والعقود: [`docs/BASELINE_AR.md`](docs/BASELINE_AR.md)
- خطة العمل: [`docs/PLAN_AR.md`](docs/PLAN_AR.md)
- مخططات العقود: [`contracts/schemas`](contracts/schemas)

## التشغيل المحلي
```bash
npm ci
cp .env.example .env.local   # عبّئ القيم
npm run dev
```

## الفحوص
```bash
npm test                     # اختبارات الوحدة والعقود
npm run build
npm run test:rules:static
npm run test:rules           # يتطلب Java (محاكي Firestore)
npm run test:whatsapp-emulator
```

## النشر
- الدفع إلى `main` ينشر تلقائيًا على Vercel (مشروع `krotak-pro`).
- قواعد Firestore: `firebase deploy --only firestore:rules,firestore:indexes --project kroty-434e3`.
