# تشخيص فشل CI على `main` — تقرير أدلة (2026-10-22)

> **الخلاصة بصراحة:** لم أستطع قراءة سجل CI الفعلي من بيئتي (كل نقاط
> GitHub Actions المتاحة لهذا التكامل تُرجع `403 Resource not accessible by
> integration`). لذلك **سبب فشل CI يبقى `Unknown`**. ما أستطيعه وأثبتُه: **لا
> يوجد فشل قابل لإعادة الإنتاج في الكود** — نفّذت كل خطوات `ci.yml` محليًا،
> بما فيها اختبارات قواعد Firestore على المحاكي، ونجحت كلها.

## 1. ما جرى محاولته لقراءة سجل CI (كلها فشلت)

| الاستدعاء | النتيجة |
|---|---|
| `gh run list --branch main` | `403 Resource not accessible by integration` |
| `gh run list` | `403` |
| `gh api repos/…/actions/runs` | `403` |
| `gh api repos/…/commits/<sha>/check-runs` | `403` |
| `gh api repos/…/commits/<sha>/status` | `403` |
| `gh api repos/…/actions/workflows` | `403` |
| `gh api repos/…/actions/permissions` | `403` |

الحساب المستخدم هو `cline-cloud[bot]` عبر `GH_TOKEN`، ولا يملك نطاق
`actions:read` على هذا المستودع. **لا يوجد بديل**: السجل نفسه غير مقروء من هنا.

> لذلك أي عبارة من نوع «السبب هو الفوترة» أو «السبب هو Java» في أي تقرير
> سابق هي **استنتاج غير مثبت**. السابق الذي كتب «صفر خطوات منذ التشغيل
> #268» هو ملاحظة من واجهة GitHub رآها إنسان، وليست قراءة سجل متاحة لي.

## 2. إعادة إنتاج `ci.yml` محليًا — خطوة بخطوة

| خطوة `ci.yml` | الأمر | النتيجة |
|---|---|---|
| Install web deps | `npm install` | ✅ `exit 0` |
| Test admin unit suite | `npm test` | ✅ **315/315** (0 fail) |
| Java 21 (setup-java) | نزّلت Temurin **21.0.13+9** إلى `.jdk/` (غير متعقَّب) | ✅ `openjdk 21.0.13` |
| Test Firestore rules | `npm run test:rules` | ✅ **20/20** (0 fail) |
| Build admin dashboard | `npm run build` | ✅ `vite build` نجح (تحذير حجم حزمة فقط) |
| Install function deps | `cd functions && npm install` | ✅ `exit 0` |
| Test Cloud Functions | `cd functions && npm test` | ✅ **18/18** |
| Validate function syntax | `node --check index.js` | ✅ |

إضافةً: أعدت تشغيل المجموعتين تحت **Node 22** (نسخة CI) عبر
`npx node@22`:
- `node@22 --test test/*.test.js` → **315/315**.
- `node@22 --test` داخل `functions/` → **18/18**.

### ملاحظتان تقنيتان عن بيئتي (ليستا مشكلتين في المستودع)

1. **المنفذ 8080 مشغول** في هذه البيئة بخدمة أخرى، فالمحاكي لا يستطيع البدء.
   استخدمت ملف إعداد محليًا **غير متعقَّب** `firebase.local-ci.json` (مضاف إلى
   `.gitignore`) ينقل منفذ Firestore إلى `8180` ويقيّد المضيف بـ `127.0.0.1`.
   على GitHub Actions المنفذ 8080 حر، فلا حاجة لتغيير `firebase.json`.
2. **لا IPv6 loopback (`::1`)** هنا، فيشتكي المحاكي من `EADDRNOTAVAIL` على
   `::1` ولا يمنع التشغيل بعد تقييد المضيف.

## 3. الاستنتاج

- **لا فشل كودي قابل لإعادة الإنتاج** في أي من مهمتي CI
  (`build-admin`, `validate-functions`) بأي من إصداري Node (22/24).
- إذا كان CI يفشل فعلًا، فالاحتمالات المتبقية **خارج الكود**:
  تعطيل Actions أو حدّ الفوترة/الحصة، أو عدم تشغيل أي خطوة أصلًا
  (`startup_failure`)، أو انتهاء صلاحية أسرار/بيئة على مستوى المستودع.
- **لم أعدّل `ci.yml`** ولا أي إعداد GitHub، لأن التعديل بلا سجل تشخيصي = تخمين.

## 4. المطلوب من المالك (خطوات دقيقة)

1. افتح **Actions** في المستودع، واختر آخر تشغيل فاشل على `main`، وانسخ:
   الرسالة العلوية (مثل `The job was not started…` أو `This workflow run failed
   to start`) + أول 20 سطرًا من سجل المهمة.
2. تحقق من **Settings → Billing** (دقائق Actions) و**Settings → Actions →
   General** (هل Actions مسموح لهذا المستودع؟).
3. إن كان التشغيل يبدأ ويفشل داخل خطوة، أرسل اسم الخطوة؛ وقتها يمكن إصلاح
   الكود بدليل لا بتخمين.

## 5. ملاحظة عن عدد الاختبارات

العدد انخفض من **334** إلى **315** بعد حذف `test/adminDataCache.test.js`
(19 اختبارًا) مع حذف `src/lib/adminDataCache.js` في المرحلة 5. لم يُحذف أي
اختبار آخر، وأُعيدت صياغة 6 اختبارات كانت تقرأ نص `src/lib/adminData.js`
المحذوف لتتحقق من نفس الضمانات على الطبقة المحلية.
