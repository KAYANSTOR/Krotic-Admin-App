// ============================================================
// Helpers عرض مركز القوالب — دوال نقية قابلة للاختبار (بلا React/شبكة).
// ------------------------------------------------------------
// تفصل بوضوح بين:
//   - كتالوج Android الافتراضي المضمّن (bundled pack)
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

// ------------------------------------------------------------
// معجم التسميات الظاهرة — مصدر واحد لكل الشاشات.
// السبب: كانت الخرائط مكررة داخل التبويبات، فتظهر التسمية نفسها بصيغتين.
// القاعدة: «مصدر الرسائل» هو المصطلح الظاهر لمفهوم جدول Android `wallets`؛
// لا يُستخدم «محفظة» في الواجهة لأنه يوحي برصيد مالي غير موجود في هذا النموذج.
// ------------------------------------------------------------

export const MESSAGE_SOURCE_MODE_LABELS = Object.freeze({
  sms: 'SMS',
  notification: 'إشعار تطبيق',
});

export const MESSAGE_SOURCE_STATUS_LABELS = Object.freeze({
  active: 'نشط',
  suspended: 'موقوف مؤقتًا',
  archived: 'مؤرشف',
});

export const INBOUND_IDENTIFIER_LABELS = Object.freeze({
  phone: 'رقم هاتف',
  alternativeNumber: 'رقم بديل',
  account: 'رقم حساب',
  senderNameOnly: 'اسم المرسل فقط',
  balanceRequestCode: 'كود طلب رصيد',
});

export const OUTBOUND_SCOPE_LABELS = Object.freeze({
  outboundCustomer: 'رسائل العملاء',
  outboundPos: 'نقاط البيع',
  outboundSystem: 'رسائل النظام',
});

/** حالة التطبيق كما يبلّغها الجهاز؛ تُعرض عربية دائمًا لا كرمز خام. */
export const ACK_OUTCOME_LABELS = Object.freeze({
  applied: 'مطبَّق',
  partially_applied: 'مطبَّق جزئيًا',
  failed: 'فشل',
  rejected: 'مرفوض',
  unknown: 'غير معروف',
});

/** تسمية عربية لقيمة ACK، مع إظهار القيمة الخام فقط عند جهل المعجم. */
export function labelAckOutcome(outcome) {
  return ACK_OUTCOME_LABELS[outcome] || (outcome ? `غير معروف (${outcome})` : 'غير معروف');
}

/** أسباب رفض/فشل المحاكاة الواردة كما يعيدها الخادم — بلا رموز إنجليزية خام. */
export const INBOUND_SIMULATION_REASON_LABELS = Object.freeze({
  no_template_matched: 'لا يوجد قالب مطابق',
  template_pattern_invalid: 'نمط القالب غير صالح',
  template_not_found: 'القالب غير موجود',
  body_required: 'نص الرسالة مطلوب',
  message_empty: 'نص الرسالة فارغ',
});

/** أسباب رفض معاينة الرسالة الصادرة كما يعيدها الخادم. */
export const OUTBOUND_PREVIEW_REASON_LABELS = Object.freeze({
  template_unknown: 'القالب غير معروف في الكتالوج',
  variable_unknown: 'النص يحتوي متغيرًا غير معروف',
  variable_scope_invalid: 'المتغير خارج نطاق هذا القالب',
  required_variable_missing: 'متغير مطلوب مفقود',
  variable_value_missing: 'لم تُدخل قيمة لكل متغير',
  rendered_message_empty: 'الرسالة الناتجة فارغة',
});

/** تسمية سبب خادمي، مع إبقاء الرمز بين قوسين عند عدم وجود ترجمة. */
export function labelReason(map, code) {
  if (!code) return 'غير معروف';
  return map[code] || `سبب غير مترجم (${code})`;
}

// ------------------------------------------------------------
// ترجمة أخطاء تحقق الحمولة (snake_case) إلى جملة عربية.
// الخادم يعيد رموزًا مثل wallets[0]_created_at_invalid؛ عرضها كما هي في
// الواجهة يجعل رسالة الخطأ بلا معنى للمدير. تُسجل الرموز الأصلية في console
// للتشخيص، ويُعرض هنا ملخص عربي فقط.
// ------------------------------------------------------------

const PAYLOAD_ENTRY_LABELS = Object.freeze({
  wallets: 'مصدر رسائل',
  transferTemplates: 'قالب وارد',
  outboundTemplates: 'قالب صادر',
});

const FIELD_ERROR_LABELS = Object.freeze({
  invalid: 'عنصر غير صالح',
  id_invalid: 'المعرّف غير صالح',
  id_duplicate: 'المعرّف مكرر',
  name_invalid: 'الاسم مطلوب أو طويل جدًا',
  status_invalid: 'الحالة غير معروفة',
  source_mode_invalid: 'وضع القراءة غير معروف',
  sender_id_invalid: 'معرّف المرسل غير صالح',
  package_name_invalid: 'اسم الحزمة غير صالح',
  package_name_required_for_notification: 'اسم الحزمة مطلوب لوضع الإشعارات',
  created_at_invalid: 'تاريخ الإنشاء مفقود أو غير صالح',
  pattern_invalid: 'نمط المطابقة مطلوب أو طويل جدًا',
  wallet_id_invalid: 'مصدر الرسائل المرتبط غير موجود',
  wallet_not_active: 'مصدر الرسائل المرتبط غير نشط',
  pos_id_invalid: 'نقطة البيع غير صالحة',
  priority_invalid: 'الأولوية يجب أن تكون عددًا بين 0 و9999',
  identifier_kind_invalid: 'نوع المعرّف غير معروف',
  is_active_invalid: 'قيمة التفعيل غير صالحة',
  require_reference_invalid: 'قيمة اشتراط المرجع غير صالحة',
  sender_code_invalid: 'مرشّح المرسل غير صالح',
  sample_body_invalid: 'نص العينة غير صالح',
  sender_name_label_invalid: 'تسمية اسم المرسل غير صالحة',
  note_label_invalid: 'تسمية الملاحظة غير صالحة',
  active_scope_required: 'القالب المفعّل يحتاج مصدر رسائل أو نقطة بيع',
  required_amount_missing: 'النمط يجب أن يحتوي {amount}',
  required_identifier_missing: 'النمط لا يحتوي المعرّف المطلوب',
  required_reference_missing: 'النمط يجب أن يحتوي {ref}',
  required_variable_missing: 'متغير مطلوب مفقود',
  placeholder_unknown: 'النمط يحتوي عنصرًا نائبًا غير معروف',
  key_invalid: 'مفتاح القالب غير صالح',
  key_unknown: 'مفتاح القالب غير معروف في الكتالوج',
  key_duplicate: 'مفتاح القالب مكرر',
  body_invalid: 'نص القالب مطلوب أو طويل جدًا',
  variable_unknown: 'نص القالب يحتوي متغيرًا غير معروف',
  variable_scope_invalid: 'المتغير خارج نطاق هذا القالب',
  variable_duplicate: 'النص يستخدم اسمين مختلفين للمتغير نفسه',
});

const PAYLOAD_ERROR_LABELS = Object.freeze({
  payload_invalid: 'حمولة المسودة غير صالحة',
  scope_invalid: 'نطاق النشر غير صالح',
  draft_invalid: 'بيانات المسودة غير صالحة',
  payload_too_large: 'حجم الحمولة يتجاوز الحد المسموح',
  wallets_invalid: 'قائمة مصادر الرسائل غير صالحة',
  transferTemplates_invalid: 'قائمة قوالب الرسائل الواردة غير صالحة',
  outboundTemplates_invalid: 'قائمة الرسائل الصادرة غير صالحة',
});

/** يترجم رمز تحقق واحدًا؛ لا يعيد رموزًا إنجليزية خامًا أبدًا. */
export function describeTemplateValidationError(code) {
  if (typeof code !== 'string' || !code) return 'خطأ تحقق غير معروف';
  if (PAYLOAD_ERROR_LABELS[code]) return PAYLOAD_ERROR_LABELS[code];
  const match = code.match(/^(wallets|transferTemplates|outboundTemplates)\[(\d+)\]_(\w+)$/);
  if (!match) return 'خطأ تحقق غير معروف';
  const [, collection, index, field] = match;
  const entry = PAYLOAD_ENTRY_LABELS[collection];
  return `${entry} #${Number(index) + 1}: ${FIELD_ERROR_LABELS[field] || 'حقل غير صالح'}`;
}

/** ملخص عربي قصير لأخطاء الخادم: أول ثلاثة أخطاء + عدد الباقي. */
export function summarizeTemplateValidationErrors(details = [], max = 3) {
  if (!Array.isArray(details) || details.length === 0) return '';
  const messages = [...new Set(details.map(describeTemplateValidationError))];
  const shown = messages.slice(0, max);
  const rest = messages.length - shown.length;
  return rest > 0 ? `${shown.join('، ')}، و${rest} خطأ آخر` : shown.join('، ');
}


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
 * توصيف مصدر عنصر مسودة: هل هو من الكتالوج الافتراضي المضمّن في Android، أو
 * محرَّر يدويًا، أو وارد ضمن مسودة محمَّلة من إصدار سابق؟
 *
 * لا يمكن الجزم بأن عنصرًا «مزروع سابقًا» في الإنتاج؛ نكتفي بوسم ما هو
 * مطابق للكتالوج المضمّن أو موجود في إصدار منشور.
 */
export function describeEntrySource(entry, { bundledIds = new Set(), releaseIds = new Set() } = {}) {
  const id = entry?.key ?? entry?.id;
  if (id != null && bundledIds.has(id)) {
    return { kind: 'bundled', label: 'مضمّن في كتالوج Android' };
  }
  if (id != null && releaseIds.has(id)) {
    return { kind: 'release', label: 'من إصدار منشور' };
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
    { kind: 'wallets', label: 'مصادر الرسائل', count: ids.wallets.size },
    { kind: 'transferTemplates', label: 'قوالب الرسائل الواردة', count: ids.transferTemplates.size },
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

export const ACK_HEALTH_LABELS = Object.freeze({
  matched: 'مطابق ومطبّق',
  conflict: 'تعارض أو تطبيق جزئي',
  stale: 'ACK لإصدار قديم',
  failed: 'فشل على الجهاز',
  unknown: 'غير معروف',
});

/** حالة حسابية فقط: لا تُخزَّن، وتُقارن آخر ACK للمثبت بالإصدار النشط وبصمته. */
export function classifyAckHealth(ack, { pointer = null, releases = [] } = {}) {
  if (!ack || ack.verified !== true) return 'unknown';
  if (!pointer?.releaseId) return 'stale';
  if ((ack.scopeKey || 'global') !== pointer.id) return 'conflict';
  if (ack.releaseId !== pointer.releaseId) return 'stale';
  const release = releases.find((item) => item.id === pointer.releaseId);
  if (!release) return 'unknown';
  const expectedHash = String(release.payloadHashSha256 || release.payloadHash || '').toLowerCase();
  if (!expectedHash || String(ack.payloadHash || '').toLowerCase() !== expectedHash) return 'conflict';
  if (ack.outcome === 'failed') return 'failed';
  if (ack.outcome !== 'applied' || ack.conflictCount > 0 || ack.parserRefreshed !== true) return 'conflict';
  return 'matched';
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
