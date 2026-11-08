# خط الأساس — لوحة الإدارة والخادم (Krotak)

> هذه الوثيقة هي المرجع الوحيد لحالة الخادم ولوحة الإدارة وقراراتهما. أي وثيقة أو تعليق يخالفها يُعدّ قديمًا.
> العقود القابلة للتنفيذ في `contracts/schemas` ومربوطة بالكود عبر `test/contracts.test.js` و`test/appServerContracts.test.js`.
> الخطة التنفيذية في [`PLAN_AR.md`](PLAN_AR.md).

## 1. مصادر الحقيقة

| الموضوع | المصدر الوحيد |
|---|---|
| حالة وصول الحساب (ترخيص/بيع/نبضة) | `server/_lib/accountAccess.js` |
| نقل الترخيص بين التثبيتات | `server/_lib/deviceTransferPolicy.js` |
| إصدار عقد الجهاز الموقّع (lease) | `server/_lib/entitlementActivation.js` |
| هوية البيع (المعرّف ومستند Firestore) | `server/_lib/saleIdentity.js` |
| استقبال المبيعات والعمولة | `server/apiHandlers/sales-ingest.js` |
| مخططات العقود | `contracts/schemas/*.schema.json` |
| صلاحيات Firestore للعميل | `firestore.rules` + `security-tests/` |
| مسارات API | `vercel.json` + `api/router.js` |

## 2. البنية

- **Vercel** (المشروع `krotak-pro`) هو بيئة التشغيل الخادمية الوحيدة. دالتان فقط:
  `api/router.js` (كل المسارات العامة) و`api/dispatch-notifications.js` (cron يومي).
  المعالجات الفعلية في `server/apiHandlers/*` و`server/_lib/*`.
- **Firestore** المشروع `kroty-434e3`. الكتابة الحساسة كلها من الخادم عبر Admin SDK.
- **لوحة الإدارة**: React + Vite، تُنشر مع نفس مشروع Vercel، وتعمل local-first (IndexedDB) وفق `ADMIN_LOCAL_FIRST_ARCHITECTURE_AR.md`.
- **تطبيق Android** (مستودع `Krotak-Pro`، فرع العمل `feature/paid-features`) يتصل عبر REST فقط.
- لا توجد Firebase Cloud Functions. المجلد السابق `functions/` حُذف لأنه لم يُنشر قط (لا توجد أي بيانات يكتبها في الإنتاج).

## 3. المسارات

| المسار | المستدعي | الغرض | العقد |
|---|---|---|---|
| `POST /api/entitlements/activate` | التطبيق | إصدار/تجديد عقد الجهاز الموقّع | `entitlement-activate-request`, `entitlement-lease` |
| `POST /api/entitlements/device-rebind` | الإدارة | إعادة ربط الحساب بتثبيت جديد | — |
| `POST /api/sales/ingest` | التطبيق | رفع بيع مكتمل | `sales-ingest-request` |
| `POST /api/sales/cancel` | التطبيق (جهاز مالك الشبكة) | إلغاء بيع غير مدفوع وعكس قيمته وعمولته (idempotent) | `sales-cancel-request` |
| `POST /api/device-heartbeat` | التطبيق | نبضة تشخيص | `device-heartbeat-request` |
| `GET /api/device-heartbeats` | الإدارة | قائمة النبضات | — |
| `POST /api/inventory/snapshot` | التطبيق | ملخص أعداد المخزون | `inventory-snapshot` |
| `GET/POST /api/network-secret` | التطبيق | سر HMAC للشبكة | — |
| `POST /api/register-network` | التطبيق | تسجيل شبكة جديدة | — |
| `GET /api/account-notifications` | التطبيق | إشعارات الحساب | — |
| `POST /api/template-center` | التطبيق + الإدارة | إصدارات القوالب وACK | `template-*` |
| `POST /api/admin/account-features` | الإدارة | المزايا المدفوعة | `account-features*` |
| `POST /api/networks` | الإدارة | provision / update-access / renew / repair-access / batch-expiry / delete | — |
| `POST /api/settlement`, `/api/record-payment` | الإدارة | التسوية وتسجيل الدفعات | — |
| `/api/admins`, `/api/admin-session`, `/api/settings`, `/api/manage-user-auth`, `/api/send-fcm`, `/api/migrate` | الإدارة | إدارة | — |

أي مسار جديد يُضاف إلى `vercel.json` و`api/router.js` فقط، ويُغطّى في `test/vercelFunctionLimit.test.js`.

## 4. الوصول والترخيص

1. **حالة الحساب** تُحسم في `resolveAccountAccess`: يُقارن سجل `users/{uid}` بسجل `networks/{networkId}` بالطابع `accessUpdatedAtMs` ويُعتمد الأحدث (وعند غيابه سجل المستخدم). الحالات التجارية: `TRIAL` و`ACTIVE_PAID` مع نهاية مستقبلية. السجلات القديمة بلا `accessStatus` تُقبل فقط إذا `is_active === true`. الأسباب: `active`, `subscription_expired`, `account_suspended`, `access_state_missing`.
2. **كل مسار يكتب الوصول** (تفعيل، تجديد، إيقاف، cron الانتهاء، التسوية) يكتب `accessUpdatedAtMs` عبر `accessStamp()`.
3. **عقد الجهاز (lease)**: Ed25519، المفتاح `ed25519-krotak-2026-10-v1`. العمليات `sell, settle, sync, support, readOnly`. `commercialUntil` = نهاية الاشتراك. `maxOfflineUntil = min(commercialUntil + 7 أيام، issuedAt + 29 يومًا)`، أي أن **التطبيق يعمل دون إنترنت حتى 29 يومًا** ما دام الاشتراك ساريًا، ثم يلزمه اتصال واحد للتجديد. ترتيب مفاتيح payload جزء من البايتات الموقّعة.
4. **ربط الجهاز**: أول تثبيت يُحجز ذريًا. إعادة التثبيت تنقل الترخيص ذاتيًا (حد 3 نقلات خلال 30 يومًا، لا عودة لتثبيت مستبدل، تدقيق `ENTITLEMENT_DEVICE_SELF_TRANSFER`). بعد الحد: `409 installation_mismatch` وإعادة ربط من الإدارة. الربط المتروك من حساب محذوف يُحرَّر تلقائيًا.
5. **النبضة** تشخيص فقط ولا تمنح ولا تسحب وصولًا. تُقبل مرة كل 15 دقيقة لكل تثبيت.

## 5. المبيعات والمال

1. **مسار البيع الوحيد** `POST /api/sales/ingest` (والإلغاء عبر `POST /api/sales/cancel`، البند 9). قواعد Firestore تمنع أي كتابة مباشرة على `networks/*/sales` (حتى للمشرف). كل مبيعات الإنتاج (45) جاءت عبر الخادم.
2. **التوثيق**: `Authorization: Bearer <ID token>` + `x-verification-receipt: <timestamp>.<HMAC-SHA256 بسر الشبكة>` على payload الطلب.
3. **المعرّف**: `saleUuid` (والاسم القديم `saleId`) بالأبجدية `[A-Za-z0-9._-]` من 1 إلى 128 حرفًا. المعرّفات القديمة بلا نقطة تبقى اسم المستند. غيرها يُخزَّن باسم `sha256("sale_uuid:"+id)`.
4. **المبلغ** بالريال اليمني (`YER`) بوحدات minor، ويجب أن يكون ريالًا صحيحًا.
5. **العمولة والتسوية** يحسبها الخادم فقط. أي حقل هوية أو عمولة أو تسوية من العميل يُرفض.
6. **عدم التكرار**: نفس المعرّف ونفس `payloadHash` يعطي `200 ALREADY_EXISTS_ACKED`، وحمولة مختلفة تعطي `409`.
7. **البيع يُقبل** إذا كان وقت إنشائه داخل فترة الوصول (`saleAllowedByAccess`)، حتى لو وصل بعد انتهاء الاشتراك (مبيعات العمل دون اتصال).
8. **الدفعات والتسويات** من الإدارة فقط (`/api/settlement`, `/api/record-payment`) بمفتاح idempotency.
9. **مسار الإلغاء الوحيد** `POST /api/sales/cancel` من جهاز مالك الشبكة، بنفس توثيق `sales/ingest` (ID token لحساب عميل، والمدير يُرفض `403 not_client_account`، وHMAC بسر الشبكة الحالي أو السابق خلال نافذة التدوير، وانحراف ±5 دقائق). لا يُشترط اشتراك ساري لأن الإلغاء مزامنة ويخفض العمولة فقط، لكن ملكية الشبكة شرط. لا مسار كتابة مباشر في Firestore (`networks/*/sales` تبقى `allow write: if false`)، واللوحة تعرض النتيجة فقط.
10. **جسم الإلغاء**: `saleUuid` (أو `saleId` القديم، ويجب تطابقهما)، `cancellationId` بالنمط `^[A-Za-z0-9._-]{8,128}$`، `cancelledMs` عدد صحيح موجب لا يتجاوز المستقبل بأكثر من 24 ساعة (`cancelled_at_in_future`)، و`reason` من `device_reversal | customer_return | delivery_failed | operator_error`. أي حقل هوية أو مال أو تسوية يُرفض بنفس رموز `sales/ingest`. قاعدة التطبيق: `cancellationId = "cxl_" + أول 32 خانة hex من sha256("sale_cancel:" + saleUuid)`، و`cancelledMs` يُحفظ عند أول اكتشاف ويُعاد كما هو في كل محاولة.
11. **التوقيع**: `x-verification-receipt: <timestampMs>.<HMAC-SHA256(سر الشبكة، timestampMs + "." + canonical)>` حيث canonical بالترتيب الحرفي `{"saleId","uid","cancellationId","cancelledMs","reason"}` (`uid` من التوكن). توقيع `sales/ingest` لا يصلح للإلغاء.
12. **البيع القابل للإلغاء**: حالته `COMPLETED` (أو بلا حالة في السجلات القديمة)، و`paidRiyal == 0` و`settlement_status == PENDING_SETTLEMENT`، وله `amountRiyal` و`commissionRiyal` خادميان. يُعلَّم في مستنده الأصلي (لا يُحذف) بدمج حقول الإلغاء فقط: `status` و`settlement_status` = `CANCELLED`، `cancellationId`، `cancelReason`، `cancelledAtMs`، `cancelledAt`، `cancelReceivedAtMs`، `cancelVerificationReceipt`، `cancelledAmountRiyal`، `cancelledCommissionRiyal`، `updatedAtMs`. حقول الرفع و`payloadHash` و`verificationReceipt` و`createdAt` لا تتغير.
13. **عكس الإجماليات** في نفس المعاملة: `totalSalesAmount -= amountRiyal` و`totalCommissionDue -= commissionRiyal` (بحد أدنى صفر)، ثم `outstandingBalance = max(0, totalCommissionDue - totalPaidAmount)`، مع تدقيق `admin_audit_logs/sale_cancel_<saleDocId>` بالإجراء `SALE_CANCELLED_BY_DEVICE`. البيع يحتفظ بـ `createdAt` فيتأثر شهره فقط (Asia/Aden)، ولا يُعاد فتح أي شهر مغلق.
14. **البيع المدفوع** (`paidRiyal > 0` أو `settlement_status` = `PARTIAL`/`SETTLED`) لا يُلغى آليًا: `409 sale_already_settled` ويُسجَّل الطلب في `sale_cancellation_registry/{uid}_{saleDocId}` بالسبب `sale_already_settled` لمراجعة الإدارة (الاسترداد أو الرصيد إجراء مالي يدوي). أي حالة أخرى غير معروفة: `409 sale_not_cancellable`. البيع غير الموجود: `404 sale_not_found` بلا أي كتابة.
15. **عدم التكرار في الإلغاء** على مستوى البيع: بيع ملغى مسبقًا يعطي `200 ALREADY_CANCELLED_ACKED` مع `cancellationId` المخزَّن، بلا كتابة.
16. **العمولة والتسوية** تحسبان المبيعات `COMPLETED` (أو القديمة بلا حالة) فقط. المبيعات `CANCELLED` مستبعدة في كل مكان: التسوية الشهرية، إجماليات الشبكة (تُعكس عند الإلغاء)، وملخصات اللوحة والتفصيل الشهري وملف العميل وصفحات المبيعات.
17. **إعادة رفع بيع ملغى** بنفس الحمولة لا تعيد تفعيله: `sales/ingest` يعطي `200 ALREADY_EXISTS_ACKED` مع `saleStatus: "CANCELLED"` بلا أي كتابة.

## 6. واتساب

- **القرار**: إرسال الكروت عبر واتساب يتم **على الهاتف فقط** من تطبيق WhatsApp المثبّت (العادي أو الأعمال بحسب اختيار العميل)، بنفس منطق SMS، ويُلتقط إشعار سلفني منه. لا Cloud API، ولا QR، ولا بوابة خادمية.
- **الخادم** لا يملك أي مسار أو سر أو مجموعة Firestore لواتساب. دوره الوحيد هو مفتاح الميزة المدفوعة `whatsapp_card_delivery` في `account-features`.
- المجموعات القديمة `whatsapp_*` مغلقة بقاعدة الرفض الافتراضية في `firestore.rules`.

## 6.1 التسجيل

- التسجيل بالبريد/كلمة المرور فقط عبر `POST /api/register-network`. **لا يوجد OTP ولا توثيق هاتف** (لا مسارات، ولا حقول `phone_verified*`، ولا واجهة في اللوحة). رقم الهاتف بيانات تعريف فقط.

## 7. سجل القرارات المحسومة

| # | القرار | بدلًا من |
|---|---|---|
| ق1 | Vercel بيئة التشغيل الوحيدة؛ لا Cloud Functions | `functions/` غير المنشور |
| ق2 | مرجع وصول موحّد (`accountAccess`) والأحدث بـ `accessUpdatedAtMs` | "وثيقة المستخدم دائمًا" / `updatedAtMs` العام |
| ق3 | نقل ذاتي للترخيص عند إعادة التثبيت (3/30 يومًا) | رفض أي تثبيت مختلف |
| ق4 | العمل دون اتصال حتى 29 يومًا | نافذة قصيرة / 30 يومًا |
| ق5 | معرّف بيع بنقطة مقبول، ومستند بالـ hash | رفض `sale_id_invalid` |
| ق6 | واتساب على الهاتف فقط (WhatsApp العادي أو الأعمال) | Cloud API / بوابة QR / تسليم خادمي |
| ق7 | المبيعات تُكتب من الخادم فقط | كتابة مباشرة من المالك/المشرف |
| ق8 | لا OTP ولا توثيق هاتف عند التسجيل | OTP عبر Twilio Verify |
| ق9 | العقود في `contracts/schemas` مرجع للتطبيق واللوحة | نسخ متفرقة في `docs/contracts` |
| ق10 | اختبارات قواعد Firestore منفصلة في `security-tests/` | ضمن `npm test` |
| ق11 | (O-08) جهاز مالك الشبكة هو المصدر الوحيد لإلغاء المبيعات عبر `POST /api/sales/cancel` بتوثيق `sales/ingest` نفسه؛ اللوحة تعرض النتيجة فقط | كتابة مباشرة في Firestore / إلغاء من اللوحة |
| ق12 | (O-07) البيع غير المدفوع يُلغى في مستنده الأصلي وتُعكس قيمته وعمولته من إجماليات الشبكة في نفس المعاملة؛ البيع المدفوع `409 sale_already_settled` ويُسجَّل لمراجعة الإدارة؛ العمولة والتسوية تحسبان `COMPLETED` فقط | حذف البيع / تعديل الأشهر المغلقة أو المدفوعة آليًا |

## 8. السيناريوهات المعتمدة

| السيناريو | النتيجة المتوقعة |
|---|---|
| تثبيت أول لحساب نشط | `200` + lease، البيع مفتوح |
| إعادة تثبيت على نفس الهاتف أو هاتف جديد | نقل ذاتي + lease جديد (حتى 3 مرات/30 يومًا) |
| النقل الرابع خلال 30 يومًا | `409 installation_mismatch` + طلب معلّق يظهر في اللوحة للموافقة |
| تثبيت مرتبط بحساب آخر قائم | `409 installation_bound_to_another_account` |
| انتهاء الاشتراك | `403 account_not_eligible`، التطبيق مزامنة فقط |
| إيقاف إداري | `403`، شاشة إيقاف مؤكدة في التطبيق |
| انقطاع الإنترنت | البيع يستمر حتى `maxOfflineUntil` ثم مزامنة فقط حتى الاتصال |
| بيع دون اتصال يُرفع بعد انتهاء الاشتراك | مقبول إذا أُنشئ داخل فترة الوصول |
| رفع نفس البيع مرتين | `200 ALREADY_EXISTS_ACKED` |
| نفس المعرّف بحمولة مختلفة | `409` |
| معرّف منقّط مثل `7850.73` | `201`، المستند باسم hash |
| إلغاء بيع غير مدفوع من جهاز المالك | `200 CANCELLED` + `reversedAmountRiyal`/`reversedCommissionRiyal`، وتُعكس الإجماليات |
| إعادة إرسال نفس الإلغاء (أو بعد نجاحه) | `200 ALREADY_CANCELLED_ACKED` بلا كتابة |
| إلغاء بيع عليه دفعة (`PARTIAL`/`SETTLED` أو `paidRiyal > 0`) | `409 sale_already_settled` + سجل في `sale_cancellation_registry` |
| إلغاء بيع غير موجود | `404 sale_not_found` بلا كتابة |
| إلغاء بيع بحالة غير معروفة | `409 sale_not_cancellable` |
| إلغاء من حساب مدير أو من غير مالك الشبكة | `403 not_client_account` / `403 network_owner_mismatch` |
| إعادة رفع بيع ملغى بنفس الحمولة | `200 ALREADY_EXISTS_ACKED` + `saleStatus: "CANCELLED"`، ولا يُعاد تفعيله |
| خادم قديم بلا مسار الإلغاء | `404 api_route_not_found`؛ يبقى الإلغاء معلّقًا في التطبيق ويُعاد لاحقًا |

## 9. الإجراءات

- **النشر**: الدفع إلى `main` ينشر Vercel تلقائيًا. القواعد والفهارس لا تُنشر مع Vercel: `firebase deploy --only firestore:rules,firestore:indexes --project kroty-434e3`.
- **الاختبارات قبل أي دمج**: `npm test` ثم `npm run build` ثم `npm run test:rules:static`. وعند تعديل القواعد: `npm run test:rules` (تتطلب Java).
- **نقل الترخيص بعد بلوغ الحد**: عند رفض النقل الذاتي يسجّل الخادم `users/{uid}.entitlementPendingTransfer` (التثبيت الجديد والسبب). يظهر في ملف العميل ← "التطبيق والجهاز" ← "الموافقة على النقل" مع سبب إلزامي، فتُستدعى `device-rebind` ويُرفع إصدار العقد ويُكتب التدقيق `ENTITLEMENT_DEVICE_REBIND`. أي تغيير في الربط يرفع `updatedAtMs` لتراه مزامنة اللوحة.
- **تجديد**: `networks` action `renew` (30 يومًا)، ويُكتب `accessUpdatedAtMs`.
- **تدوير مفتاح lease**: مفتاح جديد بـ `keyId` جديد يُضاف للتطبيق أولًا ثم للخادم. لا يُستبدل المفتاح الحالي قبل وصول التطبيق الجديد للعملاء.
- **الفروع**: `main` فقط فرع دائم. أي عمل في فرع قصير يُدمج بعد اختبارات خضراء ثم يُحذف.

## 10. فهرس العقود

`contracts/schemas`: `entitlement-activate-request`, `entitlement-lease`, `sales-ingest-request`, `sales-cancel-request`, `device-heartbeat-request`, `inventory-snapshot`, `template-release`, `template-ack`, `template-center-ack-request`, `inbound-template`, `outbound-template`, `wallet`, `account-features`, `account-features-catalog`, `android-application-state`, `default-template-catalog`.

وثائق مرافقة: `docs/ENTITLEMENT_LEASE_DEPLOYMENT_AR.md`, `docs/TEMPLATE_CENTER_CONTRACT_AR.md`, `docs/ACCOUNT_FEATURES_ACK_CONTRACT_AR.md`, `docs/ADMIN_CONTROL_CENTER_CONTRACTS_AR.md`, `docs/contracts/admin-default-catalog-import-contract-2026-10-21.md`.
