# الدفعة 7 — دورة التسليم، عقد SMS للجهاز، والموقظ

**الفرع:** `تكامل-مزايا-المدفوعة`

## 1. دورة Cloud API (كود + اختبارات)

| الحالة | السلوك |
|---|---|
| sent → delivered → read | انتقال تقدمي |
| failed بعد sent | يُسجَّل failed |
| إعادة محاولة بنفس sale | عملية واحدة + استدعاء HTTP واحد |
| عزل التوكن | شبكة B لا تستخدم توكن A |
| توكن منتهٍ (401/190) | نهائي غير قابل لإعادة المحاولة |

تاريخياً كان Graph `v21.0`. المسارات الجديدة تستخدم `META_GRAPH_API_VERSION` (الافتراضي `v26.0`)؛ راجع [خطة تنفيذ واجهات WhatsApp](WHATSAPP_API_IMPLEMENTATION_AR.md).

## 2. SMS عبر هاتف صاحب الشبكة (عقد فقط)

حسب عقد Krotak-Pro:

| الخطوة | المسؤول |
|---|---|
| إنشاء مهمة دائمة | الخادم `whatsapp_sms_device_tasks/{deliveryOperationId}` |
| التنفيذ | Android: `MessageDeliveryWorker` → `NativeMessageSender` / `SmsBridge` |
| النتيجة | الجهاز يكتب sent/failed على المهمة |
| انقطاع الهاتف | المهمة تبقى queued |
| منع التكرار | taskId = deliveryOperationId (create مرة واحدة) |

**لم يُعدَّل مستودع التطبيق.** المطلوب على Android موثّق في `smsDeviceTaskContract.js`.

## 3. مقارنة الموقظ (مجاني / عملي)

| الخيار | دقة ~10ث | تكلفة | ملاحظات |
|---|---|---|---|
| استدعاء يدوي لـ dispatch | لا | 0 | للاختبار فقط |
| Vercel Cron (Hobby) | **لا** (دقة دقائق، حدود) | 0 على Hobby | لا يُعتمد لضمان 10ث |
| عامل خارجي (GitHub Actions schedule / جهاز دائم) | تقريبي حسب الجدول | 0–منخفض | يحميه `x-dispatch-service-secret` |
| Cloud Scheduler + HTTP | أفضل | مدفوع غالباً | خارج سياسة free-tier الحالية |

**الخلاصة:** الكود جاهز للاستدعاء المحمي؛ **ضمان الثانية العاشرة غير مثبت** بدون موقظ موثوق يختاره المالك.

## 4. واجهة الإعدادات

`/whatsapp-settings` يعرض: حالة الربط، وجود التوكن (بدون كشف)، Phone Number ID، عدّادات العمليات والطابور والمعلّق.

## 5. ما يمنع الإطلاق التشغيلي

1. حساب Meta + توكنات حقيقية + `WHATSAPP_LIVE_SEND`
2. ربط Android بمهام `whatsapp_sms_device_tasks`
3. موقظ يستدعي dispatch بسر الخدمة
4. اشتراك Webhook في Meta
