# مقترح معماري نهائي — تكامل WhatsApp الخادمي (للإدارة)

**الحالة:** تصميم نهائي للمراجعة والاعتماد قبل أي كود تكامل.  
**الفرع:** `تكامل-مزايا-المدفوعة`  
**تاريخ القرارات:** 2026-10-30 (D1–D8)  
**عقد Android:** `Krotak-Pro/feature/paid-features` → `docs/contracts/whatsapp-delivery-and-recharge-policy.md`  
**الاستضافة الحالية:** Vercel Serverless + Firebase Admin SDK + Firestore

> **لا تنفيذ كود** حتى اعتماد المالك الصريح لهذه النسخة.

---

## 0. قرارات المالك المعتمدة (ملخّص)

| ID | القرار |
|---|---|
| D1 | أسرار Meta في **Google Secret Manager** فقط؛ عزل لكل شبكة؛ لا أسرار في المستودع/Firestore/العميل/السجلات |
| D2 | المزود الأساسي على **`networks/{networkId}`** فقط؛ لا نسخة في `users/{uid}` |
| D3 | Webhooks Meta: HMAC-SHA256 على الجسم الخام + `hub.verify_token` + idempotency `providerId+inboundMessageId` |
| D4 | **Local Gateway مؤجَّل** حتى مواصفات خدمة خارجية كاملة؛ ليس تكاملاً رسمياً من Meta |
| D5 | تقليل البيانات: لا احتفاظ بالجسم الخام بعد المعالجة؛ سياسة حذف صريحة |
| D6 | إنشاء حدث ذري؛ لا إصدار كرت/سلفة مرتين؛ تعافٍ عند توقف الخادم |
| D7 | مزود واحد يدوي؛ SMS بعد فشل نهائي أو 10 ثوانٍ بلا تأكيد؛ مؤقت خادمي + قفل |
| D8 | لا كود قبل اعتماد هذا التصميم |

---

## 1. المبادئ الملزمة

1. لا أسرار Meta في APK / SQLite / SharedPreferences / Logs / لوحة الإدارة.
2. الأسرار في Secret Manager فقط، معزولة لكل `networkId`.
3. المزود الأساسي يدوي لكل شبكة؛ **لا** تبديل تلقائي Cloud ↔ Gateway.
4. منع التكرار: `providerId + inboundMessageId` بإنشاء ذري.
5. SMS احتياطي بعد فشل نهائي أو غياب `delivered/read` خلال **10 ثوانٍ**؛ لا إرسال مزدوج.
6. فصل استقبال الأحداث عن معالجة الشحن/إصدار الكرت.
7. بوابة الميزة: `users/{uid}.account_features.whatsapp_card_delivery === true` فقط (Fail-Closed).
8. نجاح استقبال Webhook ≠ نجاح تسليم الكرت.

---

## 2. المسارات النهائية المقترحة (للمراجعة)

### 2.1 مرحلة Cloud API (قابلة للتنفيذ بعد الاعتماد)

| الغرض | المسار | الطريقة | المستدعي |
|---|---|---|---|
| Webhook Meta (تحقق + وارد + حالات التسليم) | `/api/whatsapp/meta/webhook` | `GET` + `POST` | Meta |
| قراءة/تعيين إعداد المزود للشبكة | `/api/whatsapp/network-config` | `POST` (admin) | لوحة الإدارة |
| ربط/تحديث بيانات WABA غير السرية | `/api/whatsapp/cloud/link` | `POST` (admin) | لوحة الإدارة |
| حالة الربط (بدون أسرار) | `/api/whatsapp/cloud/status` | `POST` (admin أو مالك مصادق) | التطبيق/الإدارة |
| منسق التسليم (داخلي/مجدول) | `/api/whatsapp/delivery/dispatch` | `POST` (خادمي محمي) | مؤقت/طابور خادمي |

### 2.2 مرحلة Local Gateway (معلّقة — D4)

المسارات التالية **موثّقة للاكتمال المعماري فقط** ولا تُنفَّذ قبل مواصفات الخدمة:

| الغرض | المسار المقترح (معلّق) |
|---|---|
| أحداث Gateway | `/api/whatsapp/gateway/events` |
| بدء جلسة QR | `/api/whatsapp/gateway/session/start` |
| حالة الجلسة | `/api/whatsapp/gateway/session/status` |
| إنهاء الجلسة | `/api/whatsapp/gateway/session/stop` |

**متطلبات D4 قبل أي تنفيذ Gateway:** مصادقة Gateway↔الخادم، توقيع الأحداث، ربط `sessionId→networkId` ضد الانتحال، إعادة الاتصال، استعادة الجلسة، انتهاء QR، إقرار صريح أنه **ليس** API رسمياً من Meta.

---

## 3. Webhooks من Meta (D3)

### 3.1 تحقق الاشتراك (`GET`)

- مقارنة `hub.verify_token` مع قيمة مخزّنة في Secret Manager (على مستوى التطبيق أو لكل شبكة حسب نموذج الربط المعتمد عند التنفيذ).
- لا يُضمَّن الـ token في العميل أو المستودع.
- استجابة النجاح: إرجاع `hub.challenge` كما تشترط Meta.

### 3.2 استقبال الأحداث (`POST`)

1. قراءة **الجسم الخام** كما وصل (بدون إعادة تسلسل JSON قبل التوقيع).
2. التحقق من `X-Hub-Signature-256` = `sha256=<HMAC_SHA256(rawBody, app_secret)>`.
3. غياب الرأس أو عدم التطابق ⇒ **401/403 فوري**؛ لا كتابة Firestore ولا إصدار كرت.
4. **لا** افتراض وجود طابع زمني موقّع في ترويسة Meta القياسية؛ الاعتماد على idempotency فقط لإعادة الإرسال.
5. استخراج: المرسل، النص (إن وُجد)، `inboundMessageId`، حالة التسليم إن وُجدت، وربط `networkId` من إعدادات رقم/WABA.

### 3.3 اختبارات إلزامية (قبل إعلان الاكتمال)

- توقيع صحيح ⇒ قبول وإنشاء سجل حدث مرة واحدة.
- توقيع خاطئ / غائب ⇒ رفض بلا أثر جانبي.
- إعادة إرسال نفس `providerId + inboundMessageId` ⇒ لا معالجة مزدوجة ولا إصدار كرت ثانٍ.

---

## 4. تخزين الأسرار — Google Secret Manager (D1)

### 4.1 ماذا يُخزَّن

| السر | العزل |
|---|---|
| App Secret (توقيع Webhook) | مستوى التطبيق أو مشروع Meta |
| Verify Token | مستوى التطبيق |
| Access Token لكل رقم/WABA | **لكل `networkId`** |
| معرّفات غير سرية (WABA ID, Phone Number ID) | يمكن في `networks/{networkId}` كبيانات عامة للربط فقط |

### 4.2 ما يُمنع

- لا مفاتيح في Git / `.env` في العميل / Firestore / SharedPreferences / Logs.
- لا عرض Token كامل في لوحة الإدارة (حالة الربط + آخر 4 أحرف كحد أقصى عند الحاجة).
- لا كتابة أسرار من قواعد Firestore للعميل.

### 4.3 توافق الاستضافة (Vercel + Firebase)

| البند | الوضع |
|---|---|
| قراءة Secret Manager من دالة Vercel | ممكن عبر حساب خدمة GCP مربوط بمشروع Firebase/GCP |
| صلاحيات مطلوبة | `secretmanager.secretAccessor` على الأسرار المعنية فقط |
| متغير بيئة مسموح | معرّف مشروع GCP / اسم مورد السر — **وليس** قيمة السر نفسها |
| تكلفة | أسرار + عمليات الوصول (Access) حسب تسعير Google |
| قيد | دوال Vercel Serverless تحتاج صلاحية IAM صحيحة في بيئة الإنتاج قبل أي نشر |

**قبل التنفيذ:** التحقق من ربط مشروع Firebase الحالي بـ GCP ومن تفعيل Secret Manager في نفس المشروع (أو مشروع مرتبط).

---

## 5. اختيار المزود — `networks/{networkId}` (D2)

### 5.1 المسار canonical (مثبت في الكود الحالي)

المستودع يستخدم `db.collection('networks').doc(networkId)` في:

- `api/networks.js`, `api/register-network.js`, `api/sales/ingest.js`, `api/settlement.js`
- `server/_lib/networkSecretApi.js`, `networkLedger.js`, `deviceHeartbeat.js`, …

`users/{uid}.networkId` يشير إلى الشبكة؛ **مصدر حقيقة الإعدادات الشبكية = وثيقة الشبكة.**

### 5.2 الحقول المقترحة على `networks/{networkId}` (غير سرية)

```text
whatsappPrimaryProvider: "cloud_api" | "local_gateway"   // الافتراضي عند الغياب: غير مفعّل / يحتاج اختياراً
whatsappCloudLinkStatus: "unlinked" | "linked" | "error"
whatsappPhoneNumberId: string | null          // معرّف عام غير سري
whatsappWabaId: string | null
whatsappDisplayHint: string | null            // آخر 4 أحرف أو اسم العرض فقط
whatsappUpdatedAtMs: number
whatsappUpdatedBy: string                     // adminUid
```

- **لا** نسخة متعارضة تحت `users/{uid}`.
- تغيير المزود يؤثر على **العمليات الجديدة فقط**.

---

## 6. مخطط البيانات — الأحداث والمعالجة (D5, D6)

### 6.1 سجل الحدث الوارد (ذري)

```text
whatsapp_inbound_events/{providerId}_{inboundMessageId}
  providerId: "meta"                    // مرحلة 1؛ local_gateway لاحقاً
  inboundMessageId: string
  networkId: string
  ownerUid: string | null
  fromE164: string | null               // رقم مُطبَّع إن وُجد
  messageType: string | null
  // text: لا يُحتفظ به بعد انتهاء المعالجة إلا لمدة التدقيق المعتمدة أدناه
  textRetentionUntilMs: number | null
  occurredAtMs: number | null           // من الحمولة إن وُجد؛ ليس شرطاً للتوقيع
  receivedAtMs: number                  // ساعة الخادم
  signatureVerified: true
  processingStatus: "received" | "queued" | "processing" | "processed" | "ignored" | "failed"
  deliveryOperationId: string | null    // يربط بسجل التسليم/البيع
  lastErrorCode: string | null
  updatedAtMs: number
```

- الإنشاء: **`create` فقط** (يفشل إن وُجد) ⇒ منع التكرار عند التزامن وإعادة الإرسال.
- إعادة وصول نفس المفتاح: HTTP 200 مع `duplicate: true` بلا إعادة معالجة.

### 6.2 سجل عملية التسليم (منفصل عن استقبال Webhook)

```text
whatsapp_delivery_operations/{deliveryOperationId}
  networkId: string
  ownerUid: string
  saleUuid: string | null               // الكرت من البيع الأصلي فقط
  inboundEventId: string                // providerId_inboundMessageId
  channel: "whatsapp" | "sms"
  providerId: "meta" | "sms" | ...
  providerMessageId: string | null
  status: "accepted" | "sent" | "delivered" | "read" | "failed" | "unknown" | "delivered_late_after_sms"
  smsFallbackScheduledAtMs: number | null
  smsFallbackSentAtMs: number | null
  whatsappDeadlineAtMs: number | null   // received/sent + 10s (ساعة خادم)
  lockOwner: string | null              // قفل معالجة ضد السباق
  lockUntilMs: number | null
  createdAtMs: number
  updatedAtMs: number
```

- **لا** حجز/إصدار كرت جديد عند Fallback؛ نفس `saleUuid` وبيانات الكرت الأصلية.
- نجاح Webhook alone لا يغيّر مخزوناً.

### 6.3 سياسة الاحتفاظ والحذف (D5)

| البيانات | الاحتفاظ |
|---|---|
| جسم Webhook الخام | يُستخدم للتحقق فقط؛ **لا يُخزَّن** بعد انتهاء الطلب |
| نص الرسالة الواردة | اختياري لأغراض التدقيق لمدة **≤ 72 ساعة** ثم حذف/تصفير الحقل |
| سجل الحدث (بدون نص) | **90 يوماً** ثم حذف أو أرشفة مجمّدة حسب قرار تشغيلي لاحق |
| أسرار Meta | Secret Manager فقط؛ تدوير يدوي عند التسريب |

قواعد Firestore: منع قراءة/كتابة `whatsapp_inbound_events` و`whatsapp_delivery_operations` من العميل؛ Admin SDK فقط.

---

## 7. منع التكرار وإصدار الكرت مرة واحدة (D6)

```text
[Meta POST]
    → تحقق التوقيع
    → create(whatsapp_inbound_events/id)     // ذري؛ فشل = مكرر
    → إن جديد: enqueue معالجة (لا إصدار فوري في نفس طلب Webhook إن أمكن)
    → المعالج: يتحقق whatsapp_card_delivery + يربط البيع/الطلب
    → create/update whatsapp_delivery_operations بمعرّف ثابت
    → إرسال WhatsApp عبر المزود المختار فقط
    → جدولة فحص مهلة 10s على الخادم
```

**تعافٍ عند توقف الخادم:**

- الحالات `received` / `queued` / `processing` المنتهية صلاحية قفلها تُعاد إلى الطابور.
- إعادة المعالجة تقرأ سجل الحدث الموجود ولا تنشئ حدثاً جديداً.
- إصدار الكرت مشروط بانتقال حالة محمي (مثلاً من `accepted` إلى `sent`) بقفل `lockOwner` + `lockUntilMs`.

---

## 8. التوجيه وSMS (D7)

1. المزود من `networks/{networkId}.whatsappPrimaryProvider` فقط.
2. لا failover إلى المزود الآخر.
3. فشل نهائي / رفض المستلم / عدم جاهزية المزود ⇒ جدولة SMS فوراً (مرة واحدة).
4. قبول الإرسال دون `delivered`/`read` موثوق خلال **10 ثوانٍ** (ساعة خادم من `whatsappDeadlineAtMs`) ⇒ SMS مرة واحدة.
5. وصول التأكيد خلال المهلة يمنع SMS؛ بعد SMS يُسجَّل `delivered_late_after_sms` دون إعادة إرسال.
6. قفل على `whatsapp_delivery_operations` يمنع سباق «تأكيد WhatsApp» مع «مهمة SMS».
7. SMS عبر المسار الحالي المعتمد في التطبيق (`MessageDeliveryWorker` / مهمة خادمية) دون إنشاء كرت ثانٍ.

---

## 9. إعادة المحاولة والطوابير وحالات الفشل

| الطبقة | الآلية المقترحة |
|---|---|
| استقبال Webhook | سريع: تحقق + `create` حدث + رد 200؛ المعالجة الثقيلة خارج الطلب قدر الإمكان |
| طابور المعالجة | Firestore status + استدعاء مجدول (`/api/whatsapp/delivery/dispatch`) أو Queue لاحق؛ في Vercel Hobby قد يُستخدم cron/جدولة خارجية |
| إعادة المحاولة | أخطاء عابرة (5xx مزود، مهلة شبكة): backoff مع حد أقصى للمحاولات على `delivery_operations` |
| فشل نهائي | `processingStatus=failed` + `lastErrorCode`؛ انتقال لسياسة SMS إن انطبق |
| عدم تكرار SMS | الحقلان `smsFallbackSentAtMs` والقفل يمنعان الإرسال المزدوج |

**قيد Vercel:** الدوال قصيرة العمر؛ أي عمل أطول من مهلة الدالة يجب أن يكون عبر إعادة جدولة حالة وليس حلقة طويلة داخل طلب Webhook.

---

## 10. الصلاحيات والأمان

- Webhook Meta: عام مع تحقق توقيع فقط (بدون Firebase ID token).
- مسارات الإعداد: `authenticateAdmin` أو مالك الشبكة بعد التحقق من `networks/{id}.owner_uid`.
- قبل أي إرسال: `account_features.whatsapp_card_delivery === true`.
- Firestore Rules: حظر العميل على أحداث WhatsApp وسجلات التسليم والأسرار.
- لا تسجيل Access Token أو App Secret في `console.log`.

---

## 11. متطلبات البنية التحتية والتكلفة والصلاحيات

| المتطلب | التفاصيل |
|---|---|
| GCP Secret Manager | تفعيل API؛ أسرار لكل شبكة/تطبيق |
| IAM | حساب خدمة Vercel/Firebase بصلاحية `secretmanager.secretAccessor` المحدودة |
| Vercel | مسارات API جديدة ضمن حد الوظائف (Hobby)؛ قد تحتاج دمجاً مع دالة مشتركة كما في `settings.js` |
| Meta | تطبيق Meta، WABA، رقم، تسجيل Webhook على `/api/whatsapp/meta/webhook` |
| تكلفة تقريبية | Secret Manager (أسرار + وصول) + استدعاءات Meta Cloud API حسب التسعير + دقائق Vercel |
| Local Gateway | **غير مشمول** في التكلفة الحالية حتى اعتماد المواصفات |

---

## 12. اختبارات مطلوبة قبل إعلان اكتمال الجزء الخادمي

1. توقيع Meta صحيح / خاطئ / غائب.
2. إعادة إرسال نفس `providerId + inboundMessageId`.
3. سباق طلبين متزامنين لنفس الحدث (create واحد فقط).
4. Fail-Closed عند غياب `whatsapp_card_delivery`.
5. مهلة 10 ثوانٍ → SMS مرة واحدة؛ تأكيد متأخر → `delivered_late_after_sms` بلا SMS ثانٍ.
6. لا تسريب أسرار في الاستجابات أو السجلات.
7. عزل إعدادات شبكتين مختلفتين.
8. تعافٍ بعد قتل المعالجة أثناء `processing` (إعادة قفل).

---

## 13. ما يبقى معلّقاً (ليس موافقة ضمنية)

- [ ] اعتماد أسماء المسارات في §2.1 كما هي أو بتعديل صريح.
- [ ] اعتماد سياسة الاحتفاظ 72 ساعة للنص / 90 يوماً للسجل أو أرقام بديلة.
- [ ] تأكيد تفعيل Secret Manager على مشروع GCP المرتبط.
- [ ] مواصفات Local Gateway الكاملة قبل أي كود D4.
- [ ] قرار آلية الطابور على Vercel Hobby (cron خارجي vs دمج مجدول).

---

## 14. حدود هذه الوثيقة

- **لا كود تكامل** في هذا الالتزام.
- **لا** إعلان اكتمال المرحلة 0.
- التنفيذ لاحقاً على `تكامل-مزايا-المدفوعة` فقط بعد اعتمادك، دون لمس `main` ودون نشر إنتاج تلقائي.
