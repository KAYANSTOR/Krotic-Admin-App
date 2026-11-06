# عقد مزايا الحساب وACK القوالب

**الحالة:** فرع `تكامل-مزايا-المدفوعة` في `KAYANSTOR/Krotic-Admin-App`. هذه الوثيقة تحل محل وصف `feature_entitlements` وACK التراكمي في المستندات الأقدم.

## 1. مزايا الحساب

المصدر المعتمد الوحيد للصلاحيات هو `users/{uid}.account_features`. لا يقرأ الخادم ولا ينسخ `feature_entitlements` أو أي حقل قديم.

### 1.1 المفاتيح الخمسة المطلوبة من عقد Android (`feature/paid-features`)

| المفتاح | الوصف | الافتراضي |
|---|---|---|
| `hotspot_template_editor` | محرر صفحات الهوتسبوت | `false` |
| `mikrotik_card_generator` | توليد وطباعة الكروت | `false` |
| `whatsapp_card_delivery` | إرسال الكروت عبر WhatsApp | `false` |
| `smart_delivery_routing` | التوجيه الذكي ومسارات الإرسال | `false` |
| `hotspot_phone_recharge` | الشحن المباشر برقم الهاتف | `false` |

هذه الأسماء حرفية ومتطابقة مع `PaidFeature` في تطبيق Krotak Pro.

### 1.2 مفاتيح إدارية إضافية (توافق)

| المفتاح | الوصف | الافتراضي |
|---|---|---|
| `sms_auto_parser` | تحليل رسائل المحافظ والحوالات | `false` |
| `advanced_analytics` | التقارير المالية المتقدمة | `false` |

تبقى `active` دون هجرة أو حذف في هذه المرحلة.

المسار الإداري هو `POST /api/admin/account-features`، ويُعاد توجيهه إلى دالة `server/apiHandlers/settings.js` القائمة للمحافظة على حد Vercel Hobby. يدعم `action: catalog` و`action: get` و`action: set`. المسارات الخادمية تتحقق من صلاحية المدير، وتقبل مفاتيح الكتالوج النشطة وقيم Boolean فقط. التحديث ذري ويضبط `account_features_version` و`account_features_updated_at_ms` و`account_features_updated_by` و`account_features_source` و`updatedAtMs`، ويكتب أثراً في `users/{uid}/account_feature_audit/{id}` يحوي `previous` و`next` و`changed_keys` الفعلية فقط.

الكتالوج الابتدائي في `app_settings/account_features_catalog`. عند وجود كتالوج قديم ناقص، يُدمَج أي مفتاح معتمد ناقص تلقائياً دون حذف المفاتيح الموجودة. شاشة الإدارة على الرابط `/paid-features` (الاسم الظاهر «مزايا الحساب»). وجود المفتاح على الخادم لا يثبت وحده أن نسخة Android قد استهلكته أو فعلت الميزة.

## 2. ACK القوالب: Android إلى Vercel

يبعث Android `POST /api/template-center` مع `action: "ack"` وحقول العقد في `contracts/schemas/template-center-ack-request.schema.json`. يشتق الخادم `uid` من Firebase ID token ولا يقبل هوية الحساب أو الشبكة من جسم الطلب. يشترط ربط `installationId` أولاً مع `users/{uid}.entitlementInstallationId`، ويتحقق من الإصدار المنشور وبصمة الحمولة والنطاق وملكية الشبكة قبل الكتابة.

كل كتابة ACK موثقة من الخادم فقط، إلى وثيقة واحدة لكل جهاز:

```text
users/{uid}/template_acks/{deviceId}
```

الكتابة Upsert لأحدث حالة؛ لا يوجد سجل تاريخي تراكمي. `network_id` مشتق من الحساب/وثيقة الشبكة لحصر العرض والفلترة، وليس مساراً. وقت `synced_at` من ساعة الخادم. المخطط الكامل في `contracts/schemas/template-ack.schema.json`.

استجابة لوحة الإدارة تحمل `acks` من collection-group query محدودة لأحدث الوثائق. الحالات `matched` و`conflict` و`stale` و`failed` و`unknown` **حسابية** من آخر ACK لكل جهاز بمقارنته بالمؤشر النشط وبصمة الإصدار، ولا تُكتب كحالة إضافية في Firestore. غياب ACK لا يعني نجاح التطبيق؛ الحالة تبقى غير معروفة/منشور مركزياً.

## 3. الصلاحيات والفهارس

قواعد Firestore تمنع تعديل `account_features` وحقوله الزمنية من العميل، وتمنع الكتابة المباشرة على `template_acks` و`account_feature_audit` حتى للمدير؛ الكتابة عبر Admin SDK فقط. فهرس `template_acks.synced_at` بنطاق `COLLECTION_GROUP` يدعم قائمة أحدث ACKs. تُحفظ مستندات ACK القديمة/التراكمية دون اعتمادها أو عرضها في المسار الجديد.

## 4. مخزون الكروت في ملف العميل

يعرض ملف العميل عدد سجلات البيع المتزامنة باعتبارها «الكروت المباعة». لا يعرض رقماً تخمينياً لغير المباع: تفاصيل المخزون والكروت تبقى في SQLite على Android حسب قرار Spark، ولا تُرفع إلى Firestore. تظهر «غير متاح» مع سببها حتى يتوفر مصدر محلي/إداري مصرح به لا ينتهك قرار عدم مزامنة بيانات المخزون.

## 5. التحقق

- اختبارات `accountFeatures`, `templateCenterAck`, `templateCenterApi`, `templateCenterView`, `contracts`, و`uiAudit`.
- اختبار rules/emulator: `security-tests/firestore-rules.test.js` عند توفر Firestore Emulator.
- فحص حد وظائف Vercel: `test/vercelFunctionLimit.test.js`.
- لا يُعدّ نجاح الاختبارات وحده نشرًا. هذا التغيير يُرفع إلى فرع الإدارة المحدد فقط؛ لا نشر إنتاج ولا ترحيل بيانات ضمن هذا الدفع.
