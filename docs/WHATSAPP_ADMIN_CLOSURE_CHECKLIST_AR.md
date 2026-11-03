# قائمة إغلاق لوحة الإدارة — WhatsApp

**الفرع:** `تكامل-مزايا-المدفوعة`  
**آخر تحديث:** 2026-11-02

---

## 1. ما أُنجز في الكود والعقود

| بند | الحالة |
|-----|--------|
| عقد `whatsapp-gateway-api.md` | ✅ |
| عقد `whatsapp-gateway-session-status.md` (خيار 1) | ✅ |
| عقد `whatsapp-sms-device-task.md` | ✅ |
| `tryStartSmsFallback` → `sms_pending` فقط | ✅ |
| `completeSmsFallbackFromDevice` | ✅ |
| واجهة `/whatsapp-settings` تقرأ جلسة البوابة | ✅ |
| كتالوج 7 مفاتيح بما فيها `whatsapp_card_delivery` | ✅ |
| قواعد Firestore: sessions + SMS tasks + secrets | ✅ |
| `.env.example` يوثّق متغيرات WhatsApp | ✅ |

---

## 2. أسرار Vercel (`krotic-admin-app`)

| المتغير | الحالة |
|---------|--------|
| `WHATSAPP_SECRETS_KEK` | ✅ أُضيف (production + preview + development) |
| `WHATSAPP_DISPATCH_SERVICE_SECRET` | ✅ أُضيف |
| `META_VERIFY_TOKEN` / `WHATSAPP_META_VERIFY_TOKEN` | ✅ أُضيف — انسخ نفس القيمة إلى Meta Console |
| `META_APP_SECRET` / `WHATSAPP_META_APP_SECRET` | ❌ **مطلوب منك** من Meta Developer Console |
| توكن الشبكة لكل `networkId` | عبر الواجهة `set_token` (مشفّر) — ليس env |

بدون `META_APP_SECRET` لن يمر تحقق توقيع Webhook.

---

## 3. ما يبقى على المالك / التشغيل

1. **ضع `META_APP_SECRET`** في Vercel (من إعدادات تطبيق Meta).
2. **انشر قواعد Firestore** من هذا الفرع إلى مشروع Firebase الإنتاج.
3. **أعد نشر** مشروع Vercel بعد الأسرار الجديدة.
4. في Meta: Webhook URL + Verify Token = قيمة `META_VERIFY_TOKEN` في Vercel.
5. لكل شبكة اختبار: حفظ Access Token من `/whatsapp-settings`.
6. موقظ يستدعي `POST /api/whatsapp/dispatch` برأس `x-dispatch-service-secret` (Cron خارجي أو يدوي للاختبار).
7. PoC بوابة `local_gateway_qr` على VM دائمة — خارج Serverless.
8. اختبارات قبول حية (إرسال/استقبال/SMS/عزل شبكتين) قبل إعلان إنتاج.

---

## 4. حدود صريحة

- مهلة 10 ثوانٍ **غير مضمونة** على Vercel Hobby وحدها.
- لا إرسال WhatsApp حي حتى Meta secret + token شبكة + webhook.
- لا جلسة QR إنتاجية حتى خدمة بوابة دائمة.
- لا دمج إلى `main` دون موافقة صريحة.
