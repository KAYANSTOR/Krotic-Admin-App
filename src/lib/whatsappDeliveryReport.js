// تقرير تسليم WhatsApp (الخطة §4.4، العقد whatsapp-delivery-v1 §6.5).
// منطق عرض خالص (بلا React) حتى يُختبر في Node.

export const DELIVERY_STATE_LABELS = Object.freeze({
  queued: 'بانتظار القبول',
  waiting_whatsapp_receipt: 'بانتظار إيصال التسليم',
  delivered: 'تم التسليم عبر WhatsApp',
  sms_fallback_requested: 'مطلوب SMS بديل',
  sms_fallback_sent: 'أُرسل SMS بديل',
  sms_fallback_failed: 'فشل SMS (قابل للاستعادة)',
  failed: 'لم يتم التسليم',
  delivery_timeout: 'انتهت المهلة دون بديل',
});

export const WHATSAPP_STATUS_LABELS = Object.freeze({
  pending: 'لم يُرسل بعد',
  sent: 'أُرسل',
  server_ack: 'علامة واحدة',
  delivered: 'تم التسليم (علامتان)',
  read: 'تمت القراءة',
  error: 'فشل',
});

export const FINAL_OUTCOME_LABELS = Object.freeze({
  whatsapp: 'تم التسليم عبر WhatsApp',
  sms: 'تم التسليم عبر SMS',
  none: 'لم يتم التسليم',
  pending: 'قيد المعالجة',
});

export const FALLBACK_REASON_LABELS = Object.freeze({
  delivery_timeout: 'انتهت مهلة العشر ثوانٍ دون علامتي التسليم',
  delivery_timeout_after_restart: 'انتهت المهلة أثناء إعادة تشغيل الخادم',
  whatsapp_ack_error: 'WhatsApp رد بخطأ على الرسالة',
  whatsapp_send_interrupted: 'انقطع الإرسال أثناء إعادة التشغيل',
  gateway_silent_after_deadline: 'لم يرد خادم WhatsApp بعد المهلة',
  whatsapp_unreachable: 'تعذر الوصول إلى خادم WhatsApp',
  app_offline_deadline: 'قرار التطبيق دون اتصال بعد 60 ثانية',
});

export const SMS_STATUS_LABELS = Object.freeze({
  none: 'لا يوجد',
  pending: 'بانتظار الإرسال',
  sent: 'أُرسل',
  failed: 'فشل',
});

const DECIDED_BY_LABELS = Object.freeze({ gateway: 'خادم WhatsApp', server: 'خادم كروتك', app: 'التطبيق' });

export function fallbackReasonLabel(reason) {
  if (!reason) return '—';
  if (FALLBACK_REASON_LABELS[reason]) return FALLBACK_REASON_LABELS[reason];
  const m = /^whatsapp_send_failed:(.+)$/.exec(reason);
  if (m) return m[1] === 'not_connected' ? 'فشل الإرسال: جلسة WhatsApp غير متصلة' : `فشل الإرسال قبل القبول (${m[1]})`;
  return reason;
}

export function outcomeTone(outcome) {
  return { whatsapp: 'success', sms: 'brand', none: 'danger', pending: 'warning' }[outcome] || 'neutral';
}

export function formatMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString('ar-YE', { dateStyle: 'short', timeStyle: 'medium' });
}

/** Seconds between two ms timestamps, e.g. "+3.2 ث". */
export function relativeSeconds(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0 || toMs <= 0) return null;
  return `+${((toMs - fromMs) / 1000).toFixed(1)} ث`;
}

/** Rows of the §4.4 report for one delivery (label/value pairs, in display order). */
export function deliveryDetailRows(d) {
  const sentAt = d.acceptedAtMs || d.createdAtMs;
  const withRel = (ms) => (ms ? `${formatMs(ms)}${relativeSeconds(sentAt, ms) ? ` (${relativeSeconds(sentAt, ms)})` : ''}` : '—');
  return [
    { key: 'operation', label: 'رقم العملية', value: d.deliveryOperationId, mono: true },
    { key: 'order', label: 'الطلب / البيع', value: [d.orderRef, d.saleRef].filter(Boolean).join(' • ') || '—', mono: true },
    { key: 'customer', label: 'العميل', value: d.customerRef || '—', mono: true },
    { key: 'to', label: 'الرقم المستهدف', value: d.to || '—', mono: true },
    { key: 'card', label: 'الكرت المرتبط', value: d.cardRef || 'رسالة بلا كرت', mono: Boolean(d.cardRef) },
    { key: 'channel', label: 'القناة الأولى', value: d.firstChannel === 'whatsapp' ? 'WhatsApp' : (d.firstChannel || '—') },
    { key: 'template', label: 'القالب', value: d.templateKey || '—', mono: true },
    { key: 'sentAt', label: 'وقت الإرسال', value: formatMs(sentAt) },
    { key: 'serverAck', label: 'علامة واحدة', value: withRel(d.serverAckAtMs) },
    { key: 'deliveredAt', label: 'علامتا التسليم', value: withRel(d.deliveredAtMs) },
    { key: 'readAt', label: 'القراءة', value: withRel(d.readAtMs) },
    { key: 'whatsapp', label: 'حالة WhatsApp', value: WHATSAPP_STATUS_LABELS[d.whatsappStatus] || d.whatsappStatus || '—' },
    { key: 'deadline', label: 'انتهاء مهلة العشر ثوانٍ', value: formatMs(d.receiptDeadlineAtMs) },
    { key: 'reason', label: 'سبب التحويل إلى SMS', value: d.fallback ? `${fallbackReasonLabel(d.fallback.reason)} — ${DECIDED_BY_LABELS[d.fallback.decidedBy] || d.fallback.decidedBy}` : '—' },
    { key: 'sms', label: 'حالة SMS', value: `${SMS_STATUS_LABELS[d.sms?.status] || '—'}${d.sms?.sentAtMs ? ` — ${formatMs(d.sms.sentAtMs)}` : ''}` },
    { key: 'attempts', label: 'عدد المحاولات', value: `WhatsApp: ${d.attempts ?? 0} • SMS: ${d.sms?.attempts ?? 0}` },
    { key: 'lastError', label: 'آخر خطأ', value: d.sms?.lastError || d.lastError || '—', mono: true },
    { key: 'messageId', label: 'معرّف رسالة WhatsApp', value: d.messageId || '—', mono: true },
    { key: 'outcome', label: 'النتيجة النهائية', value: FINAL_OUTCOME_LABELS[d.finalOutcome] || d.finalOutcome || '—' },
  ];
}

/** Warnings an operator must see (never hidden). */
export function deliveryNotices(d) {
  const notices = [];
  if (d.lateDelivery) {
    notices.push({ tone: 'warning', text: `وصل إيصال WhatsApp متأخراً بعد قرار SMS (${formatMs(d.lateDelivery.atMs)}) — لم يُعد إرسال أي قناة.` });
  }
  if (d.smsAfterDelivered) {
    notices.push({ tone: 'warning', text: `أُرسل SMS رغم تأكيد تسليم WhatsApp (محاولة ${d.smsAfterDelivered.attempt}) — نفس الكرت.` });
  }
  if (d.state === 'sms_fallback_failed') {
    notices.push({ tone: 'danger', text: 'فشل SMS البديل؛ العملية تبقى قابلة للاستعادة من التطبيق بنفس الكرت.' });
  }
  return notices;
}

export const DELIVERY_ERROR_TEXT = Object.freeze({
  not_admin: 'هذا الحساب ليس حساب إدارة.',
  delivery_index_missing: 'فهرس Firestore الخاص بتقرير التسليم غير منشور بعد (wa_deliveries / createdAtMs). انشر firestore.indexes.json ثم أعد التحميل.',
  firestore_quota_exceeded: 'حصة Firestore غير كافية.',
  invalid_date_range: 'نطاق التاريخ غير صحيح.',
  invalid_network_id: 'معرّف الشبكة غير صحيح.',
  server_not_configured: 'خدمة Firebase غير مهيأة.',
  missing_token: 'انتهت الجلسة — سجّل الدخول مجدداً.',
  invalid_token: 'انتهت الجلسة — سجّل الدخول مجدداً.',
});

export function deliveryErrorText(code) {
  return DELIVERY_ERROR_TEXT[code] || 'تعذر جلب تقرير التسليم.';
}

/** Query string for GET /api/admin/whatsapp-deliveries. */
export function reportQuery({ networkId = '', state = '', from = '', to = '', limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (networkId.trim()) params.set('networkId', networkId.trim());
  if (state) params.set('state', state);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('limit', String(limit));
  return params.toString();
}
