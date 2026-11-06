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
| إنشاء `whatsapp_sms_device_tasks` من dispatch بعد المهلة | ✅ |
| تسوية نتائج الجهاز (sent/failed) داخل dispatch | ✅ |
| واجهة `/whatsapp-settings` تقرأ جلسة البوابة | ✅ |
| كتالوج 7 مفاتيح بما فيها `whatsapp_card_delivery` | ✅ |
| قواعد Firestore: sessions + SMS tasks + secrets | ✅ |
| Cron تعافٍ كل 6 ساعات لـ `/api/whatsapp/delivery/dispatch` | ✅ (ليس ضمان 10ث) |
| `.env.example` يوثّق متغيرات WhatsApp | ✅ |

---

## 2. أسرار Vercel (`krotic-admin-app`)

| المتغير | الحالة |
|---------|--------|
| `WHATSAPP_SECRETS_KEK` | ✅ |
| `WHATSAPP_DISPATCH_SERVICE_SECRET` | ✅ |
| `META_VERIFY_TOKEN` / alias | ✅ — انسخه إلى Meta Console |
| `META_APP_SECRET` | ⏳ يضيفه المالك لاحقاً |
| `CRON_SECRET` | اختياري لـ Cron Bearer (إن وُجد يُقبل في dispatch) |
| توكن الشبكة | عبر `/whatsapp-settings` → set_token |

---

## 3. ما يبقى على المالك

1. إضافة `META_APP_SECRET` في Vercel.
2. نشر `firestore.rules` من هذا الفرع إلى Firebase.
3. إعادة نشر Vercel بعد الأسرار.
4. ربط Webhook Meta + Verify Token.
5. Access Token لكل شبكة اختبار.
6. ربط Android بمهام `whatsapp_sms_device_tasks` (خارج مستودع الإدارة).
7. PoC بوابة QR على VM إن رغبت بـ `local_gateway_qr`.
8. اختبارات قبول حية قبل `main`.

---

## 4. حدود صريحة

- مهلة 10 ثوانٍ غير مضمونة على Hobby.
- لا إرسال حي بدون Meta secret + token شبكة + webhook.
- لا جلسة QR إنتاجية بدون خدمة بوابة دائمة.
