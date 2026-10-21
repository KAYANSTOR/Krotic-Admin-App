# Contract fixtures — بيانات اصطناعية فقط

> **كل ملف في هذا المجلد بيانات اختبار اصطناعية غير إنتاجية.** لا تحمل أي بيانات
> عميل حقيقي، ولا أي سر، ولا مفاتيح، ولا محتوى رسائل حقيقي. لا يجوز استخدامها
> للإشارة إلى أن عنصرًا «مزروع سابقًا» في بيئة حقيقية.

| الملف | العقد | الغرض |
|---|---|---|
| `wallet.sample.json` | `wallet.schema.json` | محفظة كمصدر رسائل (SMS). |
| `inbound-template.sample.json` | `inbound-template.schema.json` | قالب تحليل تحويل وارد مربوط بمحفظة. |
| `outbound-template.sample.json` | `outbound-template.schema.json` | قالب رسالة صادرة. |
| `template-release.sample.json` | `template-release.schema.json` | حمولة إصدار مركزي كاملة. |
| `android-ack.applied.json` | `android-ack.schema.json` | ACK تطبيق كامل (proposal). |
| `android-ack.conflict.json` | `android-ack.schema.json` | ACK تطبيق جزئي مع تعارضات. |
| `android-ack.failed.json` | `android-ack.schema.json` | ACK فشل تطبيق. |
| `android-application-state.sample.json` | `android-application-state.schema.json` | حالة «مطبَّق محليًا» بإثبات ACK. |
| `feature-entitlements.sample.json` | `feature-entitlements.schema.json` | خريطة ميزات مدفوعة. |

تُشغَّل هذه الملفات مقابل المخططات في `test/contracts.test.js`.
