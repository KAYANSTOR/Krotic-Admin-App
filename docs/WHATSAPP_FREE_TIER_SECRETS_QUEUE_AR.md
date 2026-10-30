# بدائل مجانية — أسرار WhatsApp وطابور التسليم (بدون فوترة GCP)

**الفرع:** `تكامل-مزايا-المدفوعة`  
**التاريخ:** 2026-10-30  
**يستبدل:** اعتماد Secret Manager وCloud Tasks كمسار إلزامي

---

## 1. الأسرار — Vercel Env + AES-256-GCM

### 1.1 أسرار مشتركة (متغيرات بيئة لكل بيئة Production / Preview / Development)

| المتغير | الغرض |
|---|---|
| `META_APP_SECRET` أو `WHATSAPP_META_APP_SECRET` | توقيع Webhook |
| `META_VERIFY_TOKEN` أو `WHATSAPP_META_VERIFY_TOKEN` | تحقق اشتراك Meta |
| `WHATSAPP_DISPATCH_SERVICE_SECRET` | استدعاء dispatch / purge |
| `WHATSAPP_SECRETS_KEK` | مفتاح تشفير رئيسي 32 بايت (base64) |
| `WHATSAPP_SECRETS_KEK_PREV` | اختياري أثناء تدوير المفتاح |
| `WHATSAPP_SECRETS_KEY_VERSION` | رقم إصدار يُختم على الأظرف الجديدة |

### 1.2 توكنات الشبكات (قابل للتوسع)

- **لا** متغير بيئة لكل شبكة.
- **لا** قائمة توكنات في متغير واحد.
- التخزين: `whatsapp_network_secrets/{networkId}.whatsappAccessTokenEnc` = ظرف AES-GCM فقط.
- AAD = `network:{networkId}` لربط التشفير بالشبكة.
- فك التشفير على الخادم فقط عند الإرسال.
- المجموعة **مغلقة** في Firestore Rules (`read, write: if false`).

### 1.3 تدوير المفتاح

1. ضع المفتاح القديم في `WHATSAPP_SECRETS_KEK_PREV`.
2. ضع المفتاح الجديد في `WHATSAPP_SECRETS_KEK` وارفع `KEY_VERSION`.
3. `decrypt` يجرّب الحالي ثم السابق.
4. مهمة إعادة تشفير اختيارية عبر `reencryptSecret` لكل شبكة.

### 1.4 الكود

- `server/_lib/whatsapp/cryptoSecrets.js`
- `server/_lib/whatsapp/secrets.js`
- `server/_lib/whatsapp/networkTokenStore.js`

---

## 2. الطابور — Firestore Queue

**المجموعة:** `whatsapp_delivery_queue/{jobId}`

| الحقل | المعنى |
|---|---|
| `status` | `queued` \| `processing` \| `completed` \| `failed` |
| `runAfterMs` | لا تُعالج قبل هذا الوقت |
| `lockOwner` / `lockUntilMs` | قفل عامل؛ بعد الانتهاء يمكن الاستعادة |
| `attempts` | عداد |

- `enqueue` بـ `create` ذري (نفس `jobId` = نفس `deliveryOperationId`).
- `claimNextJob` مع معاملة/قفل.
- الكود: `server/_lib/whatsapp/deliveryQueue.js`.

**قيود Vercel Cron (Hobby):** غالباً جدولة يومية فقط في الخطط المجانية — مناسب **للتعافي** لا لمهلة 10 ثوانٍ.

---

## 3. مهلة 10 ثوانٍ — تقييم صريح

**السياسة لم تتغير:** فشل نهائي أو غياب `delivered/read` خلال 10 ثوانٍ → SMS مرة واحدة على نفس العملية.

### هل تُحقَّق بدقة دون خدمة مدفوعة؟

| الآلية | دقة ~10ث | تكلفة | ملاحظة |
|---|---|---|---|
| `setTimeout` داخل دالة Vercel | غير موثوق | مجاني | الدالة قد تُجمَّد بعد الرد؛ **مرفوض كضمان** |
| Firestore Queue + `runAfterMs = now+10s` | يعتمد على من يوقظ العامل | مجاني | بدون موقظ كل بضع ثوانٍ لن تُلتقط المهلة |
| Vercel Cron Hobby | دقائق/يوم لا ثوانٍ | مجاني | تعافٍ فقط |
| Cron خارجي مجاني (مثلاً كل دقيقة) | ±60ث تقريباً | مجاني محدود | أفضل من اليومي؛ **ليس 10ث** |
| Cloud Tasks تأخير 10ث | دقيق | يتطلب فوترة GCP | كان المسار الأصلي |

**الخلاصة:** بدون خدمة جدولة بتأخير بالثواني (مدفوعة أو ذاتية الاستضافة)، **لا يمكن إثبات مهلة 10 ثوانٍ بصورة موثوقة**.  
ما يُنفَّذ الآن:

1. تسجيل `whatsappDeadlineAtMs = sentAt + 10000` على عملية التسليم.
2. إدراج مهمة طابور بـ `runAfterMs = deadline`.
3. عند تشغيل `dispatch` (يدوياً / تعافٍ / cron): إن انقضت المهلة ولم يُرسل SMS → SMS مرة واحدة.
4. Callbacks حالة Meta (`failed` / `delivered`) تُعالج فوراً عند وصول Webhook — هذا المسار **فوري** ولا يحتاج انتظار 10ث.

**خيارات إذا أردت دقة أقرب لـ 10ث لاحقاً (تحتاج موافقتك):**

| خيار | تقدير |
|---|---|
| تفعيل فوترة GCP + Cloud Tasks | أدق؛ تكلفة منخفضة عادة |
| عامل صغير على VPS/RPi يستعلم الطابور كل 5ث | مجاني ذاتي؛ صيانة |
| قبول نافذة تعافٍ ~1 دقيقة عبر cron خارجي | مجاني؛ انحراف عن العقد الحرفي |

**لن نغيّر رقم 10 ثوانٍ في السياسة دون قرار منك.**

---

## 4. تعديلات على ملفات الدفعة الأولى

| ملف | التغيير |
|---|---|
| `secrets.js` | من Secret Manager → env + AES-GCM |
| `dispatchHandler.js` | يستهلك طابور Firestore لاحقاً؛ لا Tasks |
| `webhookHandler.js` | بدون تغيير جوهري |
| قواعد Firestore | إغلاق `whatsapp_delivery_queue` و`whatsapp_network_secrets` |

---

## 5. ما لم يُفعَّل بعد

- وضع أسرار حقيقية في Vercel
- إرسال WhatsApp/SMS حقيقي
- Cron خارجي أو Tasks
- المرحلة 0 ما زالت غير مكتملة
