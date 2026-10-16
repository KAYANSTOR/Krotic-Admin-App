const STORAGE_KEY = 'krotak:notification-templates';
export const BUILT_IN_TEMPLATES = [
  { id: 'builtin-service-update', name: 'تحديث الخدمة', title: 'تحديث جديد لخدمات كروتك', message: 'أطلقنا تحسينات جديدة لتجربة أسرع وأكثر استقراراً. حدّث التطبيق للاستفادة منها.' },
  { id: 'builtin-commission-reminder', name: 'تذكير بالعمولة', title: 'تذكير بسداد العمولة', message: 'نرجو مراجعة مستحقاتكم وسداد العمولة في أقرب وقت لضمان استمرار الخدمة دون انقطاع.' },
  { id: 'builtin-maintenance', name: 'صيانة مجدولة', title: 'تنبيه: صيانة مجدولة', message: 'سيتم إجراء صيانة مجدولة لتحسين الخدمة. قد يتأثر الاتصال مؤقتاً، ونشكركم على تفهمكم.' },
  { id: 'builtin-security', name: 'تنبيه أمني', title: 'تنبيه أمني مهم', message: 'للحفاظ على أمان حسابكم، لا تشاركوا كلمة المرور أو رمز التحقق مع أي شخص.' },
  { id: 'builtin-welcome', name: 'ترحيب بمشترك جديد', title: 'أهلاً بكم في كروتك', message: 'يسعدنا انضمامكم. يمكنكم الآن إدارة شبكتكم ومتابعة خدماتكم بسهولة عبر التطبيق.' },
  { id: 'builtin-service-restored', name: 'عودة الخدمة', title: 'تمت استعادة الخدمة', message: 'عادت الخدمة إلى العمل بصورة طبيعية. نعتذر عن أي إزعاج ونشكركم على صبركم.' },
];

/** قوالب إشعارات محفوظة محلياً على جهاز المدير (لا تحتاج أي تغيير في قاعدة البيانات). */
export function loadTemplates() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILT_IN_TEMPLATES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return BUILT_IN_TEMPLATES;
    const saved = parsed
      .filter((item) => item && typeof item.title === 'string' && typeof item.message === 'string')
      .filter((item) => !String(item.id).startsWith('builtin-'))
      .slice(0, 30);
    return [...BUILT_IN_TEMPLATES, ...saved];
  } catch {
    return BUILT_IN_TEMPLATES;
  }
}

function persist(templates) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // التخزين المحلي قد يكون معطّلاً.
  }
}

export function saveTemplate(name, title, message) {
  const templates = loadTemplates().filter((item) => !String(item.id).startsWith('builtin-'));
  const cleanName = (name || title || '').trim().slice(0, 60);
  if (!cleanName) return templates;
  const next = [
    { id: `${Date.now()}`, name: cleanName, title, message },
    ...templates.filter((item) => item.name !== cleanName),
  ].slice(0, 30);
  persist(next);
  return [...BUILT_IN_TEMPLATES, ...next];
}

export function deleteTemplate(id) {
  if (String(id).startsWith('builtin-')) return loadTemplates();
  const next = loadTemplates().filter((item) => item.id !== id);
  persist(next);
  return next;
}
