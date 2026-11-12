# عقد تسليم WhatsApp وإيصالاته والرجوع إلى SMS — v1

الحالة: **معتمد للتنفيذ** (gateway_agent). المرجع: الأقسام 3 و4 و9 و12 من
`docs/Krotak-Pro-Audit-and-Implementation-Plan.md`.
النسخة المصدرية لهذا العقد: `contracts/whatsapp-delivery-v1.md` في
`KAYANSTOR/Krotic-Admin-App` (فرع العمل)، وهذه نسخة مطابقة في `Krotak-Pro`.

> هذا العقد لا يخترع قناة جديدة. القنوات القائمة فعلاً هي:
> - التطبيق ← خادم كروتك (Vercel) عبر `Authorization: Bearer <Firebase ID token>`
>   (`lib/data/cloud/whatsapp_gateway_client.dart` → `server/apiHandlers/whatsapp-gateway.js`).
> - خادم كروتك ← Railway عبر `Authorization: Bearer <GATEWAY_INTERNAL_TOKEN>`
>   (`server/_lib/whatsappGatewayClient.js`).
> - Railway → خادم كروتك عبر webhook موقّع HMAC
>   (`x-gateway-timestamp` + `x-gateway-signature`) ثم كتابة Firestore
>   (`server/_lib/whatsappInbound.js` → `networks/{networkId}/wa_inbox`).
> - خادم كروتك → التطبيق: **سحب دوري (polling)** — نفس نمط
>   `WhatsappGatewayInboxListener`. لا FCM ولا socket للتطبيق.
>
> v1 يضيف مسارات على هذه القنوات نفسها فقط.

---

## 1. المعرّفات

| المعرّف | من يولّده | الصيغة | المعنى |
|---|---|---|---|
| `deliveryOperationId` | **التطبيق** قبل أي إرسال | `^[A-Za-z0-9_.:-]{8,128}$` | عملية تسليم واحدة = بيع واحد + كرت واحد مصروف + مستلم واحد. ثابت عبر كل إعادة محاولة وعبر fallback. هو أيضاً معرّف مستند Firestore. |
| `operationId` | التطبيق (قديم) | نفس الصيغة | مفتاح منع التكرار القديم في `/messages/send`. في v1 **يجب** أن يساوي `deliveryOperationId` إن أُرسلا معاً؛ إن أُرسل `operationId` وحده فهو عميل قديم (انظر §8). |
| `messageId` | Baileys/WhatsApp (Railway) | نص (`3EB0…`) | `key.id` لرسالة WhatsApp الوحيدة لهذه العملية. يُربط بالعملية **قبل** إرسال الرسالة (يُولَّد مسبقاً ثم يُرسل بنفس المعرّف). |
| `saleRef` | التطبيق | ≤128 حرف، بلا أسرار | معرّف عملية البيع/الطلب المحلية (مثلاً `sale_id` أو `order_id`). |
| `cardRef` | التطبيق | ≤128 حرف، **ليس رقم الكرت السري** | معرّف الكرت المصروف (`card_id`/serial داخلي). يُستخدم لإثبات أن fallback استخدم نفس الكرت. |
| `orderRef` | التطبيق (اختياري) | ≤128 | رقم الطلب الظاهر للمستخدم إن اختلف عن `saleRef`. |
| `customerRef` | التطبيق (اختياري) | ≤128 | معرّف العميل المحلي. |
| `templateKey` | التطبيق (اختياري) | ≤64 | مفتاح القالب المستخدم في مركز القوالب. |
| `commandId` | خادم كروتك | `${deliveryOperationId}:sms` | أمر fallback الوحيد للعملية (حتمي، واحد لكل عملية). |

قاعدة: التطبيق لا يولّد `deliveryOperationId` جديداً عند إعادة المحاولة أو عند
fallback، ولا يصرف كرتاً جديداً. أي `deliveryOperationId` مكرر يعيد نفس العملية.

لا يُخزَّن **نص الرسالة** (يحتوي رقم الكرت) في Firestore إطلاقاً. نص WhatsApp
يُحفظ مشفراً فقط في Message Store على Railway (لازم لـ Retry Receipt) مع سياسة احتفاظ.
نص SMS يبنيه التطبيق محلياً من نفس الكرت ونفس القالب.

---

## 2. حالات العملية (`state`) — القسم 4.1

| `state` | المعنى | نهائية؟ | الإجراء |
|---|---|---|---|
| `queued` | سُجل الطلب في خادم كروتك ولم يقبل Railway الإرسال بعد | لا | انتظار |
| `waiting_whatsapp_receipt` | قبلت جلسة WhatsApp الإرسال ولدينا `messageId`؛ المهلة تعمل | لا | انتظار علامتي التسليم |
| `delivered` | وصل إيصال تسليم (علامتان) **قبل** حسم المهلة | **نعم** | نجاح WhatsApp — **لا SMS** |
| `sms_fallback_requested` | انتهت المهلة دون علامتين، أو فشل الإرسال قبل القبول | لا | التطبيق يرسل SMS بنفس الكرت |
| `sms_fallback_sent` | أبلغ التطبيق أن SMS أُرسل | **نعم** | تسجيل |
| `sms_fallback_failed` | أبلغ التطبيق أن SMS فشل | لا (قابلة للاستعادة) | التطبيق يعيد المحاولة بنفس الكرت |
| `failed` | لم تنجح أي قناة وتخلّى التطبيق عن العملية، أو لا يمكن fallback | **نعم** | إظهار فشل واضح |
| `delivery_timeout` | انتهت المهلة دون علامتين **وfallback غير مفعّل** لهذه العملية (عميل قديم §8 أو `smsFallback:false`) | **نعم** | لا أمر fallback؛ يظهر في التقرير |

### حالة WhatsApp للرسالة (`whatsappStatus`) — معلومات الإيصالات

| `whatsappStatus` | المصدر الفعلي في Baileys 6.7.24 | علامة WhatsApp |
|---|---|---|
| `pending` | لم يُقبل بعد | — |
| `sent` | `relayMessage` اكتمل وأُعطي `messageId` (قبول الإرسال) | ساعة/لا علامة |
| `server_ack` | عقدة `ack` من الخادم بلا `error` (`CB:ack,class:message`) | علامة واحدة (`one_check`) |
| `delivered` | `messages.update` بـ `update.status = DELIVERY_ACK (3)` — receipt بلا `type` | علامتان رماديتان |
| `read` | `messages.update` بـ `status = READ (4)` أو `PLAYED (5)` | علامتان زرقاوان |
| `error` | `messages.update` بـ `status = ERROR (0)` (ack فيه `error`) أو فشل الإرسال | — |

`whatsappStatus` تصاعدي لا يعود للخلف (`error` لا يلغي `delivered`).
`sent` و`server_ack` **ليسا تسليماً**. `read`/`played` يتضمنان الوصول إلى الجهاز،
لذلك إن وصل `read` قبل `delivered` يُعامل كتسليم (`deliveredAt = readAt`)؛ لكن القراءة
ليست شرطاً.
الإيصال يُربط بالعملية **فقط** عبر `key.id == messageId` وبشرط `key.fromMe == true`؛
إيصالات المجموعات (`message-receipt.update`) لا تخص هذا المسار.

---

## 3. الانتقالات المسموحة — القسم 4.3

```
queued                    -> waiting_whatsapp_receipt   (Railway قبل الإرسال)
queued                    -> sms_fallback_requested     (فشل قبل القبول، fallback مفعّل)
queued                    -> failed                     (فشل قبل القبول، fallback غير مفعّل)
waiting_whatsapp_receipt  -> delivered                  (إيصال تسليم قبل المهلة)
waiting_whatsapp_receipt  -> sms_fallback_requested     (انتهت المهلة؛ أو حسم احتياطي §5.4؛ أو قرار التطبيق دون اتصال §6.4)
waiting_whatsapp_receipt  -> delivery_timeout           (انتهت المهلة؛ fallback غير مفعّل)
sms_fallback_requested    -> sms_fallback_sent
sms_fallback_requested    -> sms_fallback_failed
sms_fallback_failed       -> sms_fallback_sent          (إعادة محاولة SMS ناجحة)
sms_fallback_failed       -> sms_fallback_failed        (محاولة أخرى فاشلة؛ attempts++)
sms_fallback_failed       -> failed                     (تخلّي التطبيق: outcome=abandoned)
sms_fallback_requested    -> failed                     (تخلّي التطبيق: outcome=abandoned)
```

أي انتقال آخر **يُرفض** (409 `invalid_transition`) أو يُسجَّل كمعلومة دون تغيير الحالة.
لا يمكن لعملية أن تصل `delivered` و`sms_fallback_*` معاً. الحسم يتم بـ
**compare-and-set ذري واحد** (§5)، لا بفحصين منفصلين.

### التسليم المتأخر (late delivery)
إيصال `delivered`/`read` يصل والحالة في `sms_fallback_requested|sms_fallback_sent|sms_fallback_failed|failed|delivery_timeout`:
- **لا تتغير `state`** ولا يُرسل أي شيء من أي قناة.
- يُضبط `lateDelivery = { at, whatsappStatus }` وتُحدَّث أوقات الإيصالات.
- `finalOutcome` يبقى كما هو (`sms` أو `none`).

---

## 4. مهلة العشر ثوانٍ — القسم 4.2

- تبدأ عند `acceptedAt` = لحظة اكتمال `relayMessage` بنجاح ووجود `messageId` صالح.
- `receiptDeadlineAt = acceptedAt + receiptTimeoutMs` و`receiptTimeoutMs = 10000` (ثابت في v1؛
  يقبله Railway فقط في المجال 3000–60000 لأغراض الاختبار والتشغيل).
- المؤقت **وحالة العملية** يعيشان في عملية Railway الدائمة (Node أحادي الخيط، نسخة
  واحدة بقفل volume). Vercel serverless لا يملك مؤقتات.
- إيصال `delivered` عند `t <= receiptDeadlineAt` ووصل قبل تنفيذ المؤقت ⇒ `delivered`.
  المؤقت نفذ أولاً ⇒ `sms_fallback_requested` (أو `delivery_timeout`) والإيصال اللاحق = late delivery.
- الحالة تُحفظ على القرص (fsync) **قبل** إعلانها لأي طرف.
- بعد إعادة تشغيل Railway: العمليات في `waiting_whatsapp_receipt` التي تجاوزت
  مهلتها تُحسم فوراً `sms_fallback_requested` بسبب `delivery_timeout_after_restart`؛
  والتي لم تتجاوزها يُعاد ضبط مؤقتها على الزمن المتبقي.

---

## 5. واجهات Railway (خادم كروتك فقط، `Bearer GATEWAY_INTERNAL_TOKEN`)

### 5.1 `POST /messages/send` (موسّعة، متوافقة للخلف)
```json
{
  "networkId": "NET-10001",
  "to": "967771234567",
  "text": "<نص القالب النهائي>",
  "operationId": "dlv-sale-123-card-9",
  "deliveryOperationId": "dlv-sale-123-card-9",
  "receiptTimeoutMs": 10000,
  "smsFallback": true,
  "refs": { "saleRef": "sale-123", "cardRef": "card-9", "orderRef": null, "customerRef": null, "templateKey": "card_delivery" }
}
```
200:
```json
{
  "messageId": "3EB0ABCD...",
  "duplicate": false,
  "delivery": { "...": "RailwayDeliveryView §5.3" }
}
```
- نفس `deliveryOperationId` مرة ثانية ⇒ نفس `messageId` و`duplicate:true` ونفس العملية؛ لا إرسال ثانٍ.
- الأخطاء (قبل القبول، لا رسالة خرجت): `409 not_connected`، `429 rate_limited`،
  `400 invalid_*`، `503 message_store_unavailable` (تعذر حفظ الرسالة قبل الإرسال، فلا إرسال بلا إمكانية Retry Receipt). في هذه الحالات تُسجَّل العملية في Railway بحالة نهائية
  (`sms_fallback_requested` إن `smsFallback:true` وإلا `failed`) بسبب `whatsapp_send_failed:<code>`
  حتى يكون إعادة الطلب بنفس المعرّف حتمياً (يرجع نفس الخطأ مع `delivery`).
- خطأ غامض أثناء `relayMessage` (انقطع الاتصال بعد بدء الإرسال): `502 send_failed` مع
  `delivery.state = sms_fallback_requested` و`fallbackReason = whatsapp_send_failed:relay_error`.
  الرسالة قد تكون خرجت؛ إن وصل إيصال لاحقاً يُسجل late delivery.

### 5.2 `GET /messages/deliveries?networkId=&ids=a,b` (≤50)
يعيد `{ deliveries: [RailwayDeliveryView | {deliveryOperationId, state:"unknown"}] }`.
يستخدمه خادم كروتك للمطابقة (§6.3).

### 5.3 `RailwayDeliveryView`
```json
{
  "deliveryOperationId": "dlv-sale-123-card-9",
  "networkId": "NET-10001",
  "messageId": "3EB0...",
  "state": "waiting_whatsapp_receipt",
  "whatsappStatus": "server_ack",
  "smsFallback": true,
  "receiptTimeoutMs": 10000,
  "createdAt": 1731400000000,
  "acceptedAt": 1731400000400,
  "receiptDeadlineAt": 1731400010400,
  "serverAckAt": 1731400000600,
  "deliveredAt": null,
  "readAt": null,
  "resolvedAt": null,
  "fallbackReason": null,
  "lateDelivery": null,
  "lastError": null,
  "seq": 3,
  "refs": { "saleRef": "sale-123", "cardRef": "card-9" }
}
```
كل الأوقات بالمللي ثانية منذ epoch (UTC). `seq` يزيد مع كل تغيير؛ يُستخدم لترتيب الأحداث.

### 5.4 أحداث Railway → خادم كروتك
`POST {KROTAK_DELIVERY_EVENTS_URL}` = `https://krotak-pro.vercel.app/api/whatsapp/delivery-events`
(إن لم يُضبط المتغير يُشتق من `KROTAK_INBOUND_URL` باستبدال `/inbound` بـ `/delivery-events`).
التوقيع **نفسه** المستخدم في inbound: `x-gateway-timestamp` (ms) و
`x-gateway-signature = HMAC_SHA256_hex(KROTAK_INBOUND_SECRET, "<timestamp>.<body>")`.
```json
{ "type": "delivery.updated", "delivery": { "...": "RailwayDeliveryView" } }
```
- يُرسل حدث بعد كل تغيير في العملية (قبول، server_ack، delivered، read، حسم المهلة، late delivery).
- **Outbox دائم** على الـ volume: الحدث لا يُحذف إلا بعد `2xx`؛ إعادة محاولة بتدرج حتى 24 ساعة.
  `4xx` (غير 408/429) = رفض نهائي يُسجل.
- خادم كروتك يطبّق الحدث فقط إذا `delivery.seq > stored.railwaySeq` (منع الترتيب المعكوس والتكرار).
- `404` يُعاد أيضاً (المسار لم يُنشر بعد على Vercel)، فلا تضيع الأحداث إن سبق نشر Railway.
- التنفيذ (المرحلة 3): مسار Vercel `POST /api/whatsapp/delivery-events` (rewrite إلى
  `whatsapp-delivery-events&__apiRoute=events`). توقيع خاطئ/منتهٍ (±5 دقائق) ⇒ `401`؛
  `type` غير معروف ⇒ `200 { ignored: true }` (توافق أمامي، لا إعادة محاولة)؛ جسم بلا
  `delivery.deliveryOperationId`/`networkId` صالحين ⇒ `400`. الرد `200 { state, railwaySeq }`.
  المتغير على Vercel هو `WHATSAPP_INBOUND_SECRET` القائم نفسه (يساوي `KROTAK_INBOUND_SECRET` على Railway).

---

## 6. واجهات التطبيق على خادم كروتك (`Bearer <Firebase ID token>`)

كل المسارات: توثيق المالك + `networkId` من Firestore (ليس من الجسم). `messages/send` يشترط ميزة
`whatsapp_card_delivery` (عبر `authorizeWhatsappOwner`)؛ أما `deliveries/status` و`sms-result`
و`pending-fallback` فتشترط المالك فقط دون الميزة: عملية بدأت قبل إلغاء الاشتراك يجب أن تُحسم
ويُسجل SMS البديل لها ويُستعاد أمرها، وإلا ضاع كرت مصروف.
الأخطاء بالشكل القائم `{ "success": false, "error": "<code>" }`.

### 6.1 `POST /api/whatsapp/messages/send` (موسّع)
الجسم:
```json
{
  "to": "967771234567",
  "text": "<نص القالب النهائي>",
  "deliveryOperationId": "dlv-sale-123-card-9",
  "operationId": "dlv-sale-123-card-9",
  "saleRef": "sale-123",
  "cardRef": "card-9",
  "orderRef": "A-77",
  "customerRef": "cust-5",
  "templateKey": "card_delivery",
  "smsFallback": true
}
```
- ينشئ (أو يعيد) `networks/{networkId}/wa_deliveries/{deliveryOperationId}` بحالة `queued` ثم يستدعي Railway.
- `deliveryOperationId`: `[A-Za-z0-9._:-]{1,128}` ولا يكون بصيغة `__x__` (محجوزة في Firestore).
- `saleRef`/`cardRef`/`orderRef`/`customerRef` اختيارية (≤128)، `templateKey` اختياري (≤64).
  رسائل بلا كرت (بث، اختبار): `deliveryOperationId = "msg:<sha>"` و`cardRef` غائب/`null`
  و`templateKey` في حقله (لا يُدمج في `saleRef`). `smsFallback` افتراضياً `true`.
- إن كانت العملية **محسومة مسبقاً** (delivered، أي حالة SMS، failed، delivery_timeout) يعيد
  `200 { duplicate: true, delivery }` **دون** استدعاء Railway (لا تخرج رسالة WhatsApp ثانية أبداً).
- `deliveryOperationId` موجود مسبقاً بـ `saleRef`/`cardRef`/`to` مختلفة ⇒ `409 delivery_operation_conflict`
  (يمنع إعادة استخدام المعرّف لكرت آخر). `null` مقابل قيمة يُعد اختلافاً؛ `to` يُقارن بعد التطبيع
  (أرقام فقط، حذف `00`، 8–15 رقماً).
- كل ردود الخطأ تحمل `deliveryOperationId`.
- 200:
```json
{
  "success": true,
  "deliveryOperationId": "dlv-sale-123-card-9",
  "messageId": "3EB0...",
  "duplicate": false,
  "delivery": { "...": "DeliveryView §6.5" }
}
```
- فشل مؤكد قبل الإرسال (لم تخرج رسالة):
  `409/429/503` بالشكل `{ "success": false, "error": "not_connected", "delivery": { "state": "sms_fallback_requested", "fallback": {...} } }`.
  **التطبيق يرسل SMS فوراً** بنفس الكرت ثم يبلغ §6.4.
- فشل غامض (`502/504 whatsapp_gateway_timeout|unreachable` بلا `delivery`): التطبيق يعيد نفس
  الطلب بنفس `deliveryOperationId` (آمن)، أو يستعلم §6.2، ولا يصرف كرتاً جديداً.

### 6.2 `GET /api/whatsapp/deliveries/status?ids=a,b,c` (≤50)
`{ "success": true, "deliveries": [DeliveryView | { "deliveryOperationId": "x", "state": "unknown" }] }`
- يجري **مطابقة احتياطية** (§6.3) لأي عملية `waiting_whatsapp_receipt` تجاوزت `receiptDeadlineAt + 15000`،
  ولأي عملية `queued` لم يُقبل إرسالها خلال `QUEUED_STALE_MS = 120000` من `createdAt`.

### 6.3 الحسم الاحتياطي عند صمت Railway
إذا بقيت العملية في Firestore `waiting_whatsapp_receipt` بعد `receiptDeadlineAt + 15s`
(حدث Railway لم يصل):
1. خادم كروتك يستعلم `GET /messages/deliveries`؛ إن أجاب يطبّق حالته (seq).
2. إن لم يُجب أو أعاد `unknown`: معاملة Firestore ذرية
   `waiting_whatsapp_receipt -> sms_fallback_requested` بسبب `gateway_silent_after_deadline`.
   عملية `queued` قديمة (>120s) لا يعرفها Railway ⇒ نفس الحسم (`gateway_silent_after_deadline`، `decidedBy: server`).
   إن كانت `smsFallback:false` (قديمة/legacy) ⇒ `delivery_timeout` إن قُبلت، وإلا `failed`، دون أمر SMS.
   كل حسم يتم داخل `runTransaction` يعيد قراءة الحالة؛ إن سبقه حدث Railway أو بلاغ SMS لا يُكتب شيء.
3. إيصال لاحق من Railway ⇒ late delivery فقط (§3). احتمال وصول الرسالتين بنفس الكرت مقبول
   ومُسجَّل بوضوح؛ صرف كرت ثانٍ مستحيل لأن fallback يحمل `cardRef` نفسه.

### 6.4 `POST /api/whatsapp/deliveries/sms-result`
```json
{
  "deliveryOperationId": "dlv-sale-123-card-9",
  "commandId": "dlv-sale-123-card-9:sms",
  "attempt": 1,
  "outcome": "sent",
  "at": 1731400011800,
  "error": null,
  "reason": "delivery_timeout",
  "saleRef": "sale-123",
  "cardRef": "card-9",
  "to": "967771234567"
}
```
- `outcome ∈ {sent, failed, abandoned}`؛ `attempt` عدد صحيح ≥1 يزيد مع كل محاولة SMS.
  `abandoned` (التطبيق تخلى عن الإرسال نهائياً) ⇒ `failed` (`finalOutcome: none`) دون زيادة عداد SMS.
- **idempotent** بالمفتاح `(deliveryOperationId, attempt)`: إعادة نفس البلاغ ⇒ 200 `duplicate:true`؛
  نفس `attempt` بنتيجة مختلفة ⇒ `409 sms_attempt_conflict`.
- يقبل بلاغاً **متأخراً بعد عودة الإنترنت** (`at` هو وقت الإرسال المحلي الفعلي).
- `cardRef` يجب أن يساوي المخزّن، وإلا `409 card_mismatch` (fallback بكرت مختلف مرفوض). بلاغ بلا
  `cardRef` مقبول فقط إن كان المخزّن `null` (رسالة بلا كرت).
- إن لم توجد العملية (التطبيق لم يصل للخادم أصلاً وأرسل SMS محلياً): تُنشأ بحالة
  `sms_fallback_requested` بسبب `reason` (مثل `whatsapp_unreachable`) ثم يُطبق البلاغ. إن لم توجد
  العملية ولم يحمل البلاغ `cardRef` ولا `saleRef` ولا `to` ⇒ `404 delivery_not_found`.
- إن كانت `waiting_whatsapp_receipt` (التطبيق حسم محلياً دون اتصال بعد مهلة محلية لا تقل عن 60s):
  معاملة واحدة `-> sms_fallback_requested (fallbackDecidedBy=app)` ثم `-> sms_fallback_sent|failed`.
- إن كانت `delivered`: لا تتغير الحالة؛ يُسجَّل `smsAfterDelivered = { at, attempt }` (لا يُخفى).
- بلاغ على حالة نهائية (`sms_fallback_sent`/`failed`/`delivery_timeout`) يُحفظ كمعلومة دون تغيير الحالة.
- 200: `{ "success": true, "duplicate": false, "applied": true, "delivery": DeliveryView }`؛
  `applied:false` = سُجل البلاغ دون تغيير الحالة (delivered أو حالة نهائية).

### 6.5 `GET /api/whatsapp/deliveries/pending-fallback?limit=50`
يعيد كل عمليات الشبكة في `sms_fallback_requested` أو `sms_fallback_failed` (الأقدم أولاً).
يستدعيه التطبيق عند الإقلاع/الاستئناف وعند عودة الإنترنت لاستعادة أوامر لم تُنفذ.
قبل الإجابة يُجري مطابقة §6.3 لعمليات الشبكة المفتوحة المتأخرة (حتى 200) فتظهر أوامرها في نفس الرد.
`limit` بين 1 و50. الرد `{ success, limit, deliveries: DeliveryView[] }`.

### DeliveryView (Firestore + الواجهات)
```json
{
  "deliveryOperationId": "dlv-sale-123-card-9",
  "networkId": "NET-10001",
  "saleRef": "sale-123", "cardRef": "card-9", "orderRef": "A-77", "customerRef": "cust-5",
  "templateKey": "card_delivery",
  "to": "967771234567",
  "firstChannel": "whatsapp",
  "state": "sms_fallback_requested",
  "whatsappStatus": "server_ack",
  "messageId": "3EB0...",
  "smsFallback": true,
  "createdAtMs": 0, "acceptedAtMs": 0, "receiptDeadlineAtMs": 0,
  "serverAckAtMs": 0, "deliveredAtMs": null, "readAtMs": null, "resolvedAtMs": 0,
  "fallback": {
    "commandId": "dlv-sale-123-card-9:sms",
    "reason": "delivery_timeout",
    "decidedBy": "gateway",
    "requestedAtMs": 0
  },
  "sms": { "status": "pending", "attempts": 0, "lastAttemptAtMs": null, "sentAtMs": null, "lastError": null },
  "lateDelivery": null,
  "smsAfterDelivered": null,
  "attempts": 1,
  "lastError": null,
  "finalOutcome": "pending",
  "railwaySeq": 4,
  "updatedAtMs": 0
}
```
- `fallback.reason ∈ {delivery_timeout, delivery_timeout_after_restart, whatsapp_send_failed:<code>, whatsapp_ack_error, whatsapp_send_interrupted, gateway_silent_after_deadline, whatsapp_unreachable, app_offline_deadline}`.
  (`whatsapp_ack_error`: WhatsApp رد بخطأ على الرسالة؛ `whatsapp_send_interrupted`: أُعيد تشغيل Railway بعد تخزين الرسالة وقبل اكتمال `relayMessage`.)
- `fallback.decidedBy ∈ {gateway, server, app}`.
- `sms.status ∈ {none, pending, sent, failed}`.
- `finalOutcome ∈ {pending, whatsapp, sms, none}`: `delivered ⇒ whatsapp`، `sms_fallback_sent ⇒ sms`،
  `failed|delivery_timeout ⇒ none`، غير ذلك `pending`.
- `attempts` = عدد طلبات الإرسال المقبولة لهذه العملية (إعادة الطلب المكررة لا تزيده).

---

## 7. سلوك التطبيق المطلوب (ملخص لـ app_delivery_agent)

1. يصرف الكرت **أولاً** محلياً ويسجل عملية تسليم محلية بـ `deliveryOperationId` + `saleRef` + `cardRef`.
2. يستدعي §6.1. إن فشل قبل الإرسال ⇒ SMS فوراً بنفس الكرت ⇒ §6.4.
3. عند القبول: سحب §6.2 كل 2 ثانية حتى `receiptDeadlineAt + 20s`، ثم كل 15 ثانية حتى 10 دقائق.
4. `state == sms_fallback_requested` ⇒ إرسال SMS محلي بنفس الكرت والقالب، **مرة واحدة لكل attempt**،
   ثم §6.4 (يُخزن البلاغ محلياً ويُعاد إرساله حتى ينجح؛ لا يعيد إرسال SMS بسبب فشل البلاغ).
5. `state == delivered` ⇒ لا SMS. `delivery_timeout` لا يحدث لعملاء v1.
6. عند الإقلاع وعودة الإنترنت: §6.5 + إعادة البلاغات المعلقة.
7. **دون إنترنت**: SMS لا يعتمد على أي مما سبق. إن قُبل الإرسال ثم انقطع الإنترنت ولم يصل أي رد
   خلال ≥60 ثانية من `acceptedAt`، يجوز للتطبيق إرسال SMS بنفس الكرت والإبلاغ لاحقاً بـ
   `reason: app_offline_deadline` (§6.4). ينتج عنه احتمال رسالتين بنفس الكرت — مسجَّل، لا كرت ثانٍ.

---

## 8. التوافق للخلف

- طلب `/messages/send` بلا `deliveryOperationId` (إصدارات التطبيق الحالية): يعمل كما كان
  (`{ messageId, duplicate }`)، وتُتتبع العملية بمعرّف `operationId` مع `smsFallback:false`،
  فينتهي غياب الإيصال بـ `delivery_timeout` (لا أمر fallback لأن التطبيق القديم لا يسحب).
- `sent-ops.json` القديم على الـ volume يبقى مقروءاً لمنع إعادة إرسال عمليات أُرسلت قبل الترقية.
- ملفات auth الحالية (`*.enc`، نفس اشتقاق المفتاح وAAD) تُقرأ دون تحويل.

---

## 9. Firestore

- المسار: `networks/{networkId}/wa_deliveries/{deliveryOperationId}`.
- الكتابة: Admin SDK فقط (خادم كروتك). القراءة: المدير، ومالك الشبكة.
- لا نص رسائل ولا رقم كرت سري.
- لوحة الإدارة: تقرير التسليم (§4.4) يقرأ هذه المستندات (collection group `wa_deliveries`)
  عبر واجهة إدارة موثقة `GET /api/admin/whatsapp-deliveries` (Firebase ID token لمستند `Admins/{uid}`).
  الفلاتر: `networkId` (اختياري؛ بدونه collection group)، `state` (إحدى حالات §2)،
  `from`/`to` (`YYYY-MM-DD` بتوقيت UTC أو ms من 13 رقماً، على `createdAtMs`)، `limit` 1–500 (افتراضي 200).
  الرد `{ success, deliveries, summary: { total, byState, byOutcome, lateDelivery, smsAfterDelivered }, filters, truncated }`.
  فهرس غير منشور ⇒ `503 delivery_index_missing`.
- الفهارس في `firestore.indexes.json` (Krotic-Admin-App): `wa_deliveries (state ASC, createdAtMs DESC)` لنطاقي
  COLLECTION وCOLLECTION_GROUP، و`fieldOverrides` لـ `createdAtMs` (ASC/DESC) لكلا النطاقين.
  تحتاج نشراً: `firebase deploy --only firestore:indexes,firestore:rules`.
- `pending-fallback` يستخدم `where('state','in',[...])` بلا ترتيب على الخادم (فهرس الحقل الواحد التلقائي يكفي).

---

## 10. إضافات v1 المتوافقة (المرحلة 2)

- حالة جلسة جديدة: `awaiting_pairing_code` (رمز ربط من 8 خانات بانتظار إدخاله في WhatsApp).
- Railway: `POST /sessions/pairing-code { networkId, phoneNumber }` ⇒
  `{ status, pairingCode: "ABCD-EFGH", expiresAt, linkUrl, ... }`؛ أخطاء `400 invalid_phone_number`،
  `409 already_linked | linking_in_progress`، `502 pairing_code_failed`، `504 pairing_code_timeout`.
- خادم كروتك (قناة الجلسة القائمة): `POST /api/whatsapp/session/pairing-code { phoneNumber }` (Firebase ID token +
  `whatsapp_card_delivery`، `networkId` من Firestore) ⇒ نفس الرد بلا `linkToken`.
- `GET /sessions/status` يعيد `lastConnectedAt` بالمللي ثانية و`accountSuffix` (آخر 4 أرقام) و`linkMode`.
- كل ردود الخطأ من `/messages/send` تحمل `delivery` (RailwayDeliveryView) إن سُجلت العملية.

