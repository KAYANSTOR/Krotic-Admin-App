# إصدار عقود الاستحقاق (Lease) — توثيق التنفيذ

## بنية المفتاح

- **المفتاح الخاص** `ENTITLEMENT_PRIVATE_KEY` يُحفظ كـ Vercel Environment Variable من النوع Sensitive/Secret في بيئة `Production` فقط. لا يوضع في GitHub أو تطبيق Android.
- **المفتاح العام Ed25519** ومعرّف المفتاح `ed25519-krotak-2026-10-v1` مضمّنان في تطبيق Flutter للتحقق من توقيع العقد؛ المفتاح العام ليس سراً.
- الأداة المحلية `node scripts/generate_keys.js` تطبع قيمة المفتاح الخاص في سطر واحد بفواصل `\n` مهروبة مناسبة للنسخ إلى Vercel. لا تحفظ مخرجاتها أو تلتزم بها. معالج Vercel يعيد `\n` إلى أسطر PEM قبل القراءة.

## واجهات API

### إصدار/تجديد العقد

`POST /api/entitlements/activate`

يتطلب `Authorization: Bearer <Firebase ID token>` وجسماً بالشكل:

```json
{"userId":"<Firebase UID>","deviceId":"<installation ID>"}
```

الخادم يطابق UID مع الرمز الموثّق، ويصدر العقد فقط إذا كانت `accessStatus` تساوي `TRIAL` أو `ACTIVE_PAID` وكان `subscriptionEndsAt` أو `subscription_end_date` في المستقبل. أول تثبيت يُحجز ذرياً في `users/{uid}.entitlementInstallationId`. أي تثبيت مختلف يُرفض بـ `409 installation_mismatch`.

الرد `{payload, signature}`؛ التوقيع Ed25519 يغطي كامل JSON payload، ويحتوي العقد على `serverTime` و`expiry` وحقول Lease المتوافقة مع تطبيق Android. لا يصدر الخادم عقداً بعد انتهاء الاستحقاق أو لحالة غير معروفة.

### موافقة مدير على جهاز بديل

`POST /api/entitlements/device-rebind`

يتطلب Firebase ID token لمدير مخوّل، وجسماً بالشكل:

```json
{"uid":"<account UID>","installationId":"<new installation ID>","reason":"سبب الموافقة"}
```

يحدّث الخادم الربط داخل transaction ويسجل المدير والجهاز السابق والجديد والسبب في `admin_audit_logs`. لا توجد عملية إعادة ربط عامة للمستخدم.

## تطبيق Android

التحقق من التوقيع موصول في تطبيق Flutter باستخدام `cryptography`؛ وقت الخادم لا يصبح موثوقاً إلا بعد نجاح Ed25519. التفعيل **معطّل افتراضياً** حتى اجتياز فحص جهاز Android الفعلي. للاختبار المقصود فقط:

```bash
flutter test
flutter run --dart-define=KROTAK_ENABLE_ENTITLEMENT_LEASE=true
```

نجاح هذه الخطوة لا يعني اجتياز بوابة الإصدار؛ يجب اختبار تسجيل الدخول، أول ربط، إعادة التشغيل/العمل دون اتصال، الرفض عند اختلاف الجهاز، وتجديد العقد قبل دمجها في إصدار الإنتاج.

## النشر والفحص

تعديلات الخادم تمر من `api/settings.js` المعاد استخدامه كي لا تضاف Serverless Function جديدة. بعد دفع commit إلى `main` يبدأ Vercel النشر تلقائياً. تُشغّل اختبارات الخادم بواسطة `node --test test/entitlementActivation.test.js`، واختبارات Android بواسطة Flutter CI/local.
