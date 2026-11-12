# تسليم WhatsApp وSMS البديل — جانب خادم كروتك وتقرير الإدارة (المرحلة 3)

المرجع: العقد `contracts/whatsapp-delivery-v1.md` وخطة Krotak-Pro (الأقسام 4.1–4.4 و12).

## ما يفعله خادم كروتك (Vercel)

| المسار | الوظيفة | التوثيق |
|---|---|---|
| `POST /api/whatsapp/messages/send` | ينشئ سجل `networks/{networkId}/wa_deliveries/{deliveryOperationId}` ثم يرسل عبر Railway بمهلة إيصال 10 ثوانٍ | مالك + ميزة `whatsapp_card_delivery` |
| `GET /api/whatsapp/deliveries/status?ids=` | حالة حتى 50 عملية + حسم احتياطي عند صمت Railway | مالك فقط |
| `POST /api/whatsapp/deliveries/sms-result` | بلاغ نتيجة SMS البديل (idempotent لكل محاولة) | مالك فقط |
| `GET /api/whatsapp/deliveries/pending-fallback` | أوامر SMS بديل لم تُنفذ (للاستعادة بعد الإقلاع/عودة الإنترنت) | مالك فقط |
| `POST /api/whatsapp/delivery-events` | أحداث Railway الموقعة (HMAC) | `WHATSAPP_INBOUND_SECRET` |
| `GET /api/admin/whatsapp-deliveries` | تقرير الإدارة §4.4 | مستند `Admins/{uid}` |

- دلالات الإيصالات: `server_ack` (علامة واحدة) **ليس** تسليماً؛ `delivered` (علامتان) يحسم
  WhatsApp؛ `read` معلومة إضافية فقط. الترتيب بـ `seq` من Railway وحالة WhatsApp لا تتراجع.
- الحسم ذري (`runTransaction`): أول قرار يفوز؛ إيصال بعد قرار SMS يُسجَّل `lateDelivery` ولا يغير
  النتيجة؛ SMS بعد `delivered` يُسجَّل `smsAfterDelivered` ولا يُخفى. لا يُصرف كرت ثانٍ أبداً
  (`card_mismatch`).
- لا متغيرات بيئة جديدة: `WHATSAPP_GATEWAY_URL` و`WHATSAPP_GATEWAY_SERVICE_TOKEN` و`WHATSAPP_INBOUND_SECRET` القائمة.

## صفحة الإدارة

`/whatsapp-deliveries` (الشريط الجانبي ← العمليات ← «تقرير تسليم WhatsApp»): فلاتر الشبكة والحالة
والتاريخ، ملخص بالنتيجة النهائية والحالات، وبطاقة لكل عملية فيها: رقم العملية، الطلب/البيع، العميل،
الرقم، الكرت المرتبط، القناة الأولى، القالب، وقت الإرسال، علامة واحدة، علامتا التسليم، القراءة (مع
الفارق بالثواني)، انتهاء المهلة، سبب التحويل إلى SMS ومن قرره، حالة SMS ووقته، عدد المحاولات، آخر خطأ،
معرّف رسالة WhatsApp، والنتيجة النهائية، مع تنبيهات ظاهرة للتسليم المتأخر وSMS بعد التسليم وفشل SMS.
لا يُعرض نص الرسالة ولا يُخزَّن.

## النشر المطلوب

```
firebase deploy --only firestore:rules,firestore:indexes
```
بدون الفهارس يعيد التقرير `503 delivery_index_missing` (رسالة عربية واضحة في الصفحة).

## ما اختُبر

- `npm test` — كل ملفات `test/*.test.js`، منها:
  - `test/whatsappDeliveries.test.js`: سيناريوهات §12 (علامتان خلال 10 ثوانٍ، علامة واحدة ثم المهلة،
    إيصال أثناء الـ fallback بتداخل قسري للمعاملات، SMS بعد التسليم، بلاغ متأخر بعد عودة الإنترنت،
    صمت Railway، توافق الطلبات القديمة، التعارضات، رسائل بلا كرت، HMAC/seq للأحداث، تقرير الإدارة).
  - `test/whatsappDeliveryReport.test.js`: تسميات كل الحالات/الأسباب وحقول §4.4.
- `npm run test:rules` (محاكي Firestore، JDK 21): قراءة `wa_deliveries` للمدير ومالك الشبكة فقط،
  ومنع الكتابة من العميل.
- `npm run lint` و`vite build`.

## ما لم يُختبر هنا

- إيصالات WhatsApp حقيقية من هاتف فعلي وجلسة Baileys حية (يتطلب رقماً مربوطاً).
- نشر الفهارس والقواعد على مشروع Firebase الإنتاجي، ووصول أحداث Railway الموقعة إلى Vercel فعلياً.
- عرض الصفحة في متصفح على بيانات إنتاج (اختُبر البناء والمنطق فقط).
