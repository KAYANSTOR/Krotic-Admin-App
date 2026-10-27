# تقرير إصلاح تكامل لوحة الإدارة مع Krotak Pro — 2026-10-27

**الفرع المستهدف:** `development` في `KAYANSTOR/Krotic-Admin-App`.
**الالتزام:** لم يُعدّل `main`، ولم يُنشأ فرع جديد، ولم يُنشر إنتاج.
**حالة النشر:** `Unknown` — لا توجد بيانات اعتماد Vercel ولا رابط نشر موثّق في المستودع.

## 1) الملفات التي تغيّرت وسبب كل تغيير

| الملف | السبب |
|---|---|
| `server/_lib/entitlementActivation.js` | إضافة `commercialUntil` و`maxOfflineUntil` دائماً، فصل سياسة العمل دون اتصال عن الانتهاء التجاري، إصدار `version` لكل حساب، جعل `userId` اختيارياً والهوية من التوكن فقط، سجل `device_bindings` لمنع ربط التثبيت بحسابين، وتثبيت ترتيب حقول الحمولة قبل توقيع Ed25519. |
| `server/_lib/entitlementDeviceRebind.js` | إعادة الربط تزيد `entitlementVersion` وتُبطل العقد السابق (`entitlementLeaseRevokedAtMs`)، تسجل الجهاز السابق والمدير والسبب، وتدعم `deviceId` كمرادف. |
| `server/_lib/networkSecretStore.js` | إضافة تدوير صريح مع `previousNetworkSecretEncrypted` ومهلة انتقال، وقائمة مفاتيح مقبولة (`networkSecretCandidates`)، ومنع الاستبدال الصامت عند فشل الفك. |
| `server/_lib/networkSecretApi.js` | فصل `get` عن `rotate`: `get` لمالك الشبكة فقط، و`rotate` للمدير فقط مع تدقيق، و`Cache-Control: no-store`، ورفض الإرجاع الفارغ/البديل. |
| `api/sales/ingest.js` | قبول المفتاح السابق خلال مهلة التدوير، `409 payload_conflict`، إصلاح `status: CREATED` الذي كان يُستبدل بـ`created`، حفظ `serverReceivedAt`/`serverReceivedAtMs`، رفض `createdMs` المستقبلي البعيد، وتشديد رفض الحساب الموقوف. |
| `api/device-heartbeat.js` | رفض الحساب الموقوف والجهاز غير المطابق لـ`entitlementInstallationId`، ودعم `network_id` القديم، وحفظ `installationBound` للمراقبة فقط. |
| `server/_lib/deviceHeartbeatsApi.js` | إظهار `installationBound` في قراءة المراقبة الإدارية. |
| `server/_lib/accountFeatures.js` | تسجيل `account_features_updated_by` و`account_features_source`، وحساب `changed_keys` الفعلية، وإرجاعهما في القراءة. |
| `src/lib/auditLog.js` | تسميات عربية لإجراءات تدقيق إعادة ربط الجهاز وتدوير مفتاح الشبكة. |
| `src/lib/adminApi.js` | رسائل عربية لأخطاء العقد الجديدة (`payload_conflict`, `created_at_in_future`, أخطاء الاستحقاق والتدوير). |
| `firestore.rules` | قفل حقول `entitlement*` و`networkId/network_id` و`account_features_*` و`phone_verified*` عن كتابة العميل، ومنع كتابة مجموعات `account_features` و`feature_entitlements` الفرعية حتى للمدير. |
| `.env.example` | توثيق أسماء `ENTITLEMENT_PRIVATE_KEY` وسياسة المهلة فقط، دون أي قيم. |
| `docs/DEVICE_ATTESTATION_STATUS_AR.md` | توثيق أن توقيع الجهاز/Attestation/TLS Pinning غير منفّذ ومتطلباته، دون ادعاء حماية. |
| `docs/ENTITLEMENT_LEASE_DEPLOYMENT_AR.md` | توثيق حقول العقد والسياسة وإصدار إعادة الربط. |
| `docs/ACCOUNT_FEATURES_ACK_CONTRACT_AR.md` | توثيق حقول التدقيق الجديدة. |
| `test/*` و`security-tests/*` | اختبارات انحدار وتكامل للعقد الجديد. |

## 2) الاختبارات المنفّذة ونتائجها الفعلية

| الأمر | النتيجة |
|---|---|
| `npm test` | **406/406 ناجح** |
| `npm run test:rules:static` | ناجح |
| `npm run test:rules` (محاكي Firestore محلي، JDK 21 محلي) | **24/24 ناجح** |
| `npm run build` | ناجح (تحذير حجم حزمة Firebase فقط) |
| `npm run lint` | ناجح |

ملاحظة: شُغّل المحاكي على منفذ بديل (8099) لأن المنفذ 8080 مشغول في بيئة التنفيذ. النتيجة من المحاكي الفعلي وليست فحصاً نصياً.

## 3) مطابقة اختبارات القبول

| # | البند | الدليل المحلي | Staging |
|---|---|---|---|
| 1 | تفعيل حساب نشط وجهاز معتمد | `test/entitlementActivation.test.js` | لم يُنفّذ |
| 2 | رفض الحساب الموقوف والجهاز غير المسجل | `test/entitlementActivation.test.js`, `test/deviceHeartbeat.test.js` | لم يُنفّذ |
| 3 | رفض الحمولة المعدلة/التوقيع غير الصحيح | اختبار تعديل `commercialUntil` وفشل التحقق | لم يُنفّذ |
| 4 | رفض تبديل الجهاز دون موافقة | `test/entitlementActivation.test.js` (409 + رفض غير المدير) | لم يُنفّذ |
| 5 | تسجيل البيع مرة واحدة ورفض التعارض | `test/salesIngestHandler.test.js` (201/200/409) | لم يُنفّذ |
| 6 | رفض HMAC وتدوير السر | `test/salesIngest.test.js`, `test/networkSecretStore.test.js` | لم يُنفّذ |
| 7 | منع السر البديل عند تعذر الجلب | `test/networkSecretApi.test.js` (503 بلا سر) | لم يُنفّذ |
| 8 | صلاحيات الميزات بعد تغييرها | `test/accountFeatures.test.js` | لم يُنفّذ |
| 9 | تكرار ACK دون تكرار التسجيل | `test/templateCenterApi.test.js` | لم يُنفّذ |
| 10 | منع كتابة العميل على Firestore | محاكي القواعد 24/24 | لم يُنفّذ على المشروع المنشور |
| 11 | انتهاء الاستحقاق مع السماح بالمزامنة/الدعم/القراءة | `isSaleAllowedForAccount` لمبيعات outbox السابقة للانتهاء + `maxOfflineUntil` | لم يُنفّذ |
| 12 | اختلاف توقيت الجهاز | `serverTime` من الخادم، رفض HMAC بعد 6 دقائق، ورفض `createdMs` المستقبلي | لم يُنفّذ على جهاز فعلي |

## 4) ما لم يُنفّذ وسببه

1. **اختبارات Staging الفعلية:** لا توجد بيانات اعتماد Staging (Firebase/Vercel/حسابات اختبار) في هذه البيئة. لم يُدّع نجاحها.
2. **فحص قواعد Firestore المنشورة:** محاولة قراءة `firebaserules.googleapis.com/v1/projects/kroty-434e3/releases` أعادت **403** لأن الطلب بلا هوية مصرح لها. القواعد المحلية اختُبرت بالمحاكي، لكن المطابقة مع المنشور غير مثبتة.
3. **النشر إلى Vercel/الإنتاج:** لا توجد بيانات اعتماد ولا رابط نشر موثّق. الحالة `Unknown`.
4. **توقيع الجهاز وAttestation وTLS Pinning:** غير منفّذة في هذا المستودع، وموثقة في `docs/DEVICE_ATTESTATION_STATUS_AR.md`. لم تُفرض ترويسات جديدة.
5. **اختبار تطبيق Flutter الفعلي:** مستودع `Krotak-Pro` غير موجود في مساحة العمل؛ لم يُعدّل ولم يُشغّل.

## 5) تغييرات تحتاج موافقة قبل الإنتاج

1. نشر `firestore.rules` بعد مراجعة الفرق وخطة تراجع؛ القواعد الجديدة تقفل حقول الاستحقاق.
2. ضبط `ENTITLEMENT_PRIVATE_KEY` و`ENTITLEMENT_OFFLINE_GRACE_MS`/`ENTITLEMENT_MAX_OFFLINE_MS` في Vercel وإعادة النشر.
3. تشغيل تدوير مفتاح الشبكة فعلياً عند الحاجة؛ العملية متاحة للمدير فقط وتحتفظ بالمفتاح السابق 24 ساعة افتراضياً.
4. تفعيل `KROTAK_ENABLE_ENTITLEMENT_LEASE` في تطبيق Android بعد اختبار جهاز فعلي.
5. أي إغلاق لمسار المبيعات القديم المباشر في Firestore يحتاج قراراً لأنه قد يكسر إصدارات Android القديمة؛ لم يُغلق في هذه الجولة.

## 6) مخاطر متبقية معلنة

- مسار Firestore القديم `networks/{networkId}/sales` ما زال يسمح للعميل بإنشاء سجل مبيعات مقيّد حسب العقد الانتقالي القائم؛ المسار REST الجديد `/api/sales/ingest` هو المسار الخادمي الموثوق.
- بعد إعادة الربط، العقد القديم يبقى صالح التوقيع رياضياً لكن الخادم يرفض الجهاز القديم ويزيد `version`؛ لا توجد قائمة إبطال مركزية للعقود.
- قواعد Firestore المنشورة قد تختلف عن المحلية حتى تُفحص بصلاحية إدارية.

## 7) حالة الالتزام والدفع

- **آخر التزام وظيفي:** `070a310` — `fix(entitlements): prevent cross-account installation reuse`
- **التزام الإصلاح الأساسي:** `ecdb152` — `fix(integration): align lease contract, sales ingest, key rotation and rules`
- **الدفع:** `origin/development` حتى `070a310` (نجح).
- **main:** لم يُلمس. **فرع جديد:** لم يُنشأ.
- **النشر:** لم يُنفّذ. حالة Vercel `Unknown` لغياب بيانات الاعتماد/الرابط. الالتزام وحده لا يُثبت نشراً.
