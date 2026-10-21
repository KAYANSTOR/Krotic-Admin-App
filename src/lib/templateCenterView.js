// ============================================================
// Helpers عرض مركز القوالب — دوال نقية قابلة للاختبار (بلا React/شبكة).
// ------------------------------------------------------------
// تفصل بوضوح بين:
//   - الحزمة المضمّنة في المصدر (bundled pack)
//   - المسودة المحفوظة (draft)
//   - الإصدار المنشور (release) والمؤشر النشط (pointer)
//   - حالة تطبيق الأجهزة (application state) — Unknown افتراضيًا
// لا تُعد هذه الدوال أي حالة نجاح على الجهاز بلا دليل ACK.
// ============================================================

/** مفتاح النطاق المطابق لـ scopeKey في الخادم (global أو network:<id>). */
export function scopeKeyFor(scope) {
  if (!scope || scope.type === 'global') return 'global';
  return `network:${scope.networkId}`;
}

/**
 * مصدر الحزمة المضمّنة في كود المصدر — ليست بيانات إنتاج ولا مسودة محفوظة.
 * تُعرض دائمًا على أنها «مضمّنة في المصدر» لا «مزروعة».
 */
export const BUNDLED_PACK_SOURCE = Object.freeze({
  kind: 'bundled',
  label: 'حزمة مضمّنة في المصدر',
  detail: 'قيم افتراضية في كود لوحة الإدارة — ليست بيانات إنتاج ولا تأتي من Firestore.',
});

/**
 * حالات مسار تطبيق الإصدار المركزي على الجهاز.
 * لا توجد حالة «تم الزرع». القيمة الافتراضية عند غياب ACK هي `Unknown`.
 */
export const APPLICATION_STATES = Object.freeze({
  UNKNOWN: 'Unknown',
  PUBLISHED: 'PublishedCentrally',
  FETCHED: 'Fetched',
  CACHED: 'Cached',
  APPLIED: 'AppliedLocally',
  PARSER_REFRESHED: 'ParserRefreshed',
});

export const APPLICATION_STATE_LABELS = Object.freeze({
  Unknown: 'غير معروف — لا تأكيد من أي جهاز',
  PublishedCentrally: 'منشور مركزيًا — غير مؤكد على الجهاز',
  Fetched: 'جُلب إلى الجهاز (غير مطبَّق بعد)',
  Cached: 'محفوظ محليًا كآخر نسخة سليمة',
  AppliedLocally: 'مطبَّق محليًا — بتأكيد ACK',
  ParserRefreshed: 'أُعيد بناء المحلل — بتأكيد ACK',
});

/**
 * اشتقاق حالة التطبيق من إشارات حقيقية.
 *
 * @param {object} params
 * @param {object|null} params.pointer  المؤشر النشط للنطاق (أو null).
 * @param {object|null} params.ack      سجل ACK موثوق (أو null). أي كائن يعني ACK موثوقًا مطابقًا.
 * @returns {{state:string, evidence:string, tone:string, releaseId:string|null, detail:string}}
 */
export function deriveApplicationState({ pointer = null, ack = null } = {}) {
  const releaseId = pointer?.releaseId || null;
  const base = { releaseId, tone: 'neutral' };

  if (!releaseId) {
    return {
      ...base,
      state: APPLICATION_STATES.UNKNOWN,
      evidence: 'none',
      detail: 'لا يوجد إصدار نشط منشور لهذا النطاق؛ لا شيء ليُطبَّق على الأجهزة.',
    };
  }

  if (!ack) {
    return {
      ...base,
      state: APPLICATION_STATES.PUBLISHED,
      evidence: 'server',
      detail: 'الإصدار منشور مركزيًا. لا يوجد تأكيد ACK من أي جهاز؛ الحالة الفعلية على الجهاز غير معروفة.',
    };
  }

  if (ack.outcome === 'failed' || ack.outcome === 'rejected') {
    return {
      ...base,
      state: APPLICATION_STATES.UNKNOWN,
      evidence: 'ack',
      tone: 'danger',
      detail: `آخر ACK من الجهاز أبلغ عن ${ack.outcome === 'failed' ? 'فشل' : 'رفض'} التطبيق${ack.failureReason ? ` (${ack.failureReason})` : ''}.`,
    };
  }

  if (ack.parserRefreshed) {
    return {
      ...base,
      state: APPLICATION_STATES.PARSER_REFRESHED,
      evidence: 'ack',
      tone: 'success',
      detail: 'أكد جهاز واحد على الأقل التطبيق الكامل وإعادة بناء المحلل.',
    };
  }

  return {
    ...base,
    state: APPLICATION_STATES.APPLIED,
    evidence: 'ack',
    tone: ack.outcome === 'partially_applied' ? 'warning' : 'success',
    detail: ack.outcome === 'partially_applied'
      ? 'طُبِّق جزئيًا: أُدرجت عناصر ووُجدت تعارضات تُركت كما هي محليًا.'
      : 'أكد جهاز واحد على الأقل التطبيق المحلي الكامل.',
  };
}

/**
 * توصيف مصدر عنصر مسودة: هل هو من الحزمة المضمّنة، أو محرَّر يدويًا،
 * أو وارد ضمن مسودة محمَّلة من إصدار سابق؟
 *
 * لا يمكن الجزم بأن عنصرًا «مزروع سابقًا» في الإنتاج؛ نكتفي بوسم ما هو
 * مطابق للحزمة المضمّنة أو موجود في إصدار منشور.
 */
export function describeEntrySource(entry, { bundledIds = new Set(), releaseIds = new Set() } = {}) {
  const id = entry?.key ?? entry?.id;
  if (id != null && bundledIds.has(id)) {
    return { kind: 'bundled', label: 'مطابق للحزمة المضمّنة' };
  }
  if (id != null && releaseIds.has(id)) {
    return { kind: 'release', label: 'موجود في إصدار منشور' };
  }
  return { kind: 'draft', label: 'محرَّر في المسودة' };
}

/** يجمع معرّفات العناصر الموجودة في كل الإصدارات (لكشف «موجود في إصدار»). */
export function collectReleaseEntryIds(releases = []) {
  const wallets = new Set();
  const transferTemplates = new Set();
  const outboundTemplates = new Set();
  for (const release of releases) {
    const payload = release?.payload || {};
    for (const wallet of payload.wallets || []) if (wallet?.id) wallets.add(wallet.id);
    for (const template of payload.transferTemplates || []) if (template?.id) transferTemplates.add(template.id);
    for (const template of payload.outboundTemplates || []) if (template?.key) outboundTemplates.add(template.key);
  }
  return { wallets, transferTemplates, outboundTemplates };
}

/**
 * نتيجة تسوية عناصر قديمة. لا تُزرع شيئًا: تصف فقط ما هو معروف وما هو مجهول.
 *
 * @returns {{known:boolean, missingReason:string|null, summary:string, rows:Array}}
 */
export function reconcileLegacy({ releases = [], networks = [] } = {}) {
  const ids = collectReleaseEntryIds(releases);
  if (releases.length === 0) {
    return {
      known: false,
      missingReason: 'no_central_records',
      summary: 'لا توجد إصدارات مركزية للقراءة. العناصر القديمة على أجهزة Android غير متاحة مركزيًا ولا يمكن عرضها أو تسويتها من اللوحة.',
      rows: [],
    };
  }
  const rows = [
    { kind: 'wallets', label: 'المحافظ', count: ids.wallets.size },
    { kind: 'transferTemplates', label: 'قوالب التحويل الواردة', count: ids.transferTemplates.size },
    { kind: 'outboundTemplates', label: 'الرسائل الصادرة', count: ids.outboundTemplates.size },
    { kind: 'networks', label: 'الشبكات', count: networks.length },
  ];
  return {
    known: true,
    missingReason: null,
    summary: 'التسوية تعتمد على الإصدارات المركزية فقط. العناصر الموجودة على أجهزة Android ولم تُنشر مركزيًا تبقى غير معروفة ولا تُزرع تلقائيًا.',
    rows,
  };
}

/**
 * استخراج المتغيرات المستخدمة في نص قالب صادر. يقبل الصيغتين {name} و%name
 * ويتجاهل التكرار. لا يستخدم regex حرًا.
 */
export function extractTemplateVariables(body = '') {
  const found = new Set();
  for (const match of String(body).matchAll(/\{([^{}]+)\}/gu)) found.add(match[1].trim());
  for (const match of String(body).matchAll(/%([A-Za-z_][A-Za-z0-9_]*)/gu)) found.add(match[1]);
  return [...found];
}

/**
 * تحقق محلي من قالب صادر قبل الحفظ/المعاينة، بنفس منطق الخادم:
 * نص غير فارغ، لا متغير مجهول خارج الكتالوج، ولا غياب لمتغير مطلوب للمفتاح.
 * القائمة النهائية للمتغيرات المسموحة تأتي من كتالوج الخادم.
 */
export function validateOutboundTemplate({ key, body, catalog } = {}) {
  const errors = [];
  if (!body || !body.trim()) errors.push('empty_body');
  const known = new Set(catalog?.outboundVariables || []);
  const aliases = catalog?.outboundVariableAliases || {};
  // نفس منطق الخادم: يُطابَق المتغير بأسمائه البديلة (مثل CARD_CODE → serial).
  const canonical = (variable) => aliases[variable] ?? variable;
  const definition = (catalog?.outboundTemplates || []).find((item) => item.key === key);
  if (!definition) errors.push('unknown_key');
  const used = extractTemplateVariables(body);
  const usedCanonical = new Set(used.map(canonical));
  for (const variable of used) {
    if (known.size > 0 && !known.has(canonical(variable))) errors.push(`unknown_variable:${variable}`);
  }
  for (const required of definition?.required || []) {
    if (!usedCanonical.has(canonical(required))) errors.push(`required_variable_missing:${required}`);
  }
  return { ok: errors.length === 0, errors, usedVariables: used, required: definition?.required || [] };
}

/**
 * يختار أحدث ACK موثوق مطابق للإصدار والنطاق من قائمة سجلات الإدارة.
 * لا يُشتق أي تأكيد من سجل غير موثوق (verified !== true)، ولا من إصدار مختلف.
 */
export function selectVerifiedAck(acks = [], { releaseId = null, scopeKey = 'global' } = {}) {
  if (!releaseId) return null;
  return acks
    .filter((ack) => ack?.verified === true
      && ack.releaseId === releaseId
      && (ack.scopeKey || 'global') === scopeKey)
    .sort((left, right) => Date.parse(right.appliedAt || 0) - Date.parse(left.appliedAt || 0))[0] || null;
}

/** عدد الأجهزة المميزة التي أكدت تطبيق إصدار معيّن (installationId فريد). */
export function countAcknowledgingDevices(acks = [], { releaseId = null, scopeKey = 'global' } = {}) {
  if (!releaseId) return 0;
  const devices = new Set();
  for (const ack of acks) {
    if (ack?.verified !== true || ack.releaseId !== releaseId || (ack.scopeKey || 'global') !== scopeKey) continue;
    if (typeof ack.installationId === 'string' && ack.installationId) devices.add(ack.installationId);
  }
  return devices.size;
}

/** وصف نطاق مقروء (عام / اسم شبكة). */
export function describeScope(scope, networks = []) {
  if (!scope || scope.type === 'global') return 'عام لكل الشبكات';
  const match = networks.find((network) => network.id === scope.networkId);
  return match?.name ? `${match.name} · ${scope.networkId}` : scope.networkId;
}

/** تنسيق وقت من قيمة Firestore Timestamp أو ISO أو رقم. */
export function formatTimestamp(value) {
  if (value == null) return '—';
  const date = typeof value?.toDate === 'function'
    ? value.toDate()
    : (value?.seconds != null ? new Date(value.seconds * 1000) : new Date(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });
}
