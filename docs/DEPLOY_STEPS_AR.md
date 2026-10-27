# ماذا تُنشر بعد هذه التعديلات — خطوات المالك

> **تحديث 2026-10-23:** هذا دليل نشر عام من عمل سابق. المهمة الحالية ترفع التعديلات إلى فرع `cline/f0d32hzt` فقط؛ لا تنفّذ نشر Vercel أو نشر Firestore من هذا الدليل دون طلب منفصل.

> **الخلاصة أولًا:** تغيّر **الكود** و**القواعد** و**الفهارس** و**إعادة توجيه API**.
> حتى تُنشر الثلاثة (Rules + Indexes + Vercel) ستبدو اللوحة **فارغة** رغم أن
> الكود سليم — لأن المزامنة تحتاج قراءة `collectionGroup` (قواعد) وفهرسًا
> (Firestore) ومسارًا خادميًا (Vercel).
>
> لم تُنشر قواعد Firestore أو فهارسها، ولم يُنفَّذ ترحيل `updatedAtMs`؛ نشر واجهة Vercel منفصل عن هذه الخطوات. لا ينفّذ هذا الدليل أي خطوة تلقائيًا.

---

## 0) ما الذي تغيّر فعلًا (`git diff f3a4546..main`)

| الملف/المسار | التغيير | يحتاج نشرًا؟ |
|---|---|---|
| `firestore.rules` | قراءة `collectionGroup` لـ`sales`/`payments` للمدير، ورفض كتابة `account_features` و`template_acks` مباشرة من العميل | ✅ **Firestore Rules** |
| `firestore.indexes.json` | فهارس بنطاق `COLLECTION_GROUP` على `sales.updatedAtMs` و`payments.updatedAtMs` | ✅ **Firestore Indexes** |
| `vercel.json` | `/api/admin/account-features` → `/api/settings?__apiRoute=account-features`؛ `/api/template-center` إلى المسار المشترك | ✅ **Vercel** |
| `api/*`, `server/_lib/*` | account_features وACK latest-only + `updatedAtMs` + `adminBootstrap` | ✅ Vercel |
| `functions/index.js` | `updatedAtMs` على تحديث `admin_aggregates` | ⚠️ **Functions** (Blaze) |
| `src/**` | الطبقة المحلية أولًا وحذف `adminData` | ✅ Vercel |
| `public/service-worker.js` | رفع إصدار الكاش إلى `v5` | ✅ مع الواجهة |
| `package.json` | `dexie`, `dexie-react-hooks` | ✅ تلقائي في بناء Vercel |
| عدد دوال Vercel | **بلا زيادة** (لا ملف `api/*.js` جديد) | — |

> **تحديث 2026-10-27:** أُضيف مسار المخزون `POST /api/inventory/snapshot`
> (`api/inventory/snapshot.js`)، ولإخلاء خانة له نُقل مسار `/api/migrate` الإداري
> إلى موزّع `api/settings` (`__apiRoute=migrate`). العدد الإجمالي بقي 12. النشر
> يحتاج تحديث `firestore.rules` (قراءة إدارية لوثيقة `inventory_snapshot`).

---

## 1) Firestore Rules (الأولوية 1 — بدونها الشاشات فارغة)

```bash
firebase login            # بحسابك؛ لا أستطيع تسجيل الدخول من بيئتي
firebase use <project-id>
firebase deploy --only firestore:rules
```

**بعد النشر يجب أن:** المستخدم العادي لا يقرأ `sales`/`payments` لشبكة ليست له،
ولا يكتب `account_features` أو `template_acks` مباشرة؛ والمدير يقرأ بنجاح.

> تعتمد القواعد على `isAdmin()` (مستند `Admins/{uid}`). تأكد أن حسابك موجود هناك
> قبل النشر، وإلا ستفقد الوصول الإداري.

---

## 2) Firestore Indexes (الأولوية 2 — سبب «requires an index»)

```bash
# 1) نسخة من الفهارس الحالية أولًا (إلزامي)
firebase firestore:indexes > indexes.production.json

# 2) قارن قبل النشر
diff <(python3 -m json.tool firestore.indexes.json) \
     <(python3 -m json.tool indexes.production.json) | head -40

# 3) انشر
firebase deploy --only firestore:indexes
```

**لماذا؟** استعلام المزامنة:
`collectionGroup('sales') where('updatedAtMs','>=',cursor) orderBy('updatedAtMs')`.
الفهارس الأحادية تُنشأ بنطاق **collection** افتراضيًا، واستعلام المجموعة يحتاج
نطاق **collection group** صريحًا — وهو ما أضفته في `fieldOverrides`.

**تحذير:** النشر يستبدل إعداد الفهارس بالملف؛ أي فهرس إنتاجي غير موجود في الملف
قد يُحذف. لذلك الخطوة (1) إلزامية: أضف الناقص إلى الملف قبل النشر.

**التحقق:** `Console → Firestore → Indexes` يجب أن يُظهر
`sales.updatedAtMs` و`payments.updatedAtMs` بحالة **Enabled**، وكذلك فهارس
`template_acks` على `synced_at` و`applied_version_id` بنطاق Collection Group.

> إن رفض CLI سطر `DESCENDING:COLLECTION_GROUP` (نادر)، احذفه من
> `fieldOverrides` في الملف وأعد النشر؛ سطر `ASCENDING` وحده يكفي لاستعلام
> المزامنة، ويكفي `DESCENDING:COLLECTION` لفحص «أحدث تغيير» المُنفَّذ على مستوى
> المجموعة العادية.

---

## 3) Vercel (الواجهة + المسارات الخادمية)

**هوية الـcommit مهمة للنشر:** سبب `BLOCKED` الذي كشفته المراجعة أن بعض commits كُتبت بهوية Git غير مرتبطة بحساب GitHub/Vercel المصرّح، بينما النشر الناجح الأخير كان من commit مرتبط بحساب المالك. استخدم اسمًا وبريدًا مرتبطين بحسابك قبل إنشاء commit، ثم تحقق من `git log -1 --format='%an <%ae>'` ومن أن GitHub يربط المؤلف بحسابك؛ إعادة نشر commit بهوية غير مرتبطة لا تعالج الحظر.

1. **Deploy** من `main` (أو `vercel --prod`). ينتج: بناء Vite جديد بالطبقة
   المحلية + `/api/admin/account-features` و`/api/template-center` عبر دالة Vercel المشتركة.
2. **متغيّرات البيئة** (أسماء فقط، لا تطبع القيم): `FIREBASE_SERVICE_ACCOUNT`
   أو (`FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`)
   حسب إعدادك، إضافة إلى ما تستخدمه `api/send-fcm.js` و`api/admin-session.js`.
3. **تحقق بعد النشر:**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/admin/account-features
   ```
   - `401` = المسار منشور وينتظر مصادقة ✅
   - `404` = الـrewrite لم يُنشر ❌
4. **الأجهزة المثبَّتة (PWA):** عامل الخدمة صار `v5`، فيُحذف الكاش القديم تلقائيًا
   عند أول زيارة. اطلب من المستخدمين تحديث الصفحة مرة واحدة.

---

## 4) Cloud Functions (اختياري الآن — يحتاج Blaze)

`functions/index.js` يضيف `updatedAtMs` عند تحديث `admin_aggregates` (ضروري
لالتقاط تغيّر المجاميع في المزامنة التزايدية):

```bash
firebase deploy --only functions
```

- على **Spark** نشر الدوال غير متاح. النتيجة: المجاميع لا تحمل `updatedAtMs` عند
  تحديثها من الدالة، فلن تلتقطها المزامنة. **بديل مؤقت:** زر «إعادة بناء
  المجاميع» في اللوحة يكتب عبر `/api/migrate` (Admin SDK) ويضيف `updatedAtMs`.
- قرار Spark/Blaze ما زال قرارك (بند 4 من القسم 9). لم أفترضه.

---

## 5) ترحيل `updatedAtMs` للوثائق القديمة (قبل الاستخدام الجدي)

بدونها، أي مستخدم/شبكة/بيعة قديمة **لن تظهر** في اللوحة الجديدة.

```bash
# 1) تجربة بلا كتابة — آمنة (تطبع العدد فقط)
GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> node scripts/backfill-updated-at.mjs

# 2) بعد موافقتك الصريحة على الكتابة
GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> node scripts/backfill-updated-at.mjs --apply
```

هذا **ترحيل بيانات حقيقي**، لذلك لم أشغّله. شغّل (1) وأرسل العدد قبل (2).

---

## 6) ترتيب التنفيذ المقترح (لتجنّب «لوحة فارغة»)

1. **Rules**، ثم 2. **Indexes** (انتظر `Enabled`)، ثم 3. **Vercel**.
4. افتح اللوحة بحساب مدير وراقب `?debug=reads` و`Console → Usage`.
5. **Backfill dry-run**، ثم `--apply` بعد موافقتك.
6. **Functions** إن انتقلت إلى Blaze.

---

## 7) علامات نجاح/فشل سريعة

| ما تراه | المعنى | الإجراء |
|---|---|---|
| اللوحة تفتح وكل القوائم فارغة | مزامنة مرفوضة أو تحتاج فهرسًا | راجع Rules/Indexes وأعد التحميل |
| `Missing or insufficient permissions` | Rules لم تُنشر أو الحساب ليس في `Admins` | خطوة 1 + تحقق `Admins/{uid}` |
| `The query requires an index` | الفهارس لم تكتمل | خطوة 2 |
| `/api/admin/account-features` = 404 | الـrewrite لم يُنشر | تحقق من `vercel.json` ثم انشر الفرع الموافق عليه |
| اللوحة قديمة بعد أول تحديث | كاش عامل الخدمة | تحديث الصفحة، تأكد من `v5` |
| أرقام المجاميع لا تتحدث | الدوال لم تُنشر | خطوة 4 أو زر إعادة بناء المجاميع |

---

## 8) ما لا يجب فعله

- **لا** تنشر الفهارس بلا نسخة احتياطية من فهارس المشروع الحالية.
- **لا** تشغّل `backfill --apply` بلا موافقة صريحة (يكتب وثائق حقيقية).
- **لا** تنشر الواجهة قبل Rules، وإلا ستبدو اللوحة معطوبة بلا سبب واضح.
- **لا** تحذف تاريخ `backups/*.json` بلا موافقة (أُخرجت من الفهرس فقط).
