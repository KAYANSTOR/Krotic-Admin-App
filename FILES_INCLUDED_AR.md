# حزمة الملفات المطلوبة — Krotak Admin

المستودع: KAYANSTOR/Krotic-Admin-App
الفرع المصدر: ux/dashboard-declutter
Commit المصدر: 32012ff9e03eb86a8d21deae4391112ca4ab0a50
ملفات المصدر والاختبارات المدرجة: 136
متغيرات البيئة المدرجة بأسماء فقط: 20

## النطاق
تحتوي الحزمة على ملفات الإعداد المطلوبة، UI، Modals، Data/Lib/Auth، Layouts الفعلية، جميع ملفات src/pages/ بما فيها صفحات مركز القوالب، ملفات CSS الموجودة، وكل محتويات test/ ذات الصلة، إضافة إلى project-tree.txt.

## حماية البيئة
ملف .env.example في هذه الحزمة منقّح: أسماء المتغيرات فقط مع قيم فارغة. لا تتضمن الحزمة .env.local أو قيمًا سرية.

## أسماء مختلفة أو ملفات غير موجودة
- src/components/ui/ConfirmDialog.jsx (الفعلي: src/components/ConfirmDialog.jsx)
- public/manifest.json (الفعلي: public/manifest.webmanifest)
- public/sw.js (الفعلي: public/service-worker.js)
- src/components/layout/AppShell.jsx / AppHeader.jsx / TopAppBar.jsx (لا توجد ملفات مستقلة بهذا المسار؛ راجع src/components/Layout.jsx)
- src/components/layout/BottomNav.jsx و Sidebar.jsx (الفعليان في src/components/)
- src/components/RouteGuard.jsx (الفعلي: src/components/ProtectedRoute.jsx)
- src/routes/index.jsx / src/router.jsx (لا توجد ملفات مستقلة بهذا الاسم؛ راجع src/App.jsx و src/lib/routeLoaders.js)
- src/pages/AuditLogPage.jsx (الفعلي: src/pages/AuditPage.jsx)
- src/pages/AccountNotificationsPage.jsx / src/pages/NotFoundPage.jsx (لم يتم العثور عليهما في هذا الفرع)
- src/hooks/useAuth.js (لم يتم العثور عليه؛ راجع src/contexts/AuthContext.jsx)
- src/styles/*.css (لا توجد ملفات بهذا المسار؛ CSS الأساسي src/index.css)

## المصدر
تمت إعادة استخدام ملفات Git blobs من اللقطة المحددة أعلاه. الفرع الأصلي لم يتم تغييره.
