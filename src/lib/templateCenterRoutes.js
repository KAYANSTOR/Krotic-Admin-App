// ============================================================
// السجل الوحيد لمسارات مركز القوالب وأسمائها الظاهرة.
// ------------------------------------------------------------
// سبب وجوده: كانت الأسماء مكررة في الشريط الجانبي، وشريط الهاتف، وعناوين
// الصفحات، وبطاقات الرئيسية، وتبويبات المركز، فتنحرف عن بعضها بصمت
// («المحافظ والقوالب» / «مركز القوالب والمحافظ» / «المحافظ ومصادر الرسائل»).
// من هنا فقط تُقرأ التسمية العربية؛ الأيقونات تبقى محلية لكل مكوّن.
// ============================================================

export const TEMPLATE_CENTER_ROOT = Object.freeze({
  path: '/template-center',
  label: 'مركز القوالب والنشر',
});

/** التبويبات الخمسة بترتيب العرض المعتمد. */
export const TEMPLATE_CENTER_NAV = Object.freeze([
  { path: '/template-center/wallets', label: 'مصادر الرسائل' },
  { path: '/template-center/inbound', label: 'قوالب الرسائل الواردة' },
  { path: '/template-center/outbound', label: 'الرسائل الصادرة (SMS)' },
  { path: '/template-center/releases', label: 'الإصدارات والنشر' },
  { path: '/template-center/reconciliation', label: 'التسوية والعناصر القديمة' },
]);

/** كل مسارات المركز بما فيها الجذر (لاستخدامها في عناوين الصفحات). */
export const TEMPLATE_CENTER_TITLES = Object.freeze({
  [TEMPLATE_CENTER_ROOT.path]: TEMPLATE_CENTER_ROOT.label,
  ...Object.fromEntries(TEMPLATE_CENTER_NAV.map((item) => [item.path, item.label])),
});
