# الدفعة 4 — حالات Meta وواجهة إعدادات الشبكة

**الفرع:** `تكامل-مزايا-المدفوعة`  
**الحالة:** منفَّذ في الكود — بدون إرسال حقيقي وبدون ضمان مهلة 10ث

## ما نُفّذ

### 1. ربط status من Meta

- `server/_lib/whatsapp/statusEvents.js`
- Webhook يعالج `statuses[]` بعد التحقق من التوقيع
- ربط عبر `providerMessageId` + `networkId` (من `phone_number_id`)
- منع تكرار الحدث: `whatsapp_status_events/{provider}_{network}_{msgId}_{status}` بـ create
- لا تراجع حالة: فشل بعد delivered يُتجاهل
- بعد SMS: `delivered`/`read` → `delivered_late_after_sms` فقط
- لا تخزين لجسم Webhook الخام

### 2. SMS once-only

- `server/_lib/whatsapp/smsClaim.js`
- هوية ثابتة = `deliveryOperationId` (= networkId + saleUuid)
- claim قبل الإكمال؛ `smsProviderAcceptedAtMs` لاستعادة بعد انقطاع دون إعادة إرسال

### 3. واجهة الإدارة

- المسار: `/whatsapp-settings`
- APIs: `get` / `set` / `set_token` / `clear_token` على `/api/whatsapp/network-config`
- التوكن: password input، يُمسح بعد الحفظ، لا localStorage، لا إعادة من API

## ما لم يُنفَّذ

- إرسال WhatsApp/SMS حقيقي
- موقظ دقيق لـ 10 ثوانٍ
- أسرار إنتاج
- المرحلة 0 غير مكتملة
