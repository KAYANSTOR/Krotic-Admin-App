const STORAGE_KEY = 'krotak:notification-templates';

/** قوالب إشعارات محفوظة محلياً على جهاز المدير (لا تحتاج أي تغيير في قاعدة البيانات). */
export function loadTemplates() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.title === 'string' && typeof item.message === 'string')
      .slice(0, 30);
  } catch {
    return [];
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
  const templates = loadTemplates();
  const cleanName = (name || title || '').trim().slice(0, 60);
  if (!cleanName) return templates;
  const next = [
    { id: `${Date.now()}`, name: cleanName, title, message },
    ...templates.filter((item) => item.name !== cleanName),
  ].slice(0, 30);
  persist(next);
  return next;
}

export function deleteTemplate(id) {
  const next = loadTemplates().filter((item) => item.id !== id);
  persist(next);
  return next;
}
