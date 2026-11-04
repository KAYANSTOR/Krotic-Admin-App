# تنفيذ واجهات WhatsApp الخادمية — خطة وحالة الفرع

**الفرع:** `تكامل-مزايا-المدفوعة` في مستودع لوحة الإدارة `Krotic-Admin-App`

**الاستضافة الحالية:** Vercel Serverless للواجهات + Firebase Admin SDK / Firestore

**تاريخ التحديث:** 2026-11-05

**عقد التطبيق:** Krotak-Pro، فرع `feature/paid-features`؛ مرجع العميل هو `whatsapp_delivery_http_source.dart` و`whatsapp_qr_session_http_source.dart`.

## الخلاصة التنفيذية

أُضيفت الآن واجهات Vercel التي يطلبها التطبيق، مع بقاء الأسرار وإرسال الرسائل على الخادم. ربط Cloud API يتم عبر تبادل رمز Embedded Signup والتحقق من أصول WABA/رقم الهاتف قبل حفظ الرمز مشفراً. الإرسال الموحد يختار المزود النشط المسجل للشبكة، ويرفض تكرار `deliveryId` قبل التواصل مع المزود. Webhook Meta الموجود أصبح محدود الجسم، ويحدّث الآن كذلك حالات الرسائل الصادرة العامة.

للحفاظ على قيد Vercel Hobby في هذا المشروع، تمر المسارات العامة الجديدة عبر rewrites إلى `api/router.js` ولا تنشئ دوال Serverless إضافية؛ تبقى أربع نقاط دخول فقط: الراوتر، Webhook، وعمليتا Cron الحاليتان.

**حدّ النشر المهم:** لم يُضف محرك Baileys/whatsapp-web.js إلى Vercel؛ فهذا غير مناسب لعمليات دائمة. أُضيفت واجهة وسيطة آمنة لخدمة QR منفصلة دائمة، لكن تلك الخدمة نفسها ليست جزءاً من هذا المستودع ولم تُنشر أو تُختبر على هاتف فعلي. لذلك تبقى وظائف QR وإرسال QR غير جاهزة حتى يتوفر عنوان الخدمة الدائمة وسرها، ويُثبت المحرك حالة الجلسة في Firestore وفق العقد أدناه.

## خطة التنفيذ والحالة

| المرحلة | الحالة | التفاصيل |
|---|---|---|
| مراجعة فرع المزايا وعقد التطبيق | مكتملة | وجدنا أن العميل يرسل `POST /api/whatsapp/deliver` بالحقول `networkId`, `deliveryId`, `destination`, `body`, و`templateKey` الاختياري. لا يعتبر النجاح مقبولاً إلا مع `ok: true` و`providerMessageId`. جلسة QR في التطبيق تقرأ من `/api/whatsapp/session` وتبدأ من `/session/start` وتفصل من `/session/unlink`. |
| Meta Embedded Signup + تخزين آمن | مكتملة في الخادم | مسار تبادل code، التحقق من أن `phoneNumberId` ضمن WABA، الاشتراك في webhook، وتخزين رمز مشفر وبيانات الربط في batch ذري واحد، مع حفظ انتهاء صلاحيته إن أعادته Meta. لا يُعاد الرمز ولا App Secret للعميل. |
| QR API على Vercel | واجهات مكتملة، مزود الجلسات غير منشور | المسارات تعمل كـ facade وتفوض إلى خدمة دائمة. Vercel لا يحمل جلسة أو عملية خلفية. التفعيل يفشل مغلقاً افتراضياً. |
| الإرسال الموحد + منع التكرار | مكتمل في الخادم | يختار Cloud API أو بوابة QR من `networks/{networkId}.whatsappPrimaryProvider`، ويشترط الاستحقاق وحالة الربط، ثم يعيد `providerMessageId`. يحتفظ Firestore ببصمة الطلب وحالته وبصمة `deliveryId` فقط؛ لا يخزن نص الرسالة أو رقم الوجهة أو `deliveryId` الخام. |
| اختبار ونشر | قيد الإكمال | يلزم تثبيت متغيرات بيئة Vercel، نشر قواعد Firestore، تشغيل الاختبارات وبناء التطبيق، ثم نشر/اعتماد خدمة QR واختبار Meta الفعلي. لم يُنفذ نشر أو تعديل على Vercel من هذه النسخة المحلية. |

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

بوابة التطبيق الخادمية تستدعي الخدمة الخاصة بالمسارات المعتمدة في `docs/contracts/whatsapp-gateway-api.md`:

- `POST /v1/session/link`
- `POST /v1/session/qr`
- `POST /v1/session/unlink`
- `POST /v1/messages`

الطلبات تحمل `Authorization: Bearer <service token>` و`X-Network-Id`، كما تحمل `networkId` في JSON. الخدمة مسؤولة عن التحقق من التفويض الداخلي وعزل الشبكات، وتخزين بيانات جلسة WhatsApp مشفرة في قرص دائم، وعدم تسجيل رمز QR أو الجلسة أو نص الرسالة أو الهاتف كاملاً. يجب أن تكتب الحالة غير السرية فقط إلى `whatsapp_gateway_sessions/{networkId}`؛ كتابة العميل ممنوعة بقواعد Firestore.

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
| `WHATSAPP_GATEWAY_SERVICE_TOKEN` | رمز عشوائي قوي للتحقق بين Vercel والخدمة الدائمة. |
| `FIREBASE_SERVICE_ACCOUNT` | صلاحية Admin SDK المعتادة لقراءة/كتابة Firestore. |

## التحقق الحالي وبوابة النشر

تم تشغيل الفحوص الآتية على نسخة العمل:

- اختبارات API الجديدة + التشفير + إرسال Cloud: **23/23 ناجحة**.
- اختبار حدود Vercel وإعادة كتابة المسارات: **5/5 ناجحة**؛ عدد دوال API بقي أربعاً.
- اختبارات قواعد Firestore بالمحاكي: **25/25 ناجحة**، بما فيها منع admin والمالك والعميل الآخر من قراءة/كتابة سجلات رموز WhatsApp وطلبات الرسائل؛ وفحص القواعد الثابت نجح.
- `npm run build`: ناجح (مع تحذير Vite الحالي عن حجم chunk يتجاوز 500 KiB).
- `git diff --check`: ناجح.

**مجموعة `npm test` كاملة ليست خضراء بعد:** آخر تشغيل أعاد 441 ناجحاً و34 فاشلاً من أصل 475. تتركز الإخفاقات في مجموعات queue/status/SMS، وتتضمن بيانات اختبار UUID غير صالحة وتوقعات لا تطابق أكواد إعداد المزود/تقرير الأسرار الحالي، إضافةً إلى اختبارات WhatsApp emulator التي تحتاج تشغيل المحاكي. اختبارات المسارات الجديدة واختبار Vercel المحدد نجحت؛ لكن يجب معالجة الإخفاقات الباقية قبل اعتبار إطلاق التطبيق كاملاً.

بعد معالجة المجموعة كاملة، يجب نشر `firestore.rules` التي تمنع العميل من قراءة/كتابة `whatsapp_message_requests`، ثم ضبط Vercel env وإعادة نشر النسخة، والتحقق على Preview. اختبار الإنتاج الفعلي يحتاج حساب Meta/رقم اختبار، webhook عام، خدمة QR الدائمة، وتجربة هاتف منفصلة؛ لم يُجرَ أي إرسال فعلي أو نشر من هذا الفرع.
