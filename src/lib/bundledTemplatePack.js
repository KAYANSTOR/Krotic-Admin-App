// ============================================================
// حزمة القوالب والمحافظ المضمّنة في المصدر (bundled pack)
// ------------------------------------------------------------
// ⚠️ هذه قيم ابتدائية مضمّنة في كود لوحة الإدارة لتسهيل بدء مسودة.
// ليست بيانات إنتاج، وليست مسودة محفوظة في Firestore، ولا تعني أن عنصرًا
// «مزروع» على أي جهاز. تحميلها إلى المسودة إجراء محلي في المتصفح فقط؛
// لا يصبح أي منها نشطًا حتى يُحفظ ويُنشر كإصدار، ولا يُطبَّق على Android
// إلا بعد ACK موثوق.
// ============================================================

export const BUNDLED_TEMPLATE_PACK = Object.freeze({
  wallets: [
    { id: 'kuraimi', name: 'الكريمي جوال', status: 'active', sourceMode: 'sms', senderId: 'Kuraimi', packageName: 'com.kuraimi.bank', createdAt: '2026-10-19T00:00:00.000Z' },
    { id: 'jeeb', name: 'محفظة جيب', status: 'active', sourceMode: 'sms', senderId: 'Jeeb', packageName: 'com.jeeb.wallet', createdAt: '2026-10-19T00:00:00.000Z' },
    { id: 'onecash', name: 'ون كاش', status: 'active', sourceMode: 'sms', senderId: 'OneCash', packageName: null, createdAt: '2026-10-19T00:00:00.000Z' },
    { id: 'floosak', name: 'فلوسك', status: 'active', sourceMode: 'sms', senderId: 'Floosak', packageName: null, createdAt: '2026-10-19T00:00:00.000Z' },
    { id: 'maly', name: 'مالي', status: 'active', sourceMode: 'sms', senderId: 'Maly', packageName: null, createdAt: '2026-10-19T00:00:00.000Z' },
    { id: 'ykb', name: 'بنك اليمن والكويت', status: 'active', sourceMode: 'sms', senderId: 'YKB', packageName: null, createdAt: '2026-10-19T00:00:00.000Z' },
  ],
  transferTemplates: [
    {
      id: 'kuraimi-transfer',
      name: 'تحويل وارد الكريمي',
      pattern: 'تم تحويل مبلغ {amount} ريال الى {phone}',
      identifierKind: 'phone',
      walletId: 'kuraimi',
      priority: 10,
      isActive: true,
      requireReference: false,
      sampleBody: 'تم تحويل مبلغ 5000 ريال الى 771234567',
    },
    {
      id: 'jeeb-deposit',
      name: 'إيداع محفظة جيب',
      pattern: 'تم استلام حوالة بمبلغ {amount} ريال من {phone}',
      identifierKind: 'phone',
      walletId: 'jeeb',
      priority: 20,
      isActive: true,
      requireReference: false,
      sampleBody: 'تم استلام حوالة بمبلغ 3000 ريال من 770123456',
    },
    {
      id: 'onecash-transfer',
      name: 'إيداع ون كاش',
      pattern: 'تم استلام مبلغ {amount} ريال في حسابك من {phone}',
      identifierKind: 'phone',
      walletId: 'onecash',
      priority: 30,
      isActive: true,
      requireReference: false,
      sampleBody: 'تم استلام مبلغ 10000 ريال في حسابك من 772345678',
    },
    {
      id: 'floosak-transfer',
      name: 'تحويل فلوسك',
      pattern: 'تم إيداع مبلغ {amount} ريال من {phone}',
      identifierKind: 'phone',
      walletId: 'floosak',
      priority: 40,
      isActive: true,
      requireReference: false,
      sampleBody: 'تم إيداع مبلغ 2500 ريال من 773456789',
    },
  ],
  // المفاتيح هنا يجب أن تطابق كتالوج الخادم (getTemplateCenterCatalog). المتغيرات
  // المطلوبة لكل مفتاح مذكورة في التعليق لتسهيل بدء مسودة صالحة للنشر.
  outboundTemplates: [
    // required: amount
    { key: 'customer_debt_payment_template', body: 'تم استلام دفعة بقيمة {amount} ريال. شكراً لتعاملكم معنا.' },
    // required: secret
    { key: 'voucher_delivery_sms_template', body: 'كود الكرت: {secret}. احتفظ به ولا تشاركه.' },
    // required: quantity_text
    { key: 'pos_order_success_template', body: 'تم تنفيذ طلب نقطة البيع بنجاح. الكمية: {quantity_text}.' },
    // required: pos_name
    { key: 'pos_balance_response_template', body: 'رصيد نقطة البيع {pos_name} تم تحديثه.' },
    // required: category
    { key: 'low_stock_alert_template', body: 'تنبيه: مخزون فئة {category} منخفض.' },
    // required: amount
    { key: 'salafni_template_accepted', body: 'تمت الموافقة على طلب سلفة بمبلغ {amount} ريال لحسابكم.' },
  ],
});

/** نسخة قابلة للتعديل مع طوابع زمنية حديثة للمحافظ (لا تُعدّل الأصل المجمّد). */
export function cloneBundledPack(now = new Date().toISOString()) {
  const pack = structuredClone(BUNDLED_TEMPLATE_PACK);
  pack.wallets.forEach((wallet) => { wallet.createdAt = now; });
  return pack;
}

export const EMPTY_PAYLOAD = Object.freeze({ wallets: [], transferTemplates: [], outboundTemplates: [] });
