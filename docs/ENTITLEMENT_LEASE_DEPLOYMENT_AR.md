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

الخادم يطابق UID مع الرمز الموثّق، ويصدر العقد فقط إذا كانت `accessStatus` تساوي `TRIAL` أو `ACTIVE_PAID` وكان `subscriptionEndsAt` أو `subscription_end_date` في المستقبل. أول تثبيت يُحجز ذرياً في `users/{uid}.entitlementInstallationId` وسجل `device_bindings/{installationId}`. أي تثبيت مختلف يُرفض بـ `409 installation_mismatch`، وأي تثبيت مرتبط بحساب آخر يُرفض بـ `409 installation_bound_to_another_account`.

الرد `{payload, signature}`؛ التوقيع Ed25519 يغطي كامل JSON payload، ويحتوي العقد على `uid` و`installationId` و`issuedAt` و`notBefore` و`version` و`keyId` و`operations` و`commercialUntil` و`maxOfflineUntil` و`serverTime`. لا يصدر الخادم عقداً بعد انتهاء الاستحقاق أو لحالة غير معروفة.

### سياسة الاستحقاق التجاري والعمل دون اتصال

- `commercialUntil`: نهاية الاشتراك/التجربة، وهي آخر لحظة للعمليات التجارية (`sell`/`settle`).
- `maxOfflineUntil`: نهاية صلاحية العقد للعمل دون اتصال، وتُحسب كـ`commercialUntil + 7 أيام`
  مع سقف أقصى `30 يوماً` من وقت الإصدار. المهلة تسمح للجهاز بمزامنة ما تبقّى وطلب
  الدعم والقراءة بعد الانتهاء التجاري، ثم تجبره على العودة للخادم.
- القيم قابلة للضبط الخادمي عبر `ENTITLEMENT_OFFLINE_GRACE_MS` و`ENTITLEMENT_MAX_OFFLINE_MS`
  (بالمللي ثانية)، والقيم الافتراضية أعلاه هي المعتمدة.
- `serverTime` و`issuedAt` من ساعة الخادم؛ يستخدمهما العميل لتصحيح فرق ساعة الجهاز.
- `version` هو إصدار عقد الحساب، ويبدأ بـ`1` ويزيد عند كل إعادة ربط جهاز معتمد.
- ترتيب الحقول أعلاه ثابت لأن التوقيع يُحسب على `JSON.stringify(payload)` كما يُعاد للعميل.


### موافقة مدير على جهاز بديل

`POST /api/entitlements/device-rebind`

يتطلب Firebase ID token لمدير مخوّل، وجسماً بالشكل:

```json
{"uid":"<account UID>","installationId":"<new installation ID>","reason":"سبب الموافقة"}
```

يحدّث الخادم الربط داخل transaction ويسجل المدير والجهاز السابق والجديد والسبب في `admin_audit_logs`. لا توجد عملية إعادة ربط عامة للمستخدم. إتمام المعاملة هو موافقة المدير؛ تبقى الوثيقة على الربط السابق حتى تنجح، ثم يزيد `entitlementVersion` بمقدار 1 كي تصبح عقود الجهاز السابق قديمة، ويُسجَّل `entitlementPreviousInstallationId` و`entitlementReboundBy`.


## تطبيق Android

التحقق من التوقيع موصول في تطبيق Flutter باستخدام `cryptography`؛ وقت الخادم لا يصبح موثوقاً إلا بعد نجاح Ed25519. التفعيل **معطّل افتراضياً** حتى اجتياز فحص جهاز Android الفعلي. للاختبار المقصود فقط:

```bash
flutter test
flutter run --dart-define=KROTAK_ENABLE_ENTITLEMENT_LEASE=true
```

نجاح هذه الخطوة لا يعني اجتياز بوابة الإصدار؛ يجب اختبار تسجيل الدخول، أول ربط، إعادة التشغيل/العمل دون اتصال، الرفض عند اختلاف الجهاز، وتجديد العقد قبل دمجها في إصدار الإنتاج.

## النشر والفحص

تعديلات الخادم تمر من `api/settings.js` المعاد استخدامه كي لا تضاف Serverless Function جديدة. بعد دفع commit إلى `main` يبدأ Vercel النشر تلقائياً. تُشغّل اختبارات الخادم بواسطة `node --test test/entitlementActivation.test.js`، واختبارات Android بواسطة Flutter CI/local.
