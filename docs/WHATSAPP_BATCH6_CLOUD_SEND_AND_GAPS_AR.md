# الدفعة 6 — طبقة إرسال Cloud API والفجوات

**الفرع:** `تكامل-مزايا-المدفوعة`

## ما أصبح جاهزاً في الكود

### WhatsApp Cloud API
- `metaCloudSend.js`: بناء الحمولة، تصنيف أخطاء Meta، فك التوكن المشفّر لكل شبكة
- `sendOrchestration.js`: ربط `providerMessageId` بعملية التسليم + `markSentAndEnqueueDeadline`
- الإرسال الحي **معطّل افتراضياً** (`live_send_disabled`) ما لم:
  - `WHATSAPP_LIVE_SEND=1`، أو
  - حقن `fetch` في الاختبارات
- لا تسجيل للتوكن في السجلات

### SMS
- لا يوجد محرك إرسال بطاقة في المستودع
- `smsAdapterContract.js` يوثّق المطلوب صراحةً
- `smsOutcomeUnknown` + واجهة مراجعة بدون زر إعادة إرسال

### واجهة المراجعة
- API: `POST /api/whatsapp/unknown-outcomes` — list | acknowledge | mark_resolved
- صفحة: `/whatsapp-unknown-outcomes`

### الموقظ
- `WHATSAPP_CONFIRMATION_WINDOW_MS = 10000` لم يتغير
- الطابور يسجّل `runAfterMs`؛ التنفيذ عند استدعاء dispatch فقط
- **لا ضمان للثانية العاشرة** بدون موقظ خارجي موثوق (ليس Vercel Hobby Cron كضمان)

## ما يمنع الاختبار التشغيلي

1. موافقة صريحة على `WHATSAPP_LIVE_SEND` + توكنات Meta حقيقية لكل شبكة
2. اختيار مزود SMS + تنفيذ adapter + بيانات اعتماد
3. موقظ (Cloud Scheduler / عامل خارجي) يستدعي dispatch بسر الخدمة
4. فهرس Firestore اختياري: `smsOutcomeUnknown` (+ networkId)

## اختبارات الدفعة

`test/whatsappBatch6Send.test.js` — تصنيف أخطاء، dry-run، fetch محقون، idempotent send، عقد SMS، مراجعة unknown.
