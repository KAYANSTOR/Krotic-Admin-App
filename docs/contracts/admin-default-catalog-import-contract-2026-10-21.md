# عقد استيراد كتالوج العناصر الافتراضية في لوحة الإدارة (2026-10-21)

> **الأطراف:** وكيل Android (المستودع `KAYANSTOR/Krotak-Pro`) ينتج الكتالوج،
> ووكيل لوحة الإدارة (`KAYANSTOR/Krotic-Admin-App`) يستورده ويراجعه وينشره.
> هذا المستند يصف ماسلّمه Android وما يحتاجه من الإدارة. **لم يُعدَّل مستودع
> الإدارة ولا الخادم من جهة Android.**

## 1) الملف المُسلَّم

| الملف | الوصف |
|---|---|
| `assets/template_catalog/krotak_default_catalog_v1.json` | الكتالوج الكامل: المحافظ ومصادر الرسائل، قوالب التحويل الواردة، قوالب الرسائل الصادرة، تعريفات قوالب نقطة البيع |
| `assets/template_catalog/krotak_default_catalog_v1.sha256` | بصمة SHA-256 للملف (تُتحقق منها الإدارة قبل الاستيراد) |
| `contracts/schemas/default-template-catalog.schema.json` | JSON Schema للتحقق من بنية الكتالوج قبل الاستيراد |
| `lib/domain/services/default_template_catalog.dart` | المصدر الوحيد للكتالوج داخل التطبيق |
| `tools/export_default_catalog.dart` | مولّد الكتالوج: `dart run tools/export_default_catalog.dart` |

**محتوى الكتالوج اليوم:** 6 محافظ، 13 قالب تحويل وارد، 23 قالب رسالة صادرة،
3 تعريفات قوالب نقطة بيع. يُعاد توليده عند أي تغيير في الـseeders الرسمية.

## 2) قواعد الاستيراد في لوحة الإدارة (مطلوبة من وكيل الإدارة)

1. **Upsert بمعرّف العنصر** لا إنشاء جديد: العنصر الموجود بنفس `id` يُحدَّث،
   ولا تُنشأ نسخة ثانية مهما تكرّر الاستيراد. المعرّفات ثابتة عبر التثبيتات.
2. **لا تُفقد التعديلات**: إن كان العنصر `managedBy: admin` (عدّله المشغّل في
   الإدارة) فلا يستبدله الاستيراد بقيمة `seed` إلا إذا اختار المالك صراحةً
   «إعادة إلى الافتراضي».
3. **مصدر العنصر يُحفظ**: `managedBy` = `seed` عند الاستيراد، ويصير `admin`
   عند أول تعديل إداري.
4. **الكتالوج لا يُعالَج كبيانات مستخدم**: لا أرصدة ولا رسائل ولا معاملات ولا
   أرقام عملاء. الحقول المسموحة هي ما ورد في الـSchema.
5. **مراجعة قبل النشر**: العناصر المستوردة تظهر في شاشات المحافظ وقوالب التحويل
   وقوالب الرسائل الصادرة، ويمكن تعديلها ثم نشرها.
6. **الاختيار للشبكة قبل العام** يبقى من صلاحية الخادم في `read-active`؛
   الكتالوج لا يغيّر ذلك.

## 3) عقد النشر من الإدارة إلى التطبيق

الإصدار المنشور في `/api/template-center` يحمل الحمولة بنفس معرّفات الكتالوج:

```jsonc
{
  "releaseId": "…", "version": "…", "versionCode": 7,
  "payloadHashSha256": "…", "minAppVersion": "…", "minAppBuild": 0,
  "payload": {
    "wallets": [
      { "id": "wallet-default-jaib", "name": "جيب", "status": "active",
        "sourceMode": "notification", "senderId": "Jaib",
        "packageName": "com.ahd.jaib" }
    ],
    "transferTemplates": [
      { "id": "tpl-default-jaib-ar-shared", "walletId": "wallet-default-jaib",
        "name": "…", "pattern": "…", "priority": 10, "isActive": true,
        "senderCode": "Jaib", "identifierKind": "phone",
        "requireReference": true }
    ],
    "outboundTemplates": [
      { "key": "voucher_delivery_sms_template", "body": "…", "isActive": true }
    ]
  }
}
```

- `wallets[].id` و`transferTemplates[].id` و`outboundTemplates[].key` = معرّفات
  الكتالوج نفسها (لا معرّفات محلية جديدة).
- `transferTemplates[].walletId` = معرّف محفظة من الكتالوج؛ ويحوّله التطبيق
  إلى المعرّف المحلي عبر خريطة الهوية.

## 4) ما يفعله التطبيق عند وصول الإصدار

| الحالة | السلوك |
|---|---|
| العنصر غائب محليًا | يُدرَج مرة واحدة (idempotent) |
| العنصر افتراضي **غير معدّل** (يطابق الـseed) | يُحدَّث من الإدارة |
| العنصر تملّكه نشر سابق (provenance) | يُحدَّث من الإدارة |
| العنصر عدّله المشغّل | **لا يُستبدل** — يُسجَّل conflict ويُعرض |
| تثبيت قديم بمعرّف محفظة عشوائي | يُربط عبر خريطة الهوية — لا نسخة ثانية |
| قالب صادر معطّل في الإصدار (`isActive:false`) | يدخل قائمة التعطيل ⇒ لا يُرسل |
| قالب صادر بمتغيّر غير معرّف | يُرفض ولا يُكتب |

بعد الكتابة (كلها داخل معاملة واحدة) تُعاد قراءتها إلى `LocalMessageParser`،
وتُقرأ نصوص الصادر من `app_settings` مباشرة — لا يحتاج `OutboundTemplateRenderer`
إعادة تحميل لأنه يقرأ الإعدادات عند كل إرسال.

**الزرع الافتراضي لا يعيد الكتابة فوق الإدارة**: `DefaultWalletTemplatesSeeder` و
`DefaultOutboundTemplatesSeeder` و`DefaultPosTemplatesSeeder` تتخطّى أي عنصر
له provenance إداري.

## 5) «منشور في الإدارة» ≠ «مطبَّق على الجهاز»

| الحالة على الجهاز | المعنى |
|---|---|
| `fetched` | وصل الإصدار وحُفظ كـcache — لم يُطبَّق بعد |
| `applied` / `parserRefreshed` | طُبّق محليًا وأُعيد تحميل parser — **بانتظار إقرار الخادم** |
| `pendingAck` | الحالة الافتراضية بعد تطبيق محلي؛ لا يوجد endpoint ACK منشور بعد |
| `acknowledged` | لا يُعلن إلا بعد إقرار خادمي مطابق لـ`releaseId` + `payloadHashSha256` |
| `conflict` | طُبّق جزئيًا مع بقاء تعديلات المشغّل |

واجهة التطبيق لا تقول «مطبَّق» إلا مع `acknowledged`. المعرّفات المعروضة هي
`releaseId` و`versionCode` و`payloadHashSha256` — بلا أي سر.

## 6) عقد ACK المطلوب من لوحة الإدارة (غير منشور بعد)

- `POST /api/template-center` بجسم
  `{action:'ack-apply', releaseId, versionCode, payloadHashSha256, appliedAt, parserReloaded, counts:{wallets,transferTemplates,outboundTemplates}, conflicts}`،
  مع `Authorization: Bearer <Firebase ID token>` و`Idempotency-Key: <releaseId>:<payloadHashSha256>`.
- الرد المقبول: `{success:true, ack:{releaseId, payloadHashSha256, acceptedAt}}`
  فقط إذا طابق `releaseId` و`payloadHashSha256` المُرسَلين. أي اختلاف ⇒ رفض.
- تكرار الطلب بالمفتاح نفسه ⇒ نفس النتيجة بلا أثر مزدوج.
- **حتى يُنشر هذا العقد، تبقى حالة الجهاز `pendingAdminContract` ولا يُعلن
  `acknowledged`.**

## 7) ما ينفّذه وكيل الإدارة (مطلوب)

1. نقطة استيراد للكتالوج مع تحقق من `schemaVersion` وبصمة SHA-256، وUpsert
   بمعرّف العنصر.
2. شاشات عرض العناصر المستوردة (محافظ/مصادر رسائل، قوالب تحويل، قوالب صادرة)
   مع حالة `managedBy` وإمكانية التعديل.
3. نشر الإصدار بنفس بنية `payload` أعلاه وبنفس المعرّفات.
4. (اختياري الآن) نقطة ACK أعلاه؛ دونها تبقى الحالة `pendingAdminContract`.

## 8) التحقق على جهاز المالك (قائمة لم تُنفَّذ بعد)

1. تثبيت APK QA (debug) وتسجيل الدخول بحساب مصرح.
2. استيراد الكتالوج في لوحة الإدارة والتأكد من ظهور العناصر بنفس المعرّفات.
3. تعديل عنصر واحد ونشر الإصدار.
4. في التطبيق: التأكد من ظهور `releaseId`/البصمة في حالة المزامنة، ومن أن
   العنصر المعدَّل طُبِّق **مرة واحدة** بلا نسخة مكررة.
5. رسالة اختبار غير مالية تطابق القالب المنشور بعد إعادة التحميل.
6. إعادة فتح التطبيق: لا تكرار ولا تراجع إلى القيمة الافتراضية.
