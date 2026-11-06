# تنفيذ واجهات WhatsApp الخادمية — خطة وحالة الفرع

**الفرع:** `تكامل-مزايا-المدفوعة` في مستودع لوحة الإدارة `Krotic-Admin-App`

**الاستضافة الحالية:** Vercel Serverless للواجهات + Firebase Admin SDK / Firestore

**تاريخ التحديث:** 2026-11-06

**عقد التطبيق:** Krotak-Pro، فرع `feature/paid-features`؛ مرجع العميل هو `whatsapp_delivery_http_source.dart` و`whatsapp_qr_session_http_source.dart`.

## الخلاصة التنفيذية

أُضيفت واجهات Vercel التي يطلبها التطبيق، مع بقاء الأسرار وإرسال الرسائل على الخادم. كما أُضيف PoC مستقل في `qr-gateway/` يستخدم Baileys مع تخزين AES-GCM على قرص دائم ودفتر إرسال مشفر idempotent، من دون بيانات اعتماد Firebase على Render. callback الحالة موقّع HMAC ويتحقق منه Vercel قبل كتابة البيانات المحدودة في Firestore.

للحفاظ على قيد Vercel Hobby في هذا المشروع، تمر المسارات العامة الجديدة عبر rewrites إلى `api/router.js` ولا تنشئ دوال Serverless إضافية؛ تبقى أربع نقاط دخول فقط: الراوتر، Webhook، وعمليتا Cron الحاليتان.

**حدّ النشر المهم:** لا يعمل محرك Baileys على Vercel. يوجد الآن كود PoC وخطة Render بقرص دائم، لكن لم تُنشأ خدمة مدفوعة ولم يُربط رقم QR فعلي. التكلفة المنشورة للخطة الدنيا 7 دولارات شهرياً للحوسبة و0.25 دولار/GB شهرياً للقرص؛ اعتماد الإنشاء يتطلب موافقة تكلفة منفصلة. حتى ذلك الحين يبقى `WHATSAPP_GATEWAY_ENABLED=false`.

## خطة التنفيذ والحالة

| المرحلة | الحالة | التفاصيل |
|---|---|---|
| مراجعة فرع المزايا وعقد التطبيق | مكتملة | وجدنا أن العميل يرسل `POST /api/whatsapp/deliver` بالحقول `networkId`, `deliveryId`, `destination`, `body`, و`templateKey` الاختياري. لا يعتبر النجاح مقبولاً إلا مع `ok: true` و`providerMessageId`. جلسة QR في التطبيق تقرأ من `/api/whatsapp/session` وتبدأ من `/session/start` وتفصل من `/session/unlink`. |
| Meta Embedded Signup + تخزين آمن | مكتملة في الخادم | مسار تبادل code، التحقق من أن `phoneNumberId` ضمن WABA، الاشتراك في webhook، وتخزين رمز مشفر وبيانات الربط في batch ذري واحد، مع حفظ انتهاء صلاحيته إن أعادته Meta. لا يُعاد الرمز ولا App Secret للعميل. |
| QR API ومحرك PoC | واجهات + كود محلي، لم يُنشر | خدمة Baileys منفصلة، تشفير مخزن الجلسة ودفتر الإرسال، مصادقة Bearer، وcallback HMAC إلى Vercel. لا تشغيل Render أو ربط فعلي حتى الآن. |
| الإرسال الموحد + منع التكرار | مكتمل في الخادم | يختار Cloud API أو بوابة QR من `networks/{networkId}.whatsappPrimaryProvider`، ويشترط الاستحقاق وحالة الربط، ثم يعيد `providerMessageId`. يحتفظ Firestore ببصمة الطلب وحالته وبصمة `deliveryId` فقط؛ لا يخزن نص الرسالة أو رقم الوجهة أو `deliveryId` الخام. |
| اختبار ونشر | PoC مختبَر محلياً؛ النشر ينتظر | اختبارات محرك QR وcallback ناجحة. يلزم دفع الفرع، عرض خطة Render غير مطبقة، موافقة صريحة على التكلفة، ثم إعداد أسرار Vercel/Render واختبار رقم تجريبي. |

## المسارات المتاحة في مستودع الإدارة

جميع مسارات المستخدمين أدناه تتطلب Firebase ID Token في `Authorization: Bearer …`، وتتحقق من مالك الشبكة أو صلاحية المدير، ثم من `users/{uid}.account_features.whatsapp_card_delivery === true` ومن أن `accessStatus` هو `TRIAL` أو `ACTIVE_PAID`. الوضع الافتراضي عند غياب الاستحقاق/الحالة هو الرفض.

| Method | المسار | الطلب/الاستجابة |
|---|---|---|
| `POST` | `/api/whatsapp/meta/exchange-token` | الطلب: `{networkId, code, wabaId, phoneNumberId}`. الاستجابة لا تتضمن الرمز مطلقاً: `{success:true, provider:"cloud_api", linked:true, tokenStored:true, tokenExpiresAtMs, webhookSubscribed:true}`. |
| `GET` | `/api/whatsapp/session?networkId=…` | يعيد `{session:{status, deviceName?, linkedAtMs?, lastSeenAtMs?, reasonCode?, engineVersion?}}`. لا يقرأ QR من Firestore. |
| `POST` | `/api/whatsapp/session/start` | الطلب `{networkId}`؛ الاستجابة `{session:{status:"qr_pending", qrImageBase64, qrExpiresAtMs}}` عند وجود QR صالح. |
| `POST` | `/api/whatsapp/session/unlink` | الطلب `{networkId}`؛ الاستجابة `{ok:true}` بعد نجاح الفصل لدى خدمة الجلسة. |
| `GET` | `/api/whatsapp/qr/generate?networkId=…` | مسار التوافق المطلوب لتوليد QR؛ يطبق نفس التفويض، ويعيد لقطة `session` المتوافقة مع نموذج التطبيق. |
| `GET` | `/api/whatsapp/qr/status?networkId=…` | قراءة حالة الجلسة غير السرية من Firestore بصيغة `{session:{…}}`. |
| `POST` | `/api/whatsapp/gateway/status` | callback داخلي موقّع من Render؛ يتحقق Vercel من HMAC والطابع الزمني والحقول ثم يكتب الحالة المسموحة فقط إلى Firestore. |
| `POST` | `/api/whatsapp/deliver` | عقد Android الحالي، التفاصيل أدناه. |
| `POST` | `/api/messages/send` | الواجهة الموحدة نفسها؛ تقبل `destination/body` أو `toE164/text`. |
| `GET/POST` | `/api/whatsapp/meta/webhook` | المسار الموجود للتحقق من Meta واستلام الرسائل وحالات التسليم؛ POST يتحقق من HMAC على الجسم الخام. حد الجسم 2 MiB. |

### عقد التطبيق الدقيق للإرسال

العميل الحالي يرسل:

```json
{
  "networkId": "…",
  "deliveryId": "…",
  "destination": "+967…",
  "body": "نص الرسالة النهائي",
  "templateKey": "اختياري"
}
```

النجاح لا يُعلن إلا عند رد مثل:

```json
{ "ok": true, "providerMessageId": "wamid.…" }
```

الرفض يرد بحالة HTTP غير ناجحة و`{ "ok": false, "reasonCode": "…" }`. التطبيق الحالي يقرر SMS الاحتياطي؛ لا ترسل واجهة الإدارة SMS بدلاً عنه. إعادة الطلب بنفس `deliveryId` والمحتوى تعيد معرّف المزود دون إرسال ثانٍ؛ وإعادة استخدامه بمحتوى آخر ترفض بـ`delivery_id_conflict`. إذا كانت نتيجة المزود غير مؤكدة، لا يعاد إرسال المفتاح تلقائياً.

## تصميم خدمة QR الدائمة

بوابة التطبيق الخادمية تستدعي الخدمة الخاصة بالمسارات المعتمدة في `docs/contracts/whatsapp-gateway-api.md`. كود PoC المعزول في `qr-gateway/` يستخدم Baileys 6.7.24 ويُحصر في جلسة واحدة في الإعداد الأول:

- `POST /v1/session/link`
- `POST /v1/session/qr`
- `POST /v1/session/unlink`
- `POST /v1/messages`

الطلبات تحمل `Authorization: Bearer <service token>` و`X-Network-Id`، كما تحمل `networkId` في JSON. يخزن المحرك بيانات الجلسة ودفتر idempotency مشفرين على `/var/data`، ولا يسجل QR أو الجلسة أو نص الرسالة أو الهاتف كاملاً. لا يحصل Render على Firebase service-account. بدلاً من ذلك يرسل callback إلى `/api/whatsapp/gateway/status` موقّعاً بـHMAC-SHA256 وطابع زمني؛ يتحقق Vercel من القائمة البيضاء ومطابقة الشبكة والتحديثات القديمة ثم يكتب حقول الحالة المحدودة إلى Firestore.

**تشغيل محرك QR:** انشر Node.js service منفصلة على Container/VM دائمة بقرص مستمر (مثلاً خدمة خاصة على Render/Railway أو VPS)، أو استخدم مزوداً خارجياً مثل Evolution API خلف adapter يطابق العقد أعلاه. لا تضع Baileys ولا حلقة polling دائمة داخل Vercel Function. قبل تفعيل `WHATSAPP_GATEWAY_ENABLED=true` يلزم إثبات إعادة التشغيل والاستعادة، العزل بين شبكتين، QR منتهي الصلاحية، الفصل النهائي، callbacks موثقة، والإرسال بالـ idempotency. مجرد إعداد facade لا يعني أن محرك QR يعمل.

## Meta Embedded Signup وWebhook

- إعداد Vercel server-side: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `WHATSAPP_SECRETS_KEK`، واختيارياً `META_GRAPH_API_VERSION` (الافتراضي `v26.0`). يمكن استخدام أسماء `WHATSAPP_META_APP_ID/SECRET/VERIFY_TOKEN` البديلة في الكود.
- بعد تسلّم `code` المؤقت من التطبيق، الخادم فقط يتصل بـ Meta. يتحقق من وجود رقم الهاتف في WABA ومن نجاح `/{waba-id}/subscribed_apps` قبل حفظ الربط.
- تخزن بيانات الرمز في `whatsapp_network_secrets/{networkId}` على شكل AES-256-GCM ciphertext بمفتاح KEK من إعدادات الخادم؛ تحفظ الصلاحية إن أعادت Meta `expires_in`. لا توضع App Secret أو الرمز في Vite env أو Android أو logs.
- في Meta Developer Console اضبط Callback URL على `https://<نطاق-الخادم>/api/whatsapp/meta/webhook`، وVerify Token المطابق، واشترك في أحداث WhatsApp Business Account اللازمة ومنها الرسائل وحالاتها. نجاح اشتراك WABA من API لا يغني عن إعداد التطبيق وWebhook في لوحة Meta.
- رمز Embedded Signup قصير العمر؛ لا تفترض أنه دائم. وثائق Meta قد تعيد access token لا يملك مدة معلنة أو مدة محددة؛ تحفظ الخدمة القيمة الفعلية ولا تخترع صلاحية.

مراجع Meta الرسمية التي استند إليها التحديث:
- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4)
- [Facebook long-lived access tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived)

## متغيرات البيئة — تهيئة Vercel

أضف القيم في Vercel Project → Settings → Environment Variables لكل بيئة مناسبة، ولا تُرسلها في المحادثة ولا إلى التطبيق:

| المتغير | الغرض |
|---|---|
| `META_APP_ID` | معرّف Meta App لعملية code exchange. |
| `META_APP_SECRET` | السر الخاص بـ Meta، خادمي فقط. |
| `META_VERIFY_TOKEN` | سر تحقق GET Webhook. |
| `META_GRAPH_API_VERSION` | إصدار Graph؛ الافتراضي الحالي `v26.0`. |
| `WHATSAPP_SECRETS_KEK` | 32 بايت Base64 لتشفير access tokens. خطط لتدوير المفتاح باستخدام `WHATSAPP_SECRETS_KEK_PREV`. |
| `WHATSAPP_LIVE_SEND` | يظل مغلقاً/غير مضبوط حتى اعتماد اختبار إرسال Cloud API؛ القيمة `1` تسمح بإرسال HTTP الحي. |
| `WHATSAPP_GATEWAY_ENABLED` | يبقى `false` حتى اعتماد خدمة QR الدائمة. |
| `WHATSAPP_GATEWAY_URL` | HTTPS endpoint للخدمة الدائمة. |
| `WHATSAPP_GATEWAY_SERVICE_TOKEN` | السر المشترك مع `GATEWAY_SERVICE_TOKEN` في Render؛ للمصادقة بين الخدمتين وتوقيع callback. |
| `GATEWAY_STATUS_CALLBACK_URL` | في Render: رابط Vercel Preview للفرع متبوعاً بـ`/api/whatsapp/gateway/status`؛ لا يُوجَّه إلى الإنتاج قبل اعتماده. |
| `FIREBASE_SERVICE_ACCOUNT` | صلاحية Admin SDK المعتادة لقراءة/كتابة Firestore. |

## التحقق الحالي وبوابة النشر

آخر نتائج تحقق متاحة **قبل إصلاحات المراجعة الأمنية الأخيرة**:

- اختبارات API وHMAC callback وحدود الراوتر والتشفير وإرسال Cloud: **33/33 ناجحة**.
- اختبارات PoC QR: **8/8 ناجحة**.
- اختبارات قواعد Firestore بالمحاكي: **25/25 ناجحة**، بما فيها منع admin والمالك والعميل الآخر من قراءة/كتابة سجلات رموز WhatsApp وطلبات الرسائل؛ وفحص القواعد الثابت نجح.
- `npm run build` و`npm run lint`: ناجحان (مع تحذير Vite الحالي عن حجم chunk يتجاوز 500 KiB).

بناءً على طلب المستخدم، لم تُشغّل اختبارات أو build إضافية بعد إصلاح ترتيب callbacks، وتمرير تعارض 409، وحماية سقف دفتر idempotency؛ النتائج أعلاه لا تصادق على هذه التعديلات الأخيرة.

**مجموعة `npm test` الكاملة ليست مؤكدة الخضرة:** التشغيل الكامل السابق لإضافات PoC أعاد 441 ناجحاً و34 فاشلاً من أصل 475؛ لم أعد المجموعة كاملة بعد هذه الإضافات، لذا لا أقدّم نتيجة سابقة على أنها نتيجة حالية. الاختبارات المركزة الجديدة نجحت، لكن يلزم تشغيل المجموعة كاملة ومعالجة أي إخفاق قبل اعتبار إطلاق التطبيق كاملاً.

بعد معالجة المجموعة كاملة، يجب دفع التغييرات ونشر `firestore.rules` التي تمنع العميل من قراءة/كتابة `whatsapp_message_requests`، ثم ضبط Vercel env وإعادة نشر النسخة، والتحقق على Preview. إنشاء خدمة Render مدفوعة يظل معلقاً حتى موافقة صريحة على التكلفة. لا يوجد إرسال فعلي أو QR مرتبط حالياً.
