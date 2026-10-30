# مقترح معماري نهائي — تكامل WhatsApp الخادمي (للإدارة)

**الحالة:** تصميم معماري معتمد شرطياً بعد إغلاق التوضيحات الأربعة؛ **لا إذن تنفيذ كود** حتى موافقة مستقلة لاحقة.  
**الفرع:** `تكامل-مزايا-المدفوعة`  
**القرارات:** D1–D8 + إغلاق نقاط المراجعة (2026-10-30)  
**عقد Android:** `Krotak-Pro/feature/paid-features` → `docs/contracts/whatsapp-delivery-and-recharge-policy.md`  
**الاستضافة الحالية:** Vercel Serverless + Firebase Admin SDK + Firestore  
**vercel.json الحالي:** يحتوي `crons` يومياً لـ `/api/dispatch-notifications` فقط — **غير كافٍ** لمهلة 10 ثوانٍ أو التعافي.

> **لا تنفيذ كود تكامل** في هذا الالتزام. المرحلة 0 غير مكتملة.

---

## 0. قرارات معتمدة

| ID | القرار |
|---|---|
| D1 | أسرار Meta في **Google Secret Manager** فقط؛ عزل لكل شبكة |
| D2 | المزود على **`networks/{networkId}`** فقط |
| D3 | HMAC-SHA256 على الجسم الخام + `hub.verify_token` + منع تكرار |
| D4 | Local Gateway **موقوف** حتى مواصفات كاملة |
| D5 | تقليل البيانات + حذف فعلي بعد المدة |
| D6 | إنشاء ذري + ضمان مرة واحدة على مستوى قاعدة البيانات |
| D7 | مزود واحد؛ SMS بعد فشل أو 10 ثوانٍ؛ بلا كرت ثانٍ |
| D8 | لا كود قبل اعتماد التوضيحات |

**موافق عليه صراحة:** مسارات Cloud الخمسة، Secret Manager، إيقاف Gateway، لا تبديل مزودين، SMS، لا كرت جديد عند SMS.

---

## 1. المبادئ الملزمة

1. لا أسرار في APK / SQLite / SharedPreferences / Logs / لوحة الإدارة / المستودع.
2. Secret Manager فقط؛ عزل لكل `networkId` حيث ينطبق.
3. مزود يدوي لكل شبكة؛ لا failover تلقائي.
4. هوية حدث فريدة عبر الشبكات + `create` ذري.
5. SMS بعد فشل نهائي أو غياب تأكيد خلال 10 ثوانٍ؛ لا إرسال مزدوج.
6. فصل الاستقبال عن المعالجة عن إصدار الكرت.
7. `account_features.whatsapp_card_delivery === true` فقط (Fail-Closed).
8. نجاح Webhook ≠ نجاح تسليم الكرت.
9. العميل ليس مصدراً موثوقاً لـ `saleUuid` أو بيانات الكرت.

---

## 2. المسارات (Cloud — معتمدة معمارياً)

| الغرض | المسار | المستدعي | المصادقة |
|---|---|---|---|
| Webhook Meta | `/api/whatsapp/meta/webhook` | Meta | توقيع HMAC / verify_token |
| إعداد المزود | `/api/whatsapp/network-config` | لوحة الإدارة | Admin فقط |
| ربط Cloud غير السري | `/api/whatsapp/cloud/link` | لوحة الإدارة | Admin فقط |
| حالة الربط | `/api/whatsapp/cloud/status` | إدارة أو مالك | Admin أو مالك الشبكة |
| منسق التسليم | `/api/whatsapp/delivery/dispatch` | **مجدول خادمي فقط** | سر خدمة داخلي — **ليس** توكن عميل |

Local Gateway: مسارات موثّقة سابقاً **معلّقة (D4)**.

---

## 3. توضيح 1 — هوية حدث WhatsApp (منع التصادم بين الشبكات)

### 3.1 المشكلة

مفتاح `{providerId}_{inboundMessageId}` وحده قد لا يكفي إذا:

- عدة شبكات مربوطة بنفس مشروع Meta أو أرقام مختلفة؛
- أو أُعيد استخدام معرّفات في بيئات اختبار؛
- أو لزم عزل أدلة التدقيق لكل شبكة بشكل قاطع.

### 3.2 المفتاح المعتمد للمستند

بعد حل `networkId` من `phone_number_id` / WABA المرتبط بـ `networks/{networkId}`:

```text
whatsapp_inbound_events/{providerId}_{networkId}_{inboundMessageId}
```

| المكوّن | المعنى |
|---|---|
| `providerId` | ثابت مرحلة 1: `meta` |
| `networkId` | الشبكة المحلولة من رقم WhatsApp Business المرتبط |
| `inboundMessageId` | معرّف الرسالة الوارد من Meta |

- إذا تعذّر حل `networkId` ⇒ **رفض الحدث** (لا مستند يتيم، لا معالجة).
- الحقول داخل المستند تكرر `providerId` و`networkId` و`inboundMessageId` للبحث والفهرسة.

### 3.3 الإنشاء الذري

```text
ref.create(data)   // فقط
```

- **ممنوع:** `set` و`merge` و`update` عند أول إدراج.
- عند `ALREADY_EXISTS`: اعتباره تكراراً → HTTP 200 + `duplicate: true` بلا إعادة معالجة وبلا إصدار كرت.
- سباق طلبين متزامنين: ناجح واحد فقط على مستوى Firestore.

### 3.4 أحداث حالة التسليم (status callbacks)

أحداث `delivered` / `read` / `failed` من Meta تُربط عبر `providerMessageId` → `whatsapp_delivery_operations`، **ولا** تنشئ `inbound_events` جديداً لمعالجة إصدار كرت.

---

## 4. توضيح 2 — منع إصدار الكرت مرتين (ضمان قاعدة بيانات)

الهدف: ضمان مرة واحدة **في Firestore**، لا الاعتماد على قفل برمجي في الذاكرة فقط.

### 4.1 معرّف عملية التسليم الحتمي

```text
deliveryOperationId = hash_or_join(networkId, saleUuid)
مستند: whatsapp_delivery_operations/{deliveryOperationId}
```

- يُشتق من **البيع/طلب الشحن الأصلي** بعد التحقق الخادمي، لا من طلب العميل.
- **`create` عند أول إنشاء** لنفس `deliveryOperationId`؛ التكرار يفشل ذرياً.

### 4.2 ربط إلزامي بالعملية الأصلية

| الحقل | القاعدة |
|---|---|
| `saleUuid` | إلزامي لعمليات تسليم الكرت؛ يُقرأ من سجل البيع الخادمي بعد التحقق |
| `networkId` | يجب أن يطابق شبكة البيع ومالك الاستحقاق |
| `inboundEventId` | `{providerId}_{networkId}_{inboundMessageId}` إن وُجد مصدر وارد |
| `cardPayloadRef` | إشارة لبيانات الكرت المخزّنة سلفاً مع البيع — **لا** يقبل العميل PIN/كرت جديداً |

### 4.3 آلة حالات التسليم (حقول على نفس المستند)

```text
status:
  accepted → sent → delivered | read | failed
                 ↘ sms_pending → sms_sent → delivered_late_after_sms
```

انتقالات مسموحة فقط عبر **معاملة Firestore** تتحقق من الحالة السابقة:

| من | إلى | شرط إضافي |
|---|---|---|
| (لا مستند) | `accepted` | `create` بمفتاح `deliveryOperationId` |
| `accepted` | `sent` | إرسال WhatsApp نجح عند المزود |
| `sent` | `delivered` / `read` | callback Meta |
| `sent` | `sms_pending` | فشل نهائي أو انقضاء `whatsappDeadlineAtMs` |
| `sms_pending` | `sms_sent` | إرسال SMS مرة واحدة؛ يشترط `smsFallbackSentAtMs == null` |
| أي حالة بعد `sms_sent` | `delivered_late_after_sms` | callback WhatsApp متأخر؛ **لا** SMS ثانٍ **ولا** كرت ثانٍ |

### 4.4 ضمانات ضد السيناريوهات المطلوبة

| السيناريو | الضمان |
|---|---|
| عمليتان لنفس `deliveryOperationId` | `create` يفشل للثانية |
| انتقال WhatsApp → SMS | نفس المستند ونفس `saleUuid`؛ لا مستند تسليم جديد |
| تأكيد WhatsApp بعد SMS | تحديث `status` فقط إلى `delivered_late_after_sms` |
| استعادة بعد توقف الخادم | لا `create` جديد؛ استئناف نفس المستند إذا انتهت صلاحية القفل |
| Webhook مكرر | `inbound_events` create يفشل → لا يستدعي إنشاء delivery جديد |

### 4.5 القفل (مساعد وليس البديل الوحيد)

```text
lockOwner: string | null
lockUntilMs: number | null
```

يُستخدم داخل المعاملة لتقليل السباقات؛ **الضمان النهائي** هو مفتاح المستند الحتمي + `create` + انتقالات الحالة الشرطية.

---

## 5. توضيح 3 — صلاحيات `/api/whatsapp/delivery/dispatch`

### 5.1 من يُسمح له بالاستدعاء

| المسموح | غير المسموح |
|---|---|
| مجدول داخلي يحمل `DISPATCH_SERVICE_SECRET` (رأس مخصص) | تطبيق Android بـ Firebase ID token |
| Admin SDK / Cloud Scheduler / Cloud Tasks | أي عميل يمرّر `saleUuid` أو نص كرت |

### 5.2 ماذا يفعل المسار

1. التحقق من سر الخدمة (مقارنة ثابتة الوقت مع قيمة من Secret Manager أو env خادمي).
2. قراءة قائمة عمليات بحالة `accepted` / `sent` / `sms_pending` / `processing` منتهية القفل — **من قاعدة البيانات فقط**.
3. لكل عملية: إعادة التحقق خادمياً من:
   - وجود `networks/{networkId}` و`whatsappPrimaryProvider`؛
   - `users/{ownerUid}.account_features.whatsapp_card_delivery === true`؛
   - صحة `saleUuid` وملكية الشبكة للبيع؛
   - عدم وجود `smsFallbackSentAtMs` قبل إرسال SMS.
4. **لا** يقبل الجسم من المستدعي كمصدر لبيانات الكرت أو رقم المستلم النهائي دون مطابقة السجل.

### 5.3 رفض صريح

```text
طلب من عميل فيه saleUuid / pin / cardNumber / networkId
  → 401/403 دون قراءة مخزون أو إرسال
```

مسارات العميل المسموحة لاحقاً (إن وُجدت) تقتصر على **عرض الحالة** بعد مصادقة المالك، بلا إصدار.

---

## 6. توضيح 4 — الطابور والجدولة (بدون الاعتماد على Vercel Hobby Cron)

### 6.1 رفض الضمان على Cron الحالي

- `vercel.json` اليوم: cron **يومي** (`0 6 * * *`) لـ `/api/dispatch-notifications`.
- خطة Hobby لـ Vercel Cron غير مضمونة لمهلة **10 ثوانٍ** ولا لإعادة المحاولة الدقيقة عند انتهاء مهلة الدالة.
- **لا يُعتمد** Vercel Cron وحده لتنفيذ مهلة WhatsApp أو التعافي.

### 6.2 الآلية المعتمدة مقترحاً: Google Cloud Tasks (+ Scheduler عند الحاجة)

| الدور | الخدمة |
|---|---|
| جدولة فحص بعد ~10 ثوانٍ من `sent` | **Cloud Tasks** (مهمة لمرة واحدة بتأخير) |
| مسح تعافٍ دوري للعمليات العالقة | **Cloud Scheduler** → يستدعي `dispatch` بسر الخدمة (مثلاً كل دقيقة) |
| تنفيذ المهمة | `POST /api/whatsapp/delivery/dispatch` مع سر الخدمة فقط |

**لماذا Tasks:** تأخير بالثواني، إعادة محاولة مدمجة عند 5xx، لا تعتمد على بقاء نفس instance حياً بعد رد Webhook.

### 6.3 تدفق مبسّط

```text
Webhook → create inbound event → (إن لزم) create delivery_operation(accepted)
       → إرسال WhatsApp → status=sent + whatsappDeadlineAtMs=now+10s
       → Cloud Task: countdown 10s → dispatch
       → dispatch: إن لم يصل delivered/read ولم يُرسل SMS → sms_pending → sms_sent
```

عند توقف الدالة أثناء المعالجة: Scheduler/Tasks يعيد استدعاء `dispatch`؛ المعاملة تستأنف نفس `deliveryOperationId`.

### 6.4 تكلفة وصلاحيات تقريبية

| البند | ملاحظة |
|---|---|
| Cloud Tasks | تكلفة منخفضة لكل مهمة؛ مجاني ضمن حصة يومية عادةً كافية للبداية |
| Cloud Scheduler | وظيفة واحدة دورية رخيصة |
| IAM | حساب خدمة بمفعّل `cloudtasks.enqueuer` + استدعاء المسار عبر OIDC أو سر مشترك |
| الربط مع Vercel | Task تستدعي URL الإنتاج؛ السر من Secret Manager |

**بديل مقبول لاحقاً** (إن رُفض Tasks): عامل Queue على Cloud Run/Functions مع Firestore listen — أعلى تكلفة تشغيلية؛ يحتاج قراراً مستقلاً.

### 6.5 ما لن يُنفَّذ

- حلقة انتظار 10 ثوانٍ داخل طلب Webhook.
- الاعتماد على `setTimeout` في Serverless.
- Cron Vercel كضمان وحيد للمهلة.

---

## 7. Webhooks من Meta

1. جسم خام → `X-Hub-Signature-256` = HMAC-SHA256(`app_secret`).
2. رفض فوري عند غياب/خطأ التوقيع.
3. `GET`: `hub.verify_token` من Secret Manager.
4. لا افتراض طابع زمني موقّع في ترويسة Meta.
5. بعد التحقق: حل `networkId` → `create` بمفتاح §3.2.

اختبارات إلزامية: توقيع صحيح / خاطئ / غائب؛ إعادة إرسال؛ سباق create.

---

## 8. Secret Manager (D1) — جاهزية غير مفترضة

| السر | العزل |
|---|---|
| App Secret | مستوى التطبيق |
| Verify Token | مستوى التطبيق |
| Access Token | **لكل `networkId`** |
| `DISPATCH_SERVICE_SECRET` | مستوى التطبيق |

**قبل التنفيذ الفعلي يجب التحقق من:**

1. مشروع GCP المرتبط فعلياً بمشروع Firebase المستخدم.
2. تفعيل API لـ Secret Manager.
3. صلاحية `secretmanager.secretAccessor` لحساب الخدمة الذي تستخدمه دوال Vercel.
4. تقدير تكلفة الأسرار + عمليات الوصول.

لا يُفترض الجاهزية من هذه الوثيقة وحدها.

---

## 9. إعداد المزود — `networks/{networkId}`

```text
whatsappPrimaryProvider: "cloud_api" | "local_gateway"
whatsappCloudLinkStatus: "unlinked" | "linked" | "error"
whatsappPhoneNumberId: string | null
whatsappWabaId: string | null
whatsappDisplayHint: string | null
whatsappUpdatedAtMs: number
whatsappUpdatedBy: string
```

لا نسخة تحت `users/{uid}`.

---

## 10. سياسة الاحتفاظ + **حذف فعلي** (D5)

| البيانات | المدة | آلية الحذف |
|---|---|---|
| جسم Webhook الخام | لا يُخزَّن | — |
| نص الرسالة الواردة | ≤ 72 ساعة | حقل `textRetentionUntilMs` + مهمة حذف تصفّر/تحذف النص |
| سجل الحدث وبيانات المعالجة غير الحساسة | 90 يوماً | مهمة حذف دورية (Scheduler) على `receivedAtMs` |
| أسرار Meta | Secret Manager فقط | تدوير يدوي عند الحاجة |

- الحذف **فعلي** (delete/تحديث حقل النص) وليس مجرد تاريخ انتهاء للعرض.
- المهمة تُشغَّل عبر نفس مسار التعافي المجدول بسر الخدمة (أو مهمة منفصلة محمية).

---

## 11. التوجيه وSMS (D7)

1. مزود من وثيقة الشبكة فقط.
2. لا تبديل تلقائي بين Cloud وGateway.
3. فشل نهائي أو انقضاء المهلة → `sms_pending` → `sms_sent` مرة واحدة.
4. تأكيد متأخر → `delivered_late_after_sms`.
5. نفس `saleUuid`؛ لا حجز مخزون ثانٍ.

---

## 12. اختبارات قبل إعلان اكتمال الجزء الخادمي

1. توقيع Meta صحيح / خاطئ / غائب.
2. مفتاح الحدث يتضمّن `networkId`؛ شبكتان لا تتصادمان.
3. `create` مكرر على inbound وdelivery يفشل.
4. عميل يستدعي `dispatch` بـ `saleUuid` → رفض.
5. Fail-Closed بدون `whatsapp_card_delivery`.
6. مهلة 10ث → SMS مرة واحدة؛ تأكيد متأخر بلا SMS ثانٍ وبلا كرت ثانٍ.
7. استعادة عملية `processing` منتهية القفل دون مستند delivery جديد.
8. لا أسرار في الاستجابات/السجلات.
9. مهمة حذف النصوص بعد 72 ساعة (اختبار بتواريخ مزيّفة).

---

## 13. قائمة الإغلاق قبل إذن التنفيذ

| # | البند | الحالة في الوثيقة |
|---|---|---|
| 1 | هوية الحدث `{providerId}_{networkId}_{inboundMessageId}` + create | موثّق §3 |
| 2 | مرة واحدة على مستوى DB لـ delivery + SMS/تأخير | موثّق §4 |
| 3 | dispatch بسر خدمة فقط؛ لا ثقة ببيانات العميل | موثّق §5 |
| 4 | Cloud Tasks + Scheduler؛ رفض Vercel Cron كضمان | موثّق §6 |
| 5 | احتفاظ 72س / 90ي + حذف فعلي | موثّق §10 |
| 6 | التحقق الميداني من Secret Manager / IAM / التكلفة | **مطلوب قبل التنفيذ** — غير مُنجز هنا |

---

## 14. حدود الالتزام الحالي

- تحديث وثيقة فقط على `تكامل-مزايا-المدفوعة`.
- **لا كود** WhatsApp / Tasks / Secret Manager في هذا الـ Commit.
- لا تعديل `Krotak-Pro`، لا `main`، لا نشر إنتاج.
- **لا إذن تنفيذ** حتى موافقتك الصريحة بعد هذه التوضيحات.
- المرحلة 0 تبقى غير مكتملة حتى التنفيذ والاختبار الفعليين.
