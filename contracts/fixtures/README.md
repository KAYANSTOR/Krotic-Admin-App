# Contract fixtures — بيانات اصطناعية فقط

> **كل ملف في هذا المجلد بيانات اختبار اصطناعية غير إنتاجية.** لا تحتوي بيانات عميل أو أسراراً. المخططات والاختبارات تُشغَّل عبر `test/contracts.test.js`.

| الملف | العقد | الغرض |
|---|---|---|
| `wallet.sample.json` | `wallet.schema.json` | محفظة كمصدر رسائل فقط، بلا أرصدة. |
| `inbound-template.sample.json` | `inbound-template.schema.json` | قالب تحليل تحويل وارد مربوط بمحفظة. |
| `outbound-template.sample.json` | `outbound-template.schema.json` | قالب رسالة صادرة. |
| `template-release.sample.json` | `template-release.schema.json` | حمولة إصدار مركزي كاملة. |
| `template-center-ack-request.sample.json` | `template-center-ack-request.schema.json` | طلب Android إلى Vercel؛ لا يرسل uid أو network_id. |
| `template-ack.sample.json` | `template-ack.schema.json` | وثيقة latest-only يكتبها Vercel تحت users/{uid}/template_acks/{deviceId}. |
| `android-application-state.sample.json` | `android-application-state.schema.json` | حالة تطبيق مشتقة من ACK موثوق. |
| `account-features.sample.json` | `account-features.schema.json` | خريطة مفاتيح account_features فقط. |
| `account-features-catalog.sample.json` | `account-features-catalog.schema.json` | الكتالوج المغلق افتراضياً بمفاتيح المزايا الأربعة. |
| `android-default-catalog-v1.json` | `default-template-catalog.schema.json` | كتالوج الاختبار المضمن في Android. |
| `inventory-snapshot.sample.json` | `inventory-snapshot.schema.json` | ملخص أعداد مخزون الكروت من Android؛ أعداد فقط بلا أسرار. |
