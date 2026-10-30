# نتائج Firestore Emulator — اختبارات WhatsApp

**الفرع:** `تكامل-مزايا-المدفوعة`  
**التاريخ:** 2026-10-30  
**الأمر:** `firebase emulators:exec --project demo-krotic-local --only firestore "node --test test/whatsappEmulator.integration.test.js"`

## النتائج الفعلية (ليست skip)

| # | الاختبار | النتيجة |
|---|---|---|
| 1 | عاملان ينشئان نفس عملية التسليم | ✅ pass |
| 2 | عاملان ينفّذان SMS لنفس العملية | ✅ pass |
| 3 | Webhook delivered بالتزامن مع SMS | ✅ pass |
| 4 | انتهاء القفل وإعادة الاستحواذ | ✅ pass |
| 5 | استعادة بعد تعطل بعد قبول المزود | ✅ pass |
| 6 | منع مهمة طابور مكررة | ✅ pass |
| 7 | عزل شبكتين | ✅ pass |

**الإجمالي: 7/7 pass، 0 fail، 0 skip**

## إصلاح ظهر أثناء التشغيل

`complete_after_crash` كان يُحجب بقفل claim نشط. أُصلح بفحص `smsProviderAcceptedAtMs` **قبل** فحص القفل (Commit `29a738e`).

## Idempotency — فصل واضح

| الطبقة | الحالة |
|---|---|
| مفتاح Krotak `krotak-wa-sms:{deliveryOperationId}` | منفَّذ |
| دعم المزود لنفس المفتاح | **غير مختبر** — لا مزود حقيقي |
| ضمان الناقل exactly-once | **غير مضمون** دون مزود يدعم Idempotency |

## smsOutcomeUnknown

- يمنع إعادة الإرسال التلقائي
- يحتفظ بالسبب في `smsOutcomeUnknownReason`
- **لا واجهة مراجعة إدارية بعد** — متطلب لاحق

## ما يمنع التكامل الخارجي

1. موقظ مهلة 10ث
2. مزود SMS + اختبار idempotency عنده
3. أسرار Meta في Vercel
4. المرحلة 0 غير مكتملة
