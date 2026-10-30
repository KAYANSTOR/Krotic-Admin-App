# مقترح معماري — تكامل WhatsApp الخادمي (للإدارة)

**الحالة:** مقترح للمراجعة والاعتماد فقط. **لا تنفيذ كود** حتى اعتماد المالك.  
**الفرع المرجعي للتطبيق:** `Krotak-Pro/feature/paid-features`  
**العقد الحاكم:** `docs/contracts/whatsapp-delivery-and-recharge-policy.md`  
**الخطة:** `docs/PAID_FEATURES_WHATSAPP_SMART_ROUTING_PHONE_RECHARGE_AR.md`  
**مستودع التنفيذ المقترح:** `KAYANSTOR/Krotic-Admin-App` (بعد الاعتماد)

> هذا المقترح يترجم سياسات العقد إلى مسارات وحقول مقترحة لمستودع الإدارة.  
> أي اسم مسار أدناه **مقترح** وليس معتمداً حتى يوافق المالك صراحة.

---

## 1. المبادئ من العقد (ملزمة)

1. لا أسرار Meta في APK / SQLite / SharedPreferences / Logs.
2. الأسرار مشفّرة خادمياً ومعزولة لكل شبكة (`tenant/network`).
3. المزود الأساسي يُختار **يدوياً** لكل شبكة؛ لا تبديل تلقائي عند الفشل.
4. منع تكرار الأحداث: `providerId + inboundMessageId`.
5. SMS احتياطي بعد فشل نهائي أو عدم تأكيد `delivered/read` خلال **10 ثوانٍ**؛ لا إرسال متوازٍ مع WhatsApp قبل قرار المنسق.
6. فصل استقبال الأحداث عن معالجة الشحن/إصدار الكرت.
7. الاستحقاق `whatsapp_card_delivery` بوابة الميزة؛ QR ليس مفتاحاً مستقلاً.

---

## 2. مسارات مقترحة (بانتظار الاعتماد)

| الغرض | المسار المقترح | الطريقة | من يستدعي |
|---|---|---|---|
| Webhook Meta (وارد + حالات) | `/api/whatsapp/meta/webhook` | `GET` تحقق اشتراك + `POST` أحداث | Meta |
| أحداث Local Gateway | `/api/whatsapp/gateway/events` | `POST` | خدمة Gateway الخادمية |
| إعداد/قراءة مزود الشبكة | `/api/whatsapp/network-config` | `POST` (admin) | لوحة الإدارة |
| بدء جلسة QR | `/api/whatsapp/gateway/session/start` | `POST` (admin أو مالك مصادق) | التطبيق/الإدارة |
| حالة الجلسة | `/api/whatsapp/gateway/session/status` | `POST` | التطبيق/الإدارة |
| إنهاء الجلسة | `/api/whatsapp/gateway/session/stop` | `POST` | التطبيق/الإدارة |

**ملاحظة:** العقد يمنع اختراع endpoint في حزمة Android؛ الاعتماد يتم هنا أولاً.

---

## 3. تحقق توقيع Meta

- رأس معروف من Meta (مثل `X-Hub-Signature-256`) مع HMAC-SHA256 على الجسم الخام باستخدام **App Secret** المخزّن خادمياً.
- رفض فوري (401/403) عند غياب التوقيع أو عدم التطابق؛ لا معالجة للحدث.
- `GET` للتحقق من الاشتراك: مقارنة `hub.verify_token` مع سر خادمي غير مضمّن في العميل.
- اختبار مطلوب: جسم صحيح + توقيع خاطئ ⇒ لا كتابة ولا إصدار كرت.

---

## 4. استقبال أحداث Local Gateway

- مصادقة الخدمة: توقيع HMAC مشترك أو مفتاح خدمة خادمي لكل شبكة، يُتحقق منه قبل أي معالجة.
- الحمولة الدنيا المقترحة: `networkId`, `providerId`, `inboundMessageId`, `from`, `text`, `occurredAt`, `sessionId`.
- رفض المصدر غير الموثّق؛ لا ثقة بـ IP وحده.

---

## 5. تخزين أسرار Meta وتشفيرها

| البند | المقترح |
|---|---|
| المكان | وثائق خادمية فقط (Firestore عبر Admin SDK أو Secret Manager) تحت مسار معزول لكل `networkId` |
| المحتوى | Access Token، App Secret، Verify Token، WABA IDs — **مشفّرة at-rest** بمفتاح رئيسي من بيئة Vercel (`WHATSAPP_SECRETS_KEK` أو ما يعتمده المالك) |
| العرض للعميل | حالة الربط + آخر أربعة أحرف عند الحاجة فقط |
| العزل | لا مشاركة أسرار بين الشبكات |

**يحتاج قراراً:** اختيار Secret Manager مقابل حقل مشفّر في Firestore.

---

## 6. مخطط الأحداث الواردة (مقترح)

```text
whatsapp_inbound_events/{providerId}_{inboundMessageId}
  providerId: string          // meta | local_gateway
  inboundMessageId: string
  networkId: string
  from: string
  text: string | null
  occurredAtMs: number
  receivedAtMs: number
  signatureVerified: true
  processingStatus: received | processed | ignored | failed
  deliveryRecordId: string | null
```

مفتاح المستند = منع التكرار الذري: إنشاء بشرط عدم الوجود (`create` يفشل إن وُجد).

---

## 7. منع التكرار

- المفتاح المعتمد في العقد: `providerId + inboundMessageId`.
- عند إعادة وصول الحدث: إرجاع نجاح بدون إعادة إصدار كرت أو شحن.
- ربط كل حدث بسجل التسليم (`CardDeliveryRecord` على جانب التطبيق / سجل خادمي موحّد لاحقاً).

---

## 8. دورة حياة جلسة QR

1. `start` → الخادم ينشئ جلسة معزولة للشبكة ويعيد QR **مؤقتاً** عبر API مصادق.
2. التطبيق يعرض QR ولا يحفظه كملف جلسة.
3. حالات: غير مربوط، QR مطلوب، جارٍ الربط، متصل، منقطع، يحتاج إعادة ربط، مفصول.
4. الجلسة مشفّرة على الخادم فقط.
5. `stop` يبطل الجلسة فوراً.

---

## 9. اختيار المزود الأساسي لكل شبكة

```text
networks/{networkId} أو users/{uid} (حقل إعداد شبكة — يُعتمد اسم الحقل عند التنفيذ)
  whatsappPrimaryProvider: "cloud_api" | "local_gateway"
```

- تغيير المزود يؤثر على **العمليات الجديدة فقط**.
- لا failover تلقائي إلى المزود الآخر.

---

## 10. سياسة SMS الاحتياطية (من العقد)

1. ابدأ بالمزود المختار فقط.
2. فشل نهائي / رفض المستلم / عدم جاهزية المزود ⇒ SMS فوراً.
3. قبول الإرسال دون `delivered/read` موثوق خلال **10 ثوانٍ** ⇒ SMS مرة واحدة.
4. وصول التأكيد خلال المهلة يمنع SMS؛ بعد SMS يُسجَّل `delivered_late_after_sms` دون إعادة إرسال.
5. نفس الكرت من سجل البيع الأصلي؛ لا حجز مخزون ثانٍ.

---

## 11. الصلاحيات والأمان

- Webhooks عامة مع تحقق توقيع فقط (بدون Firebase token).
- مسارات الإعداد: مدير أو مالك شبكة مصادق + التحقق من ملكية `networkId`.
- الاستحقاق `whatsapp_card_delivery === true` قبل أي إرسال.
- قواعد Firestore: منع قراءة/كتابة أسرار وأحداث واردة من العميل.

---

## 12. اختبارات مطلوبة قبل الإعلان عن الاكتمال

1. توقيع Meta خاطئ ⇒ رفض.
2. تكرار `providerId + inboundMessageId` ⇒ لا معالجة مزدوجة.
3. فشل الاتصال بالخادم / المزود ⇒ SMS وفق السياسة دون تسريب أسرار.
4. غياب `account_features.whatsapp_card_delivery` ⇒ ميزة مقفلة (Fail-Closed).
5. عزل أسرار بين شبكتين.
6. عدم ظهور Token في استجابات API للعميل.

---

## 13. ما يحتاج اعتماد المالك قبل التنفيذ

- [ ] اعتماد أسماء المسارات في §2 أو تعديلها.
- [ ] اختيار مخزن الأسرار (Secret Manager vs Firestore مشفّر).
- [ ] اسم حقل `whatsappPrimaryProvider` ومساره (`networks` vs `users`).
- [ ] مواصفات خدمة Local Gateway الخارجية (إن وُجدت) ومفتاح توقيعها.

**بعد الاعتماد فقط:** تنفيذ على فرع `تكامل-مزايا-المدفوعة` مع اختبارات، دون نشر إنتاج تلقائي.
