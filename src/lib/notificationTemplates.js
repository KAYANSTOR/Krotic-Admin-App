const STORAGE_KEY = 'krotak:notification-templates';
export const BUILT_IN_TEMPLATES = [
  { id: 'builtin-maintenance', name: 'تنبيه صيانة', title: '🔧 تنبيه صيانة دورية مجدولة', message: 'عملاءنا الأعزاء، سيتم إجراء صيانة دورية وتحسينات على الخوادم الليلة ابتداءً من الساعة 3:00 فجراً. قد يتأثر الاتصال مؤقتاً، ونشكر تفهمكم.' },
  { id: 'builtin-special-offer', name: 'عرض خاص', title: '🎁 عرض خاص وحصري للشبكات', message: 'يسرنا تقديم باقة عروض وتخفيضات خاصة لكافة المشتركين على كروت الشبكة والطباعة السريعة. تواصل مع الدعم الفني للاستفادة من المزايا.' },
  { id: 'builtin-renewal-reminder', name: 'تذكير تجديد', title: '⏳ تذكير باقتراب موعد تجديد الاشتراك', message: 'نود تذكيركم بقرب انتهاء فترة الاشتراك الشهري لشبكتكم خلال الأيام القادمة. يرجى تجديد الاشتراك لضمان استمرار الخدمة دون توقف.' },
  { id: 'builtin-service-update', name: 'تحديث التطبيق', title: '🚀 تحديث جديد متوفر لتطبيق كروتك برو', message: 'يتوفر الآن إصدار جديد للتطبيق يشمل تحسينات وسرعة فائقة في مزامنة المبيعات وطباعة الكروت. يرجى التحديث الآن.' },
  { id: 'builtin-commission-reminder', name: 'تذكير بالعمولة', title: '💳 تذكير بسداد العمولة الشهرية', message: 'نرجو مراجعة كشف الحساب وسداد العمولة المستحقة لضمان استمرار عمل الشبكة بسلاسة وبدون أي انقطاع.' },
  { id: 'builtin-welcome', name: 'ترحيب بمشترك جديد', title: '🎉 مرحباً بك في كروتك برو', message: 'يسعدنا انضمامكم إلى منصة كروتك برو. فريق الدعم الفني جاهز لمساعدتكم في أي وقت لضبط الطابعات وإدارة الشبكة بأفضل أداء.' },
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
