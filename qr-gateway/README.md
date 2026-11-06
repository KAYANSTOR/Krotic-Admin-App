# بوابة WhatsApp QR — PoC

هذه خدمة Node منفصلة عن Vercel، مخصصة لاختبار ربط **رقم واتساب تجريبي واحد** عبر Baileys. ليست جاهزة للإنتاج ولا تفعّل الإرسال في التطبيق تلقائياً.

## تنبيه سياسة ومخاطر الحساب

Baileys مكتبة غير رسمية وغير تابعة لواتساب. يذكر مركز مساعدة واتساب أن استخدام/ربط الحسابات بإصدارات غير رسمية يخالف الشروط وقد يؤدي إلى تقييد الحساب مؤقتاً أو نهائياً. استخدم رقماً تجريبياً فقط، ولا تستخدم رقماً أساسياً أو حساباً لا تقبل فقده. المسار الرسمي للأعمال هو Meta WhatsApp Business Platform / Cloud API.

المراجع: [Baileys session management](https://baileys.wiki/authentication/session-management)، [WhatsApp about unofficial apps](https://faq.whatsapp.com/1217634902127718)، [Meta WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

## ما يحتويه هذا الـPoC

- واجهة متوافقة مع واجهة Vercel: `GET /healthz`, جلسات QR، وإرسال نص مع `deliveryId` idempotent.
- رمز Bearer عالي العشوائية للمكالمات بين Vercel والبوابة؛ لا تُتاح واجهات الجلسة للعموم بلا مصادقة.
- تشفير AES-256-GCM لمفاتيح Baileys وسجلات idempotency على القرص الدائم. يحتفظ الدفتر بالبصمة 30 يوماً وبحد 5,000 سجل؛ عند بلوغ السقف يرفض الجديد بـ503 بدلاً من إخلاء مفاتيح صالحة. لا يستخدم مخزن Baileys متعدد الملفات الافتراضي.
- رمز حالة جلسة موقّع HMAC يُرسل إلى نقطة Vercel؛ الطابع رتيب ومحفوظ مشفراً، وVercel يرفض المساوي/الأقدم ويكتب الحقول المسموحة في Firestore. لا تُمنح Render بيانات اعتماد Firebase Admin.
- حد أقصى جلسة واحدة في إعداد Render الأول. QR يبقى في الذاكرة فقط ويُرجع للعميل المصادق عليه مؤقتاً.

## إعداد Render المقترح

ملف Blueprint: `render.yaml`. الخطة المقترحة هي `0.5c-512mb` مع قرص دائم 1GB ومثيل واحد في Frankfurt. السعر المنشور حالياً هو 7 دولارات شهرياً للحوسبة + 0.25 دولار/GB شهرياً للقرص، أي نحو 7.25 دولار/شهر قبل الضرائب أو أي استخدام زائد. تتضمن خطة Hobby أول 5GB من نقل البيانات شهرياً، ثم تُحسب الزيادة بـ0.15 دولار/GB. قد يلزم رفع الذاكرة إذا تجاوز الاختبار حدود الخطة. الخدمة المجانية لا تصلح: تتوقف عند الخمول ولا تدعم قرصاً دائماً.

**لن تُطبّق خطة Blueprint قبل مراجعة تكلفتها وموافقة مستقلة.** قيم `GATEWAY_SERVICE_TOKEN` و`GATEWAY_VAULT_KEY_BASE64` و`GATEWAY_STATUS_CALLBACK_URL` ستُدخل كمتغيرات سرية يدوياً عند الاعتماد، ولن تُحفظ في Git. يجب أن يطابق رمز الخدمة قيمة `WHATSAPP_GATEWAY_SERVICE_TOKEN` على Vercel Preview. لا تُرسل أي سر إلى الدردشة ولا تضعه في ملف `.env` ملتزم.

المراجع: [Render Blueprint specification](https://render.com/docs/blueprint-spec)، [Render persistent disks](https://render.com/docs/disks)، [Render pricing](https://render.com/pricing)، [Render free-service limits](https://render.com/docs/free).

## إعداد محلي

1. استخدم Node.js 20 أو أحدث.
2. انسخ `.env.example` إلى `.env` وأدخل القيم محلياً فقط؛ لا تلتزم الملف.
3. اضبط `GATEWAY_DATA_DIR` على مجلد محلي دائم، ومفتاح `GATEWAY_VAULT_KEY_BASE64` على Base64 لمفتاح عشوائي 32 بايت.
4. شغّل `npm ci` ثم `npm test` و`npm start`.

## متغيرات البيئة

| المتغير | الغرض |
|---|---|
| `GATEWAY_SERVICE_TOKEN` | سر مشترك بطول 32 بايت على الأقل؛ يصدّق استدعاءات Vercel ويوقّع callbacks. |
| `GATEWAY_VAULT_KEY_BASE64` | مفتاح AES-256-GCM بطول 32 بايت بالضبط لتشفير بيانات الجلسة ودفتر الإرسال. |
| `GATEWAY_DATA_DIR` | مسار قرص دائم؛ في Render `/var/data`. |
| `GATEWAY_STATUS_CALLBACK_URL` | نقطة Vercel: `/api/whatsapp/gateway/status`. |
| `GATEWAY_MAX_SESSIONS` | حد الجلسات؛ يبدأ بـ`1` في PoC. |
| `PORT` | يمرره Render تلقائياً؛ محلياً الافتراضي 3000. |
| `NODE_ENV` | `production` على Render. |

## مراحل التفعيل

1. اجتياز اختبارات الوحدة والبناء محلياً.
2. دفع الفرع `تكامل-مزايا-المدفوعة` ثم طلب خطة Render فقط، دون تطبيقها.
3. مراجعة التكاليف/الموارد والموافقة الصريحة قبل إنشاء خدمة مدفوعة.
4. نشر مسار callback في Vercel، وضبط السر المشترك ومفتاح الخزنة بأمان.
5. فحص `/healthz`، ثم اختبار QR على رقم تجريبي بعد أخذ موافقة المستخدم قبل عرض/مسح الرمز.
6. إثبات إعادة الاتصال بعد إعادة تشغيل Render، وعدم تكرار الإرسال، ثم فقط مناقشة تفعيل واجهة التطبيق. يبقى `WHATSAPP_GATEWAY_ENABLED=false` إلى أن تنجح هذه الخطوات.

## الحدود الحالية

هذا PoC لا يدّعي استقبالاً كاملاً أو ضمان تسليم، ولا يغيّر اختيار المزود في Firestore، ولا يعطّل SMS الاحتياطي، ولا يربط حساباً حقيقياً تلقائياً. `sent` لا تعني `delivered`. يجب ألا تُسجّل رموز QR، أو نصوص الرسائل، أو أرقام المستلمين، أو مفاتيح الجلسة.
