# عقد التكامل المحدّث بين لوحة الإدارة وتطبيق Android (Krotak Pro) — المرحلة 1

**الإصدار:** `1.0.0` (Contract Versioned)  
**الحالة:** عقد رسمي وموحّد لربط لوحة الإدارة (`KAYANSTOR/Krotic-Admin-App`) بتطبيق Android (`KAYANSTOR/Krotak-Pro`).  
**حدود الأمان والنطاق:**
- هذا المستند يوثق بنية البيانات الرسمية، وحالات دورة التطبيق، وعقد استلام إشعار التطبيق الفعلي (ACK).
- لا يعدّل هذا العمل أي ملف داخل مستودع Android `KAYANSTOR/Krotak-Pro`.
- جميع الأمثلة الواردة في هذا العقد نماذج اصطناعية معلّمة بوضوح بـ `_nonProduction: true` لمنع استخدامها في الإنتاج.

---

## 1. قوالب التحويل الواردة (Inbound Transfer Templates)

تُعرّف القوالب المستخدمة لتحليل رسائل التحويل والإيداع البنكي الواردة عبر SMS أو إشعارات التطبيقات المحلية.

### جدول مطابقة الحقول بين لوحة الإدارة ومستهلك Android:

| حقل لوحة الإدارة | النوع | قيد التحقق الخادمي | مستهلك Android (مستودع `Krotak-Pro`) | الملاحظات والقرارات |
|---|---|---|---|---|
| `id` | `string` | معرّف آمن ثابت `^[A-Za-z0-9_-]{1,128}$` | جدول Drift: `transfer_templates.id` | المفتاح الأساسي؛ لا يعاد استخدامه بعد الإنشاء |
| `name` | `string` | نص عربي/إنجليزي (1–120 حرف) | `transfer_templates.name` | الاسم المعروض للقالب في الواجهة |
| `pattern` | `string` | نص (1–500 حرف)، يلزم وجود `{amount}` إلا في طلب الرصيد | `transfer_templates.pattern` | يدعم `{amount}`, `{phone}`, `{account}`, `{ref}`, `{qty}`, `{dest}` |
| `walletId` | `string` | يطابق معرّف محفظة معلن في `wallets` | `transfer_templates.wallet_id` | ربط القالب بمصدر الرسائل حصراً |
| `posId` | `string \| null` | معرّف نقطة بيع آمن (اختياري) | `transfer_templates.pos_id` | ربط القالب بنقطة بيع محددة |
| `priority` | `integer` | عدد صحيح بين 0 و9999 | `transfer_templates.priority` | أولوية المطابقة في المحلل (الأقل رقماً يُفحص أولاً) |
| `isActive` | `boolean` | قيمة منطقية صريحة | `transfer_templates.is_active` | تفعيل/تعطيل القالب محلياً |
| `requireReference`| `boolean` | قيمة منطقية صريحة | `transfer_templates.require_reference`| عند `true` يلزم وجود `{ref}` في النمط والرسالة |
| `identifierKind` | `enum` | أحد: `phone`, `alternativeNumber`, `account`, `senderNameOnly`, `balanceRequestCode` | `transfer_templates.identifier_kind` | يحدد نوع المعرّف المستخرج |
| `sampleBody` | `string \| null` | نص (حتى 2000 حرف) | `transfer_templates.sample_body` | عينة الرسالة لاختبار ومحاكاة المحلل |
| `senderCode` | `string \| null` | نص (حتى 120 حرف) | `transfer_templates.sender_code` | رمز مرسل إضافي إن وجد |
| `senderNameLabel`| `string \| null` | نص (حتى 120 حرف) | `transfer_templates.sender_name_label` | تسمية الحقل المعروض |
| `noteLabel` | `string \| null` | نص (حتى 120 حرف) | `transfer_templates.note_label` | تسمية الملاحظة |

---

## 2. الرسائل الصادرة (Outbound Templates)

تُفصل قوالب الرسائل الصادرة صراحة عن إشعارات Firebase Cloud Messaging (FCM):
- **إشعارات FCM:** إشعارات إدارية ترسل إلى أجهزة مستخدمي الإدارة والعملاء عبر Firebase Messaging.
- **الرسائل الصادرة:** قوالب نصوص SMS ترسل من جهاز المستخدم أو نقطة البيع إلى الزبائن لتسليم الكروت أو تأكيد السداد أو الرصيد.

### جدول مطابقة الرسائل الصادرة:

| مفتاح القالب في الإدارة | النطاق (`scope`) | المتغيرات الإلزامية | المتغيرات المسموحة | مستهلك Android |
|---|---|---|---|---|
| `voucher_delivery_sms_template` | `outboundCustomer` | `secret` | `serial`, `card_value`, `category`, `network_name`, `customer_phone` | `OutboundTemplateCatalog` |
| `pos_customer_card_delivery_template` | `outboundCustomer` | `cards` | `pos_name`, `network_name`, `customer_phone` | `OutboundTemplateCatalog` |
| `customer_debt_payment_template` | `outboundCustomer` | `amount` | `customer_phone`, `remaining`, `network_name` | `OutboundTemplateCatalog` |
| `pos_order_success_template` | `outboundPos` | `quantity_text` | `pos_name`, `pos_id`, `amount`, `network_name` | `OutboundTemplateCatalog` |
| `pos_instant_charge_confirm_template` | `outboundPos` | `amount`, `customer_phone` | `pos_name`, `pos_id`, `network_name` | `OutboundTemplateCatalog` |
| `low_stock_alert_template` | `outboundSystem` | `category` | `count`, `network_name` | `OutboundTemplateCatalog` |

---

## 3. المحافظ بوصفها مصادر رسائل (Wallets as Message Sources)

**قاعدة صارمة:** المحفظة في هذا التكامل هي **مجرّد مصدر رسائل (SMS/Notification source)** وليست حساباً مالياً أو رصيداً نقدياً. يُمنع منعاً باتاً إضافة أي حقول أرصدة مالية، دفاتر حسابات، أو عمولات في كائن المحفظة.

### جدول مطابقة حقول المحفظة:

| الحقل في الإدارة | النوع | القيد الخادمي | مستهلك Android | الدلالة |
|---|---|---|---|---|
| `id` | `string` | معرّف فريد ثابت `^[A-Za-z0-9_-]{1,128}$` | `wallets.id` (Drift) | المفتاح الأساسي للمحفظة |
| `name` | `string` | نص معروض (1–120 حرف) | `wallets.name` (Drift) | اسم المحفظة/البنك في الواجهة |
| `status` | `enum` | `active`, `suspended`, `archived` | `wallets.status` (Drift) | حالة تفعيل مصدر الرسائل |
| `sourceMode` | `enum` | `sms` أو `notification` | `wallet_extras.sourceMode` | نوع المصدر: قراءة SMS أو الاستماع لإشعارات التطبيق |
| `senderId` | `string \| null`| نص (حتى 120 حرف) | `wallet_extras.senderId` | اسم المرسل في رسائل SMS (مثال: Kuraimi) |
| `packageName` | `string \| null`| معرّف حزمة Android (حتى 200 حرف) | `wallet_extras.packageName` | اسم الحزمة المطلوب لتطبيق المحفظة عند `sourceMode == 'notification'` |
| `createdAt` | `string` | تاريخ ISO8601 صالح | `wallets.createdAt` (Drift) | وقت إنشاء المصدر |

---

## 4. حالات دورة حياة التطبيق على Android (Application Lifecycle States)

تعتمد لوحة الإدارة الحالات التالية بدقة، مع منع عرض "مطبّق على الجهاز" دون ورود ACK موثوق:

1. **`Draft` (مسودة):** مسودة قيد الإعداد في لوحة الإدارة، غير منشورة ولا يستطيع أي تطبيق سحبها.
2. **`Published centrally` (منشور مركزياً):** تم نشر الإصدار ذرياً في `template_center_releases` وتحديث مؤشر النطاق، وهو متاح للجلب بواسطة أجهزة Android المؤهلة، لكن لم يرد إشعار بتطبيقه على الجهاز المقصود بعد.
3. **`Fetched` (تم الجلب):** قام تطبيق Android بطلب الإصدار وسحبه بنجاح من الخادم.
4. **`Cached` (محفوظ مؤقتاً):** تم تخزين حزمة الإصدار في التخزين المؤقت المحلي للتطبيق تمهيداً لدمجه.
5. **`Applied locally` (مطبّق محلياً):** تم دمج عناصر الإصدار بنجاح في قاعدة Drift المحلية على الجهاز.
6. **`Parser refreshed` (المحلل محدّث ومفعّل):** أتم محرك التحليل المحلي إعادة التهيئة واعتماد القوالب الجديدة واجتاز الفحص الداخلي. هذه هي الحالة الوحيدة التي تؤكد التشغيل الكامل.
7. **`Failed / Conflict` (فشل أو تعارض):** فشل التطبيق المحلي بسبب تعارض في القيود أو عدم مطابقة البصمة، مع تسجيل سبب الفشل صراحة.
8. **`Unknown` (غير معروف):** لا توجد بيانات كافية أو الإصدار المبلغ عنه قديم مقارنة بالإصدار المنشور.

---

## 5. عقد ACK من Android (Android Application Acknowledgement Contract)

### المسار الخادمي:
`POST /api/template-center` مع الهيدر `Authorization: Bearer <Firebase ID Token>` وجسم الطلب:
```json
{
  "action": "ack",
  "ack": {
    "schemaVersion": 1,
    "installationId": "<Android Installation UUID>",
    "releaseId": "<Release ID e.g. rel-global-v1>",
    "payloadHash": "<64-hex SHA-256 hash>",
    "status": "applied",
    "appliedAt": 1700000000000,
    "walletsCount": 6,
    "transferTemplatesCount": 12,
    "outboundTemplatesCount": 8,
    "conflictsCount": 0,
    "parserRefreshed": true,
    "appVersion": "1.0.15",
    "appBuild": 15
  }
}
```

### شروط وضوابط العقد:
1. **المصادقة:** يُستخرج `uid` حصراً من رمز Firebase ID Token في الخادم.
2. **التحقق من البصمة:** يعيد الخادم التحقق من مطابقة `payloadHash` لبصمة الإصدار الفعلي المنشور. أي اختلاف يُرفض بـ `400 payload_hash_mismatch`.
3. **Idempotency:** كتابة الـ ACK في Firestore تستخدم المستند:
   `template_center_device_acks/{uid}_{installationId}_{releaseId}`
   إعادة إرسال نفس الطلب تحدّث نفس المستند ذرياً دون تكرار سجلات.
4. **السرية والخصوصية:** لا يُسمح بإرسال أي نصوص رسائل خاصة بالزبائن أو أسرار أو تفاصيل مالية في حمولة ACK.
5. **الاعتماد الخارجي:** تطبيق Android الحالي في مستودع `Krotak-Pro` يحتاج بناء خدمة إرسال الـ ACK بعد إنهاء كتابة Drift. حتى يتم ذلك، تسجل لوحة الإدارة الحالة كـ `Published centrally (بانتظار مزامنة الجهاز)`.

---

## 6. الاستحقاق المدفوع: فصل خريطة المزايا عن عقد Lease الموقّع

### الفصل البنيوي:
1. **خريطة المزايا (`feature_entitlements`):**
   تحدد ما يحق لنوع الحساب استخدامه (مثل الحد الأقصى لنقاط البيع، دعم إشعارات التطبيقات، المزامنة دون اتصال).
2. **عقد الترخيص الموقع (`Signed Lease`):**
   حمولة JSON صادرة عن الخادم وموقعة بمفتاح Ed25519 خادمي خاص ومربوطة بـ `installationId` و`expiry` صارم، هدفها إثبات ترخيص التشغيل للجهاز ومصادقة وقت الخادم.

### جدول مطابقة حالات الاستحقاق:

| الحالة في الإدارة | المعنى | سلوك عقد Lease الموقّع | مستهلك Android |
|---|---|---|---|
| `TRIAL` | فترة تجريبية نشطة | يصدر عقد Lease حتى نهاية مدة التجربة | يتحقق من توقيع Ed25519 ومطابقة الجهاز |
| `ACTIVE_PAID` | اشتراك مدفوع معتمد | يصدر عقد Lease حتى نهاية فترة الاشتراك | يتحقق من توقيع Ed25519 ومطابقة الجهاز |
| `LOCKED_EXPIRED` | منتهي الصلاحية ومقفل خادمياً | يُرفض إصدار Lease بـ `403` | يقفل الوظائف التجارية ويمنع المبيعات الجديدة |
| `SUSPENDED_MANUAL` | معلق يدوياً بقرار إداري | يُرفض إصدار Lease بـ `403` | يمنع الوصول حتى فك التعليق |
| `Unknown / يحتاج قراراً` | حساب قديم أو غير مكتمل | لا يصدر عقد Lease حتى تسوية السجل | يعامل كغير مؤهل حتى تحديث بياناته |
