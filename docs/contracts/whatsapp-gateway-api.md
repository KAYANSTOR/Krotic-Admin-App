# عقد بوابة WhatsApp الخادمية (WhatsApp Gateway API)

**الحالة:** مرجع واحد معتمد — قرار مالك نهائي.
**الفرع:** `تكامل-مزايا-المدفوعة` فقط.
**المعمارية:** جلسات WhatsApp على الخادم فقط. ممنوع أي محرك WhatsApp/Baileys داخل Android أو APK.
**الاستحقاق الوحيد:** `whatsapp_card_delivery`.
**ممنوع:** إنشاء أو استخدام مفتاح `local_whatsapp_gateway`.

---

## 1. المبادئ الملزمة

1. جلسات WhatsApp تُدار على خادم دائم (حاوية/VM + قرص دائم) فقط.
2. لا محرك WhatsApp داخل التطبيق أو APK.
3. SMS احتياطي عبر هاتف صاحب الشبكة فقط (`whatsapp_sms_device_tasks`).
4. الاستحقاق الوحيد `users/{uid}.account_features.whatsapp_card_delivery` (boolean، تكتبه اللوحة فقط).
5. `networks/{networkId}.whatsappPrimaryProvider ∈ {cloud_api, local_gateway_qr}` — لا يكتبه العميل.
6. لا أسرار / QR / نص رسالة / رقم كامل في السجلات أو اللوحة أو APK أو Git.
7. Idempotency = `deliveryId` نفسه (قناة whatsapp منفصلة عن sms).
8. `unknown` = لا إعادة إرسال آلية ولا حذف.
9. لا انتقال تلقائي بين المزودين.
10. `sent` ≠ تسليم للعميل.

---

## 2. المسارات المعتمدة (لا تُخترع مسارات أخرى)

| Method | Path | الغرض |
|--------|------|--------|
| GET | `/healthz` | صحة الخدمة |
| GET | `/v1/session` | حالة الجلسة الحالية |
| POST | `/v1/session/link` | بدء ربط |
| POST | `/v1/session/qr` | طلب QR (مرة واحدة، مؤقت) |
| POST | `/v1/session/relink` | إعادة ربط |
| POST | `/v1/session/disconnect` | قطع مؤقت |
| POST | `/v1/session/unlink` | فصل نهائي |
| DELETE | `/v1/session` | حذف الجلسة |
| POST | `/v1/messages` | إرسال رسالة |
| GET | `/v1/messages` | قائمة الرسائل |
| GET | `/v1/messages/{deliveryId}` | حالة رسالة واحدة |
| GET | `/v1/inbound` | رسائل واردة |
| POST | `/v1/engine/status-callback` | callback المحرك (HMAC) |

---

## 3. حالات الجلسة (ثمانية فقط — لا تُخترع)

```
unlinked
qr_pending
linking
linked
disconnected
relink_required
error
unknown
```

---

## 4. حالات الرسالة (ست فقط — لا تُخترع)

```
accepted
sent
delivered
failed
unknown
sms_pending   (قبل نتيجة الجهاز)
```

ملاحظات:
- بعد نتيجة جهاز فعلية يمكن الانتقال إلى `sms_sent` داخل `whatsapp_delivery_operations`.
- `unknown` تحتاج تدخلًا بشريًا؛ لا إعادة إرسال آلية.

---

## 5. متطلبات النشر

- حاوية أو VM **دائمة** (ليس Vercel Serverless).
- قرص دائم لـ `GATEWAY_DATA_DIR`.
- مفتاح 32 بايت: `GATEWAY_VAULT_KEY_BASE64` في Secret Manager منفصل عن بيانات الجلسات.
- `GATEWAY_SERVICE_TOKEN` بطول عشوائي قوي لا يقل عن 32 بايت؛ للمصادقة من Vercel ولتوقيع callback.
- `GATEWAY_STATUS_CALLBACK_URL=https://<Vercel-host>/api/whatsapp/gateway/status`.
- لا تُعطَ خدمة Render أي Firebase service-account؛ Vercel وحده يكتب بيانات الحالة في Firestore.
- لا تُسجَّل أسرار أو QR أو نص رسالة أو رقم كامل.

---

## 6. حقول Firestore الثابتة (لا تتغيّر)

| المسار | الحقل | القيم / الملاحظات |
|--------|-------|---------------------|
| `users/{uid}` | `account_features.whatsapp_card_delivery` | boolean — اللوحة فقط |
| `users/{uid}` | `accessStatus` | `TRIAL` \| `ACTIVE_PAID` \| `SUSPENDED_GRACE` \| `LOCKED_EXPIRED` |
| `networks/{networkId}` | `whatsappPrimaryProvider` | `cloud_api` \| `local_gateway_qr` — لا يكتبه العميل |
| `whatsapp_sms_device_tasks` | — | كما في `whatsapp-sms-device-task.md` |
| `whatsapp_gateway_sessions/{networkId}` | حالة غير سرّية | انظر `whatsapp-gateway-session-status.md` |

### حالة الجلسة للوحة (خيار المالك 1 — معتمد)

- خدمة Render ترسل الحالة المسموح بها فقط إلى `/api/whatsapp/gateway/status` موقعة بـHMAC-SHA256 مع طابع زمني حديث و`X-Network-Id`.
- نقطة Vercel تتحقق من التوقيع والطابع الزمني والشبكة والحقول، وترفض أي `updatedAtMs` مساوٍ أو أقدم من المخزن؛ محرك Render يولد الطابع بشكل رتيب ويحفظه مشفراً على القرص قبل إرسال callback.
- **لا** مسار `/v1/admin/...`.
- **لا** QR ولا أسرار في الوثيقة.

---

## 7. منسّق التسليم (قواعد صارمة)

1. العملية تبقى `sms_pending` أثناء نافذة العشر ثوانٍ وبعد إنشاء مهمة SMS.
2. **لا** تصبح `sms_sent` إلا بعد نتيجة جهاز فعلية من مهمة SMS أو ACK موثوق من المزود.
3. `tryStartSmsFallback` يجب أن تنتقل إلى `sms_pending` فقط وتنشئ المهمة؛ الانتقال إلى `sms_sent` يحدث عند إبلاغ الجهاز.
4. `providerMessageId` يُخزَّن في سجل التسليم ويربط العملية الأصلية.
5. Idempotency = `deliveryId` نفسه.
6. `unknown` = لا إعادة إرسال آلية ولا حذف.
7. لا انتقال تلقائي بين المزودين.

---

## 8. اللوحة (مسؤوليات)

- تفعيل/تعطيل المزود لكل شبكة.
- عرض: `status` / `lastSeenAt` / `reasonCode` / `deviceName` من `whatsapp_gateway_sessions`.
- إلغاء جلسة بصلاحية (يستدعي مسار البوابة المصادق عليه).
- مراقبة حالات الرسائل و`unknown` كحالة تحتاج تدخلًا.
- إحصاءات عبر `collectNetworkWhatsappStatus`.
- **ممنوع** عرض أو تخزين QR أو مفاتيح أو أسرار Meta.

---

## 9. قرار المراقبة — مُغلق

**الخيار 1 معتمد:** محرك Render يرسل حالة غير سرّية موقّعة إلى Vercel، وVercel يكتب إلى `whatsapp_gateway_sessions/{networkId}`.
لا مسار `/v1/admin/...`.
التفاصيل: `docs/contracts/whatsapp-gateway-session-status.md`.

---

## 10. اختبارات القبول الإلزامية قبل الإنتاج

1. ربط QR من هاتف اختبار + إرسال/استقبال/delivered.
2. إعادة تشغيل الخدمة بلا QR جديد.
3. عزل شبكتين.
4. `account_features` مغلق ⇒ 403.
5. `accessStatus` غير نشط ⇒ 403.
6. `cloud_api` ⇒ 409 عند طلب مسار gateway.
7. إعادة POST بنفس `deliveryId` ⇒ لا رسالة ثانية.
8. توقيع callback خاطئ ⇒ 401 وتكراره بلا أثر مزدوج.
9. انقطاع ⇒ `unknown` + SMS يعمل.
10. لا `sms_sent` قبل نتيجة الجهاز.
11. لا أسرار في السجلات / اللوحة / APK.
12. إرسال حدثين في المللي ثانية نفسها ثم وصول callback الأقدم متأخراً لا يقلب الحالة.
13. بلوغ دفتر الإرسال 5,000 سجل حي يعيد `503` من دون حذف مفاتيح ضمن مدة الاحتفاظ.

---

## 11. ممنوعات صريحة

- محرك WhatsApp في التطبيق.
- تخزين QR أو جلسة في Firestore أو Git.
- استحقاق `local_whatsapp_gateway`.
- تغيير مسار SMS أو إعادة تسمية `whatsapp_sms_device_tasks`.
- إنشاء بيع/كرت/حجز من مسار WhatsApp.
- اعتبار `sent` تسليمًا.
- لمس `main` أو `cline/1fwtjqmj` أو `feature/paid-features` (في مستودع التطبيق).

---

## 12. الحالة الصادقة الحالية

واجهات Vercel ومحرك Baileys PoC معزول في `qr-gateway/` واختباراته الآلية موجودة في فرع `تكامل-مزايا-المدفوعة`؛ هذا لا يعني إنشاء أو نشر خدمة Render.
لا ربط QR حقيقي، ولا إرسال عبر محرك QR، ولا اختبار Staging موثق حتى الآن. يحتفظ دفتر المحرك ببصمات idempotency لمدة 30 يوماً وبحد أقصى 5,000 سجل؛ عند بلوغ السقف يرفض الإرسال الجديد بـ503 بدلاً من إخلاء مفتاح غير منتهٍ. لا تفعّل `WHATSAPP_GATEWAY_ENABLED` قبل خطة Render وموافقة التكلفة واختبار رقم تجريبي.
بوابة PoC للمحرك (رقم اختبار + بيئة بناء + استعادة بعد إعادة التشغيل + عزل شبكتين) ما زالت شرطًا قبل وصف QR بأنه جاهز للإنتاج. Cloud API يحتاج كذلك إعداد Meta/Vercel واختباراً فعلياً مستقلاً.

---

## 13. واجهات التطبيق على Vercel (facade)

هذه المسارات في مستودع الإدارة لا تُشغّل محرك WhatsApp؛ إنها تصادق مالك الشبكة/المدير، وتتحقق من `account_features.whatsapp_card_delivery` ومن `accessStatus ∈ {TRIAL, ACTIVE_PAID}`، ثم تستدعي Meta أو الخدمة الدائمة:

| Method | المسار | التوجيه |
|---|---|---|
| `POST` | `/api/whatsapp/meta/exchange-token` | تبادل Embedded Signup code والتحقق من WABA/phone ID، ثم حفظ ciphertext. |
| `GET` | `/api/whatsapp/session?networkId=…` | قراءة لقطة `whatsapp_gateway_sessions/{networkId}` غير السرية. |
| `POST` | `/api/whatsapp/session/start` | استدعاء `POST /v1/session/link` ثم `POST /v1/session/qr` إلى الخدمة الدائمة. |
| `POST` | `/api/whatsapp/session/unlink` | استدعاء `POST /v1/session/unlink`. |
| `POST` | `/api/whatsapp/gateway/status` | callback داخلي: يتحقق HMAC-SHA256 والطابع الزمني، ثم يكتب حقول الحالة المسموح بها فقط إلى Firestore. |
| `GET` | `/api/whatsapp/qr/generate?networkId=…` | مسار توافق لتوليد QR عبر الخدمة الدائمة؛ لا يخزن QR في Firestore. |
| `GET` | `/api/whatsapp/qr/status?networkId=…` | قراءة الحالة غير السرية. |
| `POST` | `/api/whatsapp/deliver` | عقد التطبيق الحالي: `networkId`, `deliveryId`, `destination`, `body`, `templateKey?`. |
| `POST` | `/api/messages/send` | الإرسال الموحد؛ اختيار مزود من `networks/{networkId}.whatsappPrimaryProvider`. |

الاستجابة المقبولة للإرسال تتطلب `{ "ok": true, "providerMessageId": "…" }`. يرفض الخادم إعادة استعمال `deliveryId` مع محتوى مختلف، ولا يخزن نص الرسالة أو رقم الوجهة في `whatsapp_message_requests`. يحول Meta Webhook حالات الرسائل إلى هذا السجل عندما تتوفر `biz_opaque_callback_data` أو معرّف المزود. قرار SMS الاحتياطي يبقى في التطبيق؛ خدمة Vercel لا تزعم تنفيذ إرسال SMS.

تحتاج QR إلى إعداد `WHATSAPP_GATEWAY_ENABLED=true`, `WHATSAPP_GATEWAY_URL` و`WHATSAPP_GATEWAY_SERVICE_TOKEN` بعد اعتماد خدمة Node دائمة خارج Vercel فقط. إبقاء هذه المتغيرات غير مهيأة/معطلة يجعل المسار يفشل مغلقاً بـ503.
