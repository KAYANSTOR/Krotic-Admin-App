# معمارية «الإدارة المحلية أولًا» — لوحة كروتك برو

> **الحالة:** مطبَّقة على الفرع `cline/tp5e5bzb` (مبني على `feat/local-first-admin`).
> **ما تعنيه:** كل شاشات الإدارة تقرأ من IndexedDB (Dexie) وليس من Firestore.
> Firestore يُقرأ **فقط** داخل محرك مزامنة تزايدي واحد، ثم تُقرأ الشاشات محليًا.

## 1. الطبقات

| الطبقة | الملف | المسؤولية |
|---|---|---|
| قاعدة محلية لكل مدير | `src/lib/localDb/db.js` | مخطط Dexie (`SCHEMA_VERSION = 1`)، اسم قاعدة مشتق من UID، حذف كامل عند الخروج |
| ناقل أحداث | `src/lib/localDb/syncEvents.js` | `onSyncEvent` / `emitSyncEvent` — يُبلّغ الشاشات بحدوث صفوف جديدة بلا مستمع Firestore |
| نواة المزامنة (نقية) | `src/lib/localDb/syncCore.js` | `syncSource`, `applyRows`, `applyTombstones`, `createSyncController` — بلا Firebase ليمكن اختبارها |
| محرك Firebase | `src/lib/localDb/syncEngine.js` | المصادر العشرة، `latestMs` (فحص قراءة واحدة)، `pullSince` (صفحات 300 مع `startAfter`)، `syncAll`, `resetSyncCursors` |
| مزامنة تلقائية | `src/lib/localDb/useAutoSync.js` | عند الدخول/عودة التبويب/عودة الإنترنت |
| مزوّد React | `src/lib/localDb/LocalDbContext.jsx` | ينشئ/يغلق القاعدة، `runSync`, `syncing`, `lastSyncAt` |
| استعلامات محلية | `src/lib/localDb/localQueries.js` | حسابات تقريرية نقية (لوحة التحكم، الفوترة، التدقيق، الإشعارات) |
| واجهة تحميل | `src/lib/localDb/localData.js` | `loadLocalUsers/Config/Dashboard/UsersWithBilling/NetworkSales/BillingHistory/Admins/AuditLogs/Notifications/UserOptions` |
| خطّاف القراءة | `src/lib/localDb/useLocalQuery.js` | يعيد القراءة بعد كل حدث مزامنة، بلا أي استدعاء Firestore |

## 2. القواعد الست (غير قابلة للكسر)

1. **لا `onSnapshot` على مجموعة كاملة.** المستمع الوحيد المتبقي في الواجهة هو
   «أحدث مستخدم» في `Layout.jsx` بـ `limit(1)` (قراءة واحدة، وليس المجموعة).
2. **لا `getDocs` على مجموعة كاملة خارج `syncEngine.js`.** المتبقي في
   `src/lib/adminApi.js` (حذف شبكة) و`UserDevicesPanel` (مجموعة فرعية لجهاز
   مستخدم واحد) — خارج نطاق هذه المرحلة وموثّق كدين تقني.
3. **لا `force`.** القراءة الكاملة تحدث **مرة واحدة لكل جهاز** عند أول مزامنة
   (المؤشر = 0)، ثم تزايدية فقط. `resetSyncCursors` مخصصة لزر مزامنة كاملة يدوي.
4. **الكتابة عبر الخادم فقط** لمجموعات الإدارة/الاستحقاق/القوالب/الدفعات.
5. **لا أسرار ولا بيانات عميل في أي كاش.** لم يبقَ أي كاش إعدادات في
   `localStorage`؛ المتبقي فيه تفضيلات واجهة فقط (فلاتر، قنوات الإشعارات، تقدم
   إصلاح المجاميع).
6. **الفصل بين المفاهيم:** قوالب SMS الصادرة ≠ FCM ≠ قوالب التحويل الواردة ≠
   المحافظ كمصادر رسائل ≠ الاستحقاقات/lease. المحافظ ليست أرصدة مالية.

## 3. مسار القراءة عمليًا

```
فتح شاشة  →  useLocalQuery(queryFn(localDb))  →  IndexedDB (0 قراءات Firestore)
                     ↑
             onSyncEvent (صار حدث مزامنة)
                     ↑
زر التحديث/السحب/العودة  →  runSync()  →  10 فحوص latestMs + فروق فقط
```

| الحالة | قراءات Firestore |
|---|---|
| التنقل بين الشاشات | **0** |
| فتح اللوحة بعد مزامنة حديثة | **0** حتى يمر فاصل الدقيقة أو يحدث تحديث |
| زر التحديث بلا تغييرات | **10** فحوص (`SOURCES.length`) |
| زر التحديث بعد N تغييرًا | 10 فحوص + المستندات المتغيّرة فقط |
| أول تشغيل على جهاز جديد | قراءة كاملة **مرة واحدة** لكل مصدر |

## 4. الشاشات المرحَّلة (12/12)

`AuthContext` (لا قراءة بيانات إدارة؛ فقط مستند `Admins/{uid}` للتحقق من
الجلسة)، `Layout`، `UserBillingModal`، `AdminsPage`، `DashboardPage`،
`UserProfilePage`، `AuditPage`، `SettingsPage`، `PaidFeaturesPage`،
`NotificationsPage`، `SalesPage`، `UsersPage`.

`src/lib/adminData.js` و`src/lib/adminDataCache.js` **حُذفا** بالكامل، مع
`test/adminDataCache.test.js`. لا يبقى أي استيراد لـ`adminData` في `src/`.

## 5. ما يعرضه كل خطّاف

- `AdminsPage`: `loadLocalAdmins`
- `AuditPage`: `loadLocalAuditLogs(localDb, 200)` + ترقيم محلي (لا استعلام Firestore)
- `DashboardPage`: `loadLocalDashboard` + `loadLocalNetworkSales` (لآخر العمليات)
- `NotificationsPage`: `loadLocalUserOptions` + `loadLocalNotifications`
- `PaidFeaturesPage`: `loadLocalUserOptions` (الاستحقاق نفسه يُقرأ من المسار الخادمي)
- `SalesPage`: `loadLocalNetworkSales` (كل مبيعات الشبكات، بلا لقطات حيّة)
- `SettingsPage`: `loadLocalConfig`
- `UsersPage` / `UserProfilePage` / `UserBillingModal`: `loadLocalUsersWithBilling`
  و`loadLocalBillingHistory`

## 6. كيف تضيف شاشة جديدة بأمان

1. اكتب دالة تحميل في `localData.js` تقرأ من جدول محلي موجود.
2. اجعل الشاشة تستخدم `useLocalQuery` فقط، و`runSync({ reason: 'manual' })` في
   زر التحديث/السحب.
3. إن احتجت جدولًا جديدًا: أضِفه إلى `db.js` **وارفع `SCHEMA_VERSION`**، وأضِف
   مصدرًا إلى `SOURCES` في `syncEngine.js` (مع `updatedAtMs` في كتابات الخادم
   و`sync_tombstones` عند الحذف).
4. لا تكتب من المتصفح على مجموعات الإدارة/الاستحقاق/القوالب.

## 7. دين تقني معروف (لم يُخفَ)

- `src/lib/adminApi.js` (حذف شبكة) لا يزال يقرأ مجموعات فرعية من العميل، ولم
  يُحوَّل إلى `POST /api/networks { action: 'delete' }`. تحويله يمس مسار حذف
  حسابات — يحتاج مراجعة منفصلة وموافقة قبل أي تشغيل على بيانات حقيقية.
- `boost`/`getAggregateFromServer` لم يبقَ لها استخدام في الشاشات.
- الفحص التزايدي يحتاج **10** قراءات (مصدر لكل مجموعة) مقابل هدف الخطة (~6).
  تقليلها يحتاج دمج فحوص المصادر في استعلام واحد، وهو تغيير على عقد المزامنة
  وليس على الشاشات.
