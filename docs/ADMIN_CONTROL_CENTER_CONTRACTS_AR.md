# عقود مركز الإدارة (قوالب / رسائل صادرة / محافظ / مزايا مدفوعة / ACK)

> **ملاحظة superseded — 2026-10-23:** أجزاء `feature_entitlements` وACK التاريخي هنا لم تعد العقد المعتمد. المرجع الحالي هو `docs/ACCOUNT_FEATURES_ACK_CONTRACT_AR.md`: `account_features` فقط، وACK latest-only عبر Vercel في `users/{uid}/template_acks/{deviceId}`.

> **الحالة:** المرحلة 1 — تثبيت العقود والحالات قبل بناء الشاشات. هذه الوثيقة
> والمخططات في `contracts/` **عقود إصدار (versioned)** قابلة للاختبار، وليست
> إعلانًا بأن أي شيء منفَّذ على Android أو منشور في الإنتاج.
> **الفرع:** `feature/krotak-admin-control-center` (لا دمج، لا نشر).
> **المرجع الحي:** قراءة فقط لمستودع `KAYANSTOR/Krotak-Pro` (فرع
> `plan/krotak-android-template-sync`). لم يُعدَّل أي ملف Android.

## 1. حدود هذه المرحلة

- لا endpoint جديد، ولا دالة Vercel جديدة، ولا تعديل على `vercel.json` أو القواعد.
- لا كتابة على أي بيئة (لا Firestore، لا Firebase Admin، لا Vercel).
- لا شاشة إدارية جديدة بعد. الشاشات تأتي بعد تثبيت العقد (المرحلة التالية).
- كل الأمثلة اصطناعية ومعلّمة `_synthetic`. لا بيانات عميل حقيقية.

## 2. المخططات والاختبارات

| العقد | المخطط | الاختبار |
|---|---|---|
| محفظة (مصدر رسائل) | `contracts/schemas/wallet.schema.json` | `test/contracts.test.js` |
| قالب تحويل وارد | `contracts/schemas/inbound-template.schema.json` | `test/contracts.test.js` |
| قالب رسالة صادرة | `contracts/schemas/outbound-template.schema.json` | `test/contracts.test.js` |
| حمولة إصدار مركزي | `contracts/schemas/template-release.schema.json` | `test/contracts.test.js` |
| ACK من Android (مقترح) | `contracts/schemas/android-ack.schema.json` | `test/contracts.test.js` |
| حالة التطبيق على Android | `contracts/schemas/android-application-state.schema.json` | `test/contracts.test.js` |
| خريطة المزايا المدفوعة | `contracts/schemas/feature-entitlements.schema.json` | `test/contracts.test.js` |
| ملخص مخزون الكروت (من Android) | `contracts/schemas/inventory-snapshot.schema.json` | `test/contracts.test.js` |

الأمثلة في `contracts/fixtures/` مطابقة للمخططات، ويُتحقَّق منها في الاختبارات.
كما يجري الاختبار مطابقة **حقيقية** لحمولة الإصدار مقابل التحقق الخادمي الفعلي
`server/_lib/templateCenter.js` (`validateTemplatePayload` بوضع النشر
`allowDrafts:false`)، ومطابقة مفتاح قالب الصادر ومتغيراته مع كتالوج الخادم
`getTemplateCenterCatalog()` — بلا أي mock.

## 3. حالات التطبيق على Android (منفصلة)

المرجع: `contracts/schemas/android-application-state.schema.json`.

| الحالة | المعنى | الإثبات المطلوب للعرض |
|---|---|---|
| `Draft` | مسودة في لوحة الإدارة، لم تُنشر. | لا شيء (لم تُنشر). |
| `PublishedCentrally` | إصدار منشور مركزيًا (وُجد في `template_center_releases` والمؤشر يشير إليه). | قراءة الخادم. |
| `Fetched` | التطبيق جلب الإصدار من `read-active`. | قراءة الخادم/سجل الجلب. |
| `Cached` | الإصدار محفوظ كآخر نسخة سليمة محليًا. | cache محلي. |
| `AppliedLocally` | طُبِّق على المخازن المحلية. | **ACK موثوق** (`evidence=ack`, `outcome=applied`). |
| `ParserRefreshed` | أُعيد بناء محرك التحليل بعد التطبيق. | **ACK موثوق** مع `parserRefreshed=true`. |
| `Unknown` | لا إثبات متاح. | لا شيء. |

قاعدة صارمة: **لا يُعرض «مطبق على الجهاز»** (`AppliedLocally`/`ParserRefreshed`)
بناءً على نجاح حفظ أو نشر مركزي، ولا بناءً على `Fetched`/`Cached`. يحتاج ACK
يطابق الإصدار والبصمة والجهاز.

## 4. عقد ACK من Android (المستقبل منفَّذ — المرسل في Android غير منفّذ)

المرجع: `contracts/schemas/android-ack.schema.json`.

الحقول: `ackVersion=1`, `uid`, `installationId`, `releaseId`, `payloadHash`,
`scopeKey`/`scope`, `outcome`, `appliedAt`, `insertedCount`, `conflictCount`,
`parserRefreshed`, `failureReason`, `appVersion`, `appBuild`.

- **Idempotency:** المفتاح الفعلي `(uid, installationId, releaseId, payloadHash, outcome)`؛
  إعادة الإرسال بنفس المفتاح لا تنشئ سجلًا ثانيًا.
- **لا أسرار ولا محتوى رسائل:** أعداد ورموز حالة فقط. الحقول غير المعروفة تُرفض.
- **التحقق الخادمي (منفَّذ):** يُستخرج `uid` من Firebase ID token لا من الحقل،
  ويُقارَن `installationId` بـ `users/{uid}.entitlementInstallationId` إن كان مربوطًا،
  ويُطابَق `payloadHash` مع `payloadHashSha256` في وثيقة الإصدار، ويُطابَق `scopeKey`.

**المستقبل الخادمي (منفَّذ في هذه المهمة):**

- المسار: `POST /api/template-center?__apiRoute=template-center` مع `action=ack`
  (عبر `api/router.js` ← `server/apiHandlers/settings.js` — بلا دالة Vercel جديدة).
- الكود: `server/_lib/templateCenterAck.js` (تحقق + idempotency) و`handleAck`
  في `server/_lib/templateCenterApi.js` (مصادقة + كتابة).
- التخزين: مجموعة `template_center_acks` بمعرّف حتمي؛ تُعرض في `action=list`
  كحقل `acks` (فقط السجلات `verified=true` تُستخدم لإثبات حالة الجهاز).
- حالات الرفض: `401` (بلا رمز)، `403` (`uid_mismatch` / `installation_mismatch`)،
  `404` (`release_not_found`)، `409` (`release_not_published` / `payload_hash_mismatch`
  / `scope_mismatch`)، `400` (شكل غير صالح).

**الاعتماد الخارجي المتبقي (مُسجَّل بدقة):** لا يوجد في مستودع Android أي مُرسل
لهذا ACK. حالة Android الحالية: `TemplateCenterService.sync`
و`TemplateCenterActivationService` (معطّلة خلف `_templateCenterActivationEnabled=false`)
تحفظان الإصدار محليًا لكنهما **لا تُرسلان ACK**. لذلك تبقى حالة الأجهزة في اللوحة
`Unknown` حتى يُنفَّذ الإرسال في مستودع Android — وهو ممنوع في هذه المهمة. هذا
العمل يُجهّز المستقبل ويُوثّق العقد وينتظر قرار المالك بإنفاذ الإرسال في Android.

### 4.2 حالة التحقق 2026-10-22 (ما أُثبت وما بقي `Unknown`)

هذا القسم سجل أدلة، لا تغيير في العقد. `ackVersion` يبقى **1**.

**أُثبت:**
- المستقبل الخادمي موجود ومختبر: `server/_lib/templateCenterAck.js` +
  `handleAck` + `test/templateCenterAck.test.js` و`test/templateAckContract.test.js`.
- المخططات `contracts/schemas/android-ack.schema.json` و
  `android-application-state.schema.json` مطابقة لـfixtures ومغطاة بـ
  `test/contracts.test.js`.

**`Unknown` (لم أستطع إثباته من هذه البيئة):**
- وجود/غياب مستهلك المزايا المدفوعة في Android (`PaidFeature`/`PaidFeatureGate`).
  تحقق الوكيل السابق (2026-10-21) قال: **غير موجود** في `Krotak-Pro@main`.
  محاولتي اليوم لإعادة التحقق فشلت: `gh api repos/KAYANSTOR/Krotak-Pro/...`
  أعاد **404** لهذا التكامل، و`search/code` أعاد 0 نتيجة مع
  `incomplete_results=true`. لذلك **لا أعيد تأكيد النتيجة ولا أنفيها**، وأعتمد
  على سجل 2026-10-21 الموسوم صراحةً بأنه من وكيل آخر.
- أثر أي حفظ مزايا مدفوعة على جهاز فعلي: **`Unknown` ولا يُدّعى**.

**فجوة عقد يجب حسمها (لا أختارها من عندي):**
- العقد الحالي يوثّق **نتيجة parser** (`parserRefreshed`) لكنه **لا يحمل حقلًا
  لنتيجة renderer** (إعادة بناء عرض القوالب/الرسائل). المطلوب من مالك العقد أو
  وكيل Android قرار: هل تُضاف `rendererRefreshed` (nullable) في `ackVersion=1`
  كحقل اختياري، أم تُؤجَّل إلى `ackVersion=2`؟ حتى ذلك الحين أي ادعاء عن حالة
  renderer على الجهاز = `Unknown`.
- `appliedAt` ساعة الجهاز: تشخيصي فقط. لا يُستخدم لقياس زمني أو إثبات ترتيب.

**قاعدة عرض ثابتة:** لا يُعرض «مطبق على الجهاز» إلا بـ`evidence=ack` و
`outcome=applied` وسجل `verified=true`. `Fetched`/`Cached` لا تعني تطبيقًا.

## 4.1 كتالوج الزرع الافتراضي (مطابقة معرّفات Android)

المرجع التنفيذي: `src/lib/androidSeedCatalog.js` (مصدر واحد)، وتُبنى منه
`src/lib/bundledTemplatePack.js` («تحميل إلى المسودة»). مستخرج **قراءةً فقط**
من الـseeders الرسمية في Android:

| المصدر في Android | ما يقابله في اللوحة |
|---|---|
| `default_wallet_specs.dart` (`DefaultWalletSpecs.all`) | `ANDROID_DEFAULT_WALLETS` (ست محافظ) |
| `default_wallet_templates_seeder.dart` (`_specs`) | `ANDROID_DEFAULT_INBOUND_TEMPLATES` |
| `default_pos_templates_seeder.dart` (3 قوالب) | `ANDROID_DEFAULT_POS_TEMPLATE_SPECS` (مرجع؛ معرّفها يعتمد `posId`) |
| `outbound_template_catalog.dart` + `setting.dart` | `ANDROID_DEFAULT_OUTBOUND_TEMPLATES` |

قواعد ثابتة:
- **معرّف قالب التحويل الوارد** = `tpl-default-<senderCode-lowercased-hyphenated>-<variant>`
  وهو نفسه الذي يزرعه Android حرفيًا، فلا يُنشئ الاستيراد/النشر نسخة مكررة.
- **مفتاح القالب الصادر** = مفتاح الإعداد في Android (`SettingKeys.*`).
- أُضيفت إلى كتالوج الخادم خمسة مفاتيح صادر كان Android يطابقها ولا يعرفها الخادم
  سابقًا: `card_delivery_{cash,credit,gift}_template`, `salafni_card_delivery_template`,
  `deposit_no_stock_template`. صارت الآن **مطلوبة الوجود** ويحميها الاختبار باسم
  `ANDROID_OUTBOUND_KEYS_REQUIRING_SERVER_REGISTRATION` (كان الاسم القديم
  `OUTBOUND_KEYS_MISSING_FROM_SERVER_CATALOG` يصف حالة لم تعد قائمة).
- **مرحلة توحيد القوالب (المرحلة 4):** أُضيفت مفاتيح Android الجديدة إلى الكتالوج والبذور:
  `pos_order_card_line_template` (سطر كرت داخل رسالة الكروت، required: serial, secret)،
  `pos_order_card_line_serial_only_template` (سطر كرت بلا رمز، required: serial)،
  `broadcast_customers_template` (رسالة جماعية للعملاء)، `broadcast_pos_template`
  (رسالة جماعية لنقاط البيع، outboundPos)، `outbound_test_message_template` (رسالة الاختبار، outboundSystem).
- **مفتاح متقاعد:** `salafni_card_delivery_template` لم يعد له مستهلك في التطبيق (كرت سلفني يُرسل بقالب
  نوع العملية). أُزيل من الكتالوج والبذور (`RETIRED_OUTBOUND_TEMPLATE_KEYS`)، لكن الإصدارات المنشورة
  سابقاً التي تحتويه **تبقى صالحة** (لا يفقد التطبيق حزمته النشطة ولا يتغير hash الإقرار)، وتُحذف تلقائياً
  من أي مسودة أو نشر جديد عبر `normalizeDraftInput`.
- أُصلح خطأ مطابقة حقيقي في الخادم: `{phone}` في قالب **صادر** كان يُطابَق كنص حر
  بدل الاسم البديل `customer_phone`، فكان يرفض النص الافتراضي الفعلي
  (`pos_instant_charge_confirm_template`). الآن تُطبَّق العناصر النائبة الواردة
  فقط إن لم تكن اسمًا بديلًا مسجّلًا.
- أُصلح تعارض حقيقي آخر: قاعدة «تكرار المتغير» في الخادم كانت ترفض تكرار الاسم
  نفسه (`{CURRENCY}` مرتين) الموجود في النصوص الافتراضية لـAndroid. صارت ترفض
  **تصادم المرادفات فقط** (مثل `{code}` مع `{secret}`)، مطابقةً
  `TemplateVariableRegistry.synonymCollisionsIn` في Android.

**هوية مصدر الرسائل (جدول `wallets`):** هوية الكتالوج الجديدة محسومة لصالح
`WalletSpec.catalogId` بصيغة `wallet-default-*` (كتالوج Android v1 + تحقق
`templateCenter.js`). ما يبقى غير متحقق منه من مستودع الإدارة هو ترحيل صفوف
التثبيتات القديمة التي تحمل `wallet-N`/معرّفات عشوائية؛ يعلن الكود
`WALLET_ID_CONTRACT.legacyRowMigration = 'unverified_from_admin_repo'`. أما
المصادر التي ينشئها المدير من اللوحة فتُولَّد ببادئة مستقلة `wallet-admin-<hex>`
ولا تُكتب يدويًا. التفاصيل والمعجم في `docs/TEMPLATE_CENTER_STYLE_AUDIT_AR.md`.

## 5. الاستحقاق المدفوع: ثلاث طبقات منفصلة

| الطبقة | المصدر | الحقول | ملاحظة |
|---|---|---|---|
| خريطة الميزات | `users/{uid}.feature_entitlements` | `hotspot_template_editor`, `mikrotik_card_generator` (bool) | عقد `contracts/schemas/feature-entitlements.schema.json`. تقرأه `PaidFeatureGate` في Android. |
| عقد lease الموقّع | `POST /api/entitlements/activate` (موجود) | `payload`/`signature` Ed25519، `keyId`, `expiry`, `operations` | `server/_lib/entitlementActivation.js`. لا يمنح ميزة بحد ذاته. |
| سجل الأجهزة | `users/{uid}/devices/{deviceId}` + `users/{uid}.entitlementInstallationId` | FCM token، `entitlementInstallationId` | توصيل/ربط، وليس أساسًا لمنح تجربة. |

قاعدة: **lease لا يمنح ميزة لا يمنحها `feature_entitlements`**. حالة الميزة في
Android تفشل مغلقة (`PaidFeatureGate`): الحساب غير النشط تجاريًا يقفل، والغياب
يقفل، ولا يُقبل إثبات مخزّن أقدم من 15 دقيقة.

هذه المهمة **لا تنفّذ شاشة استحقاقات ولا تكتب `feature_entitlements`**؛ العقد فقط.

## 6. خريطة الحقول: المصدر ↔ المستهلك

لكل حقل: مصدره في الإدارة، ومستهلكه في Android بالمسار. عند غياب دليل مكتوب
`Unknown / يحتاج قرارًا`.

### 6.1 المحفظة (`wallets` + `wallet_extras`)

| الحقل | مصدر الإدارة | مستهلك Android | الدليل |
|---|---|---|---|
| `id` | `TemplateCenterPage` (مسودة/إصدار) | `lib/domain/entities/wallet.dart` `Wallet.id` | متوافق |
| `name` | مسودة/إصدار | `Wallet.name` | متوافق |
| `status` | مسودة/إصدار | `Wallet.status` (`WalletStatus`) | متوافق |
| `createdAt` | مسودة/إصدار | `Wallet.createdAt` | متوافق |
| `sourceMode` | مسودة/إصدار | `Wallet.sourceMode` (`WalletSourceMode`) | متوافق (افتراضي `sms`) |
| `senderId` | مسودة/إصدار | `Wallet.senderId` | متوافق |
| `packageName` | مسودة/إصدار | `Wallet.packageName` | مطلوب فعليًا عند `notification` |
| أي حقل رصيد/مبلغ | — | — | **Unknown / يحتاج قرارًا** — غير معرّف، وممنوع في العقد |

### 6.2 قالب التحويل الوارد (`transfer_templates`)

| الحقل | مصدر الإدارة | مستهلك Android | الدليل |
|---|---|---|---|
| `id` | مسودة/إصدار | `TransferTemplates.id` | متوافق |
| `name` | مسودة/إصدار | `TransferTemplates.name` | متوافق |
| `pattern` | مسودة/إصدار | `TransferTemplates.pattern` | متوافق |
| `isActive` | مسودة/إصدار | `TransferTemplates.isActive` | متوافق |
| `walletId` | مسودة/إصدار | `transfer_templates.wallet_id` | متوافق |
| `posId` | مسودة/إصدار | `transfer_templates.pos_id` | متوافق |
| `priority` | مسودة/إصدار | `transfer_templates.priority` | متوافق |
| `identifierKind` | مسودة/إصدار | `transfer_templates.identifier_kind` | متوافق |
| `requireReference` | مسودة/إصدار | `transfer_templates.require_reference` | متوافق |
| `senderCode` | مسودة/إصدار | `transfer_templates.sender_code` | متوافق |
| `senderNameLabel`/`noteLabel` | مسودة/إصدار | الأعمدة المطابقة | متوافق |
| `sampleBody` | مسودة/إصدار | `transfer_templates.sample_body` | متوافق |

**ملاحظة فجوة:** `TemplateCenterActivationPayload` في Android يقرأ `wallets` و
`transferTemplates` فقط من الحمولة، ويُسقط `outboundTemplates` عند التفعيل
(يُستهلك لاحقًا كإسقاط `template_center_entries`). هذا سلوك Android الحالي،
وليس عقدًا يجب تغييره هنا.

### 6.3 الرسائل الصادرة (منفصلة عن FCM)

| الحقل | مصدر الإدارة | مستهلك Android | الدليل |
|---|---|---|---|
| `key` | مسودة/إصدار (`OUTBOUND_TEMPLATES`) | `OutboundTemplateCatalog.definitions[].key` | متوافق |
| `body` | مسودة/إصدار | نص القالب في الإعدادات المحلية | متوافق |

**فصل صريح:** قوالب SMS الصادرة ≠ إشعارات FCM. FCM يُدار عبر `api/send-fcm.js`
و`notification_requests`/`notification_deliveries` بمخطط مختلف تمامًا، ولا علاقة
له بحمولة الإصدار.

### 6.4 ACK (مقترح)

| الحقل | مصدر الحقيقة | ملاحظة |
|---|---|---|
| `uid` | Firebase ID token (خادم) | لا يُوثق بقيمة العميل |
| `installationId` | `users/{uid}.entitlementInstallationId` | مطابقة إلزامية عند التنفيذ |
| `releaseId`/`payloadHash` | `template_center_releases/{releaseId}` | مطابقة إلزامية |
| `insertedCount`/`conflictCount` | Android | تشخيصي |
| `parserRefreshed` | Android | تشخيصي |
| وقت الخادم | **Unknown / يحتاج قرارًا** | لا حقل وقت خادم في عقد ACK المقترح بعد |

### 6.5 الميزات المدفوعة

| الحقل | مصدر الإدارة | مستهلك Android | الدليل |
|---|---|---|---|
| `feature_entitlements.hotspot_template_editor` | **Unknown / يحتاج قرارًا** (لا شاشة إدارة بعد) | `PaidFeature.hotspotTemplateEditor` | عقد مطابق |
| `feature_entitlements.mikrotik_card_generator` | **Unknown / يحتاج قرارًا** | `PaidFeature.mikrotikCardGenerator` | عقد مطابق |

> إدارة هذين الحقلين من اللوحة لم تُنفَّذ بعد. هذه المهمة تثبّت العقد فقط.

## 7. ما يمكن فحصه محليًا وما يحتاج بيئة/قرارًا

**قابل للفحص محليًا (نُفِّذ):** مخططات العقود + الأمثلة، التحقق الخادمي للحمولة
الحقيقي، كتالوج الخادم، اختبارات الوحدة (`node --test`).

**يحتاج Vercel/Firebase أو بيانات بيئة (غير متحقق):**
- حالة النشر الفعلي على Vercel (لا صلاحية `deployments` في هذا الرمز: 403).
- وجود إصدارات/مسودات حقيقية في `template_center_*` (لا قراءة إنتاج).
- ضبط `FIREBASE_SERVICE_ACCOUNT`, `KROTAK_HMAC_SECRET`, `ENTITLEMENT_PRIVATE_KEY`
  (تحقّق من **الاسم** فقط؛ لا عرض قيم).

**يحتاج قرار مالك:** تنفيذ ACK (تغيير Android)، شاشة المزايا المدفوعة، أي حقل
مالي للمحفظة، وقت خادم في عقد ACK.
