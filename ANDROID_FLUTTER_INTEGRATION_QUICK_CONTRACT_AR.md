# عقد التكامل السريع — تطبيق Flutter Android مع Krotak Pro

**الحالة:** عقد التنفيذ الحالي في الإنتاج  
**تاريخ التحقق:** 2026-10-15  
**مشروع Vercel:** `krotak-pro`  
**النشر الإنتاجي المتحقق:** `READY` على فرع `main`، والواجهة تستجيب من الرابط الأساسي.

> هذه الوثيقة مبنية على كود الخادم الفعلي في `api/network-secret.js` و`api/sales/ingest.js` واختبارات العقد، وليست مواصفة تخمينية.

## 1. الرابط الأساسي ونقاط النهاية

### الرابط الأساسي المعتمد

```text
https://krotak-pro.vercel.app
```

لا تُضمّن `/` إضافية عند تركيب المسار.

### أ) جلب مفتاح الشبكة الخاص

```http
POST https://krotak-pro.vercel.app/api/network-secret
Authorization: Bearer <FIREBASE_ID_TOKEN>
Accept: application/json
```

- لا يوجد جسم JSON مطلوب؛ أرسل الطلب بدون معاملات.
- يجب أن يكون التوكن **Firebase ID token** صالحاً للمستخدم الحالي، وليس Firebase refresh token.
- الخادم يستخرج `uid` من التوكن، ولا يقبل `uid` من جسم الطلب.
- يجب أن يكون الحساب عميلاً مهيأً وله شبكة؛ حساب المدير يعاد له `403`.

الاستجابة الناجحة `200`:

```json
{
  "success": true,
  "networkId": "<NETWORK_ID>",
  "networkSecret": "<NETWORK_SECRET>",
  "signatureAlgorithm": "HMAC-SHA256",
  "signatureHeader": "x-verification-receipt",
  "policyVersion": 1
}
```

احفظ `networkSecret` في **Android Keystore** فقط. لا تسجله في Logcat، ولا تضعه داخل APK أو Firestore، ولا تستخدم `KROTAK_HMAC_SECRET` في التطبيق؛ ذلك سر خادمي مختلف تماماً.

### ب) رفع عملية بيع

```http
POST https://krotak-pro.vercel.app/api/sales/ingest
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
Accept: application/json
x-verification-receipt: <TIMESTAMP_MS>.<LOWERCASE_HEX_HMAC>
```

تم التحقق من أن GET على المسارين يعيد `405 method_not_allowed` مع `Allow: POST`؛ لذلك استخدم `POST` فقط.

## 2. التوثيق وتوقيع HMAC

يجب إرسال طبقتين معاً:

1. `Authorization: Bearer <Firebase ID token>`.
2. `x-verification-receipt` بتوقيع HMAC لمفتاح الشبكة.

### ما الذي يتم توقيعه؟

لا يتم توقيع Raw JSON body كما أرسله Flutter، ولا ترتيب حقول JSON العام. الخادم يبني تمثيلاً canonical ثابتاً بالترتيب التالي:

```json
{"saleId":"<SALE_UUID>","uid":"<FIREBASE_UID>","amountMinor":150000,"currencyCode":"YER","customerId":"<CUSTOMER_ID_OR_NULL>","cardId":"<CARD_ID_OR_NULL>","createdMs":1700000000000}
```

القواعد الدقيقة:

- `saleId` = قيمة `saleUuid` المرسلة؛ ويمكن إرسال `saleId` كاسم قديم.
- `uid` = Firebase UID المستخرج من ID token.
- `currencyCode` = uppercase، والقيمة المقبولة حالياً هي `YER` فقط.
- `customerId` و`cardId` يصبحان `null` إذا لم يرسلهما التطبيق.
- `createdMs` = وقت إنشاء البيع بالميلي ثانية منذ Unix epoch.
- يجب إنتاج JSON canonical بدون مسافات وبالترميز UTF-8.

الصيغة التي يوقعها التطبيق هي:

```text
<TIMESTAMP_MS>.<CANONICAL_JSON>
```

ثم:

```text
HMAC-SHA256(key = networkSecret, message = timestampMs + "." + canonicalJson)
```

قيمة الرأس النهائية:

```text
x-verification-receipt: <TIMESTAMP_MS>.<64_HEX_CHARACTERS>
```

- التوقيع hex صغير الأحرف (`lowercase hexadecimal`).
- نافذة صلاحية الطابع الزمني: ±5 دقائق من وقت الخادم.
- لا تستخدم Base64 للتوقيع.
- لا تعتمد على `payloadHash` لتكوين التوقيع؛ هو اختياري للتشخيص فقط، والخادم يعيد حسابه.

### `payloadHash` الاختياري

إذا أرسله التطبيق في JSON، فيجب أن يساوي:

```text
SHA-256(CANONICAL_JSON)
```

بـ lowercase hex. إذا كان غير مطابق، يعاد `400 payload_hash_mismatch`.

> **وحدة المال عند حدود API:** يرسل Flutter `amountMinor` بوحدات العملة الصغرى، بينما يعتمد دفتر الشبكة والتقارير أعدادًا صحيحة من الريالات اليمنية. يحوّل الخادم المبلغ بقسمة صحيحة على 100 بعد التحقق من عدم وجود كسور. `amountRiyal` و`commissionRiyal` هما الحقلان الماليان المرجعيان في مخطط V2؛ لا تغيّر أسماء أو ترتيب حقول canonical الموقعة.

## 3. جسم طلب رفع البيع

الحقول المطلوبة:

| الحقل | النوع | مطلوب | القاعدة |
|---|---|---:|---|
| `saleUuid` | string | نعم | من 1 إلى 128 حرفاً، النمط `[A-Za-z0-9_-]+` |
| `amountMinor` | integer | نعم | وحدات Android الصغرى؛ يجب أن يقبل القسمة على 100، والحد `100000000000000` |
| `currencyCode` | string | نعم | `YER` فقط، ويُحوّل الخادم إلى uppercase |
| `createdMs` | integer/number | نعم | وقت Unix بالميلي ثانية، أكبر من صفر |
| `customerId` | string | لا | حتى 128 حرفاً |
| `cardId` | string | لا | حتى 128 حرفاً |
| `payloadHash` | string | لا | SHA-256 للـ canonical JSON فقط |

مثال صالح:

```json
{
  "saleUuid": "sale_abc-123",
  "amountMinor": 1500,
  "currencyCode": "YER",
  "createdMs": 1700000000000,
  "customerId": "cust-1",
  "cardId": "card-9",
  "payloadHash": "<64-CHAR-SHA256-HEX>"
}
```

> لا يرسل التطبيق `commission` أو `commissionAmount` أو `netAmount` أو `status` كحقائق مالية. الخادم يحسب العمولة ويحفظ الحالة المعتمدة بنفسه.

## 4. الاستجابات

### إنشاء جديد — `201 Created`

```json
{
  "success": true,
  "status": "CREATED",
  "policyVersion": 1,
  "saleId": "sale_abc-123",
  "saleUuid": "sale_abc-123",
  "payloadHash": "<64-CHAR-SHA256-HEX>",
  "commissionMinor": 75,
  "commissionRateBps": 500
}
```

`commissionMinor` و`commissionRateBps` قيم خادمية؛ لا تعيد حسابها لتقرير اعتماد البيع.

### العملية موجودة مسبقاً — `200 OK`

```json
{
  "success": true,
  "status": "ALREADY_EXISTS_ACKED",
  "ack": true,
  "policyVersion": 1,
  "saleId": "sale_abc-123",
  "saleUuid": "sale_abc-123",
  "samePayload": true
}
```

- أعد إرسال نفس `saleUuid` عند إعادة المحاولة بعد انقطاع الشبكة؛ لا تنشئ UUID جديداً.
- إذا كان المعرّف موجوداً لكن المحتوى مختلف، يبقى الرد نجاحاً بالحالة نفسها، مع `samePayload: false`، ويسجل الخادم التعارض للتدقيق.
- اعتبر كلتا الحالتين `201` و`200 ALREADY_EXISTS_ACKED` تأكيداً ناجحاً للمزامنة المحلية.

### أخطاء مهمة

| HTTP | `error` | المعنى |
|---:|---|---|
| `400` | `sale_id_required`, `amount_invalid`, `currency_invalid`, `created_at_invalid` | بيانات البيع غير صالحة |
| `400` | `payload_hash_mismatch` | الهاش المرسل لا يطابق canonical JSON |
| `401` | `missing_token`, `invalid_token` | توثيق Firebase مفقود/غير صالح |
| `401` | `hmac_invalid` أو `hmac_expired_or_malformed` | التوقيع مفقود أو غير صالح/منتهي |
| `403` | `not_client_account` أو `network_owner_mismatch` | الحساب ليس عميلاً أو لا يملك الشبكة |
| `409` | `network_not_provisioned` أو `network_secret_not_provisioned` | تهيئة الشبكة غير مكتملة |
| `503` | `hmac_not_configured` أو `network_secret_unavailable` | خلل إعداد خادمي؛ لا تعالج بتغيير APK |

## 5. متغيرات بناء Flutter (`--dart-define`)

### ما يطلبه الخادم فعلياً

لا يعرّف مستودع الخادم أي اسم `--dart-define`، ولا يعتمد عليه في قراءة الطلبات. لذلك **لا يوجد متغير Dart إلزامي صادر من الخادم**، ولا ينبغي تمرير أي سر HMAC في build command.

### الاتفاق المقترح لتطبيق Flutter

إذا كان تطبيق Flutter يقرأ إعداد الرابط من `String.fromEnvironment`، استخدم اسماً واحداً واضحاً وطبّقه في كود التطبيق:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://krotak-pro.vercel.app
```

هذا اسم إعداد **على مستوى تطبيق Flutter** وليس متغيراً يقرأه الخادم. لا تضف `networkSecret` أو `KROTAK_HMAC_SECRET` إلى `--dart-define`.

مصادقة Firebase وإعدادها تكون عبر Firebase Android configuration (`google-services.json` / Firebase SDK) وفق مشروع التطبيق، وليست أسماء `--dart-define` مثبتة في مستودع الخادم. إذا كان مشروع Flutter الحالي يستخدم اسماً مختلفاً، يجب توحيده في كود Flutter قبل التسليم؛ لا يمكن استنتاج اسمه من هذا المستودع لأنه لا يحتوي ملفات Dart أو `pubspec.yaml`.

## 6. ترتيب التنفيذ في التطبيق

1. سجّل دخول المستخدم عبر Firebase واحصل على ID token.
2. نفّذ `POST /api/network-secret` مع `Authorization`.
3. خزّن `networkSecret` في Android Keystore.
4. لكل عملية بيع، ثبّت `saleUuid` و`createdMs` محلياً.
5. أنشئ canonical JSON بنفس الترتيب والقواعد أعلاه.
6. أنشئ `x-verification-receipt` بالطابع الحالي وتوقيع HMAC-SHA256.
7. نفّذ `POST /api/sales/ingest` وأرسل نفس `saleUuid` عند إعادة المحاولة.
8. اعتبر `201 CREATED` و`200 ALREADY_EXISTS_ACKED` ACK ناجحاً، ثم احذف/علّم عنصر outbox المحلي كمؤكد.

## 7. مراجع التحقق

- `api/network-secret.js`
- `api/sales/ingest.js`
- `test/salesIngest.test.js`
- `test/ingestAck.test.js`
- `test/networkSecret.test.js`

تم تشغيل اختبارات العقد المستهدفة بعد تثبيت اعتماديات المشروع: **13 اختباراً ناجحاً، 0 فشل**. كما تم فحص الرابط الإنتاجي مباشرة؛ كلا المسارين يعيدان `405` عند استخدام GET ويعلنان `Allow: POST`، وهو السلوك المتوقع.
