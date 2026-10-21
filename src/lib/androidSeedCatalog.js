// ============================================================
// كتالوج الزرع الافتراضي المطابق لتطبيق Android (مرجع فقط).
// ------------------------------------------------------------
// ⚠️ هذه القيم مطابقة لكتالوج Android الرسمي في مستودع `KAYANSTOR/Krotak-Pro`
// (الفرع cline/aj82wjsy؛ assets/template_catalog/krotak_default_catalog_v1.json)
// لتكون مرجعًا واحدًا للوحة الإدارة. ليست بيانات إنتاج، ولا تُكتب على أي جهاز مباشرة.
//
// الغرض: تضمن أن عناصر اللوحة تستخدم **نفس المعرّفات** التي يزرعها Android،
// حتى يطابق الاستيراد/النشر العنصر نفسه بدل إنشاء نسخة مكررة.
//
// المصادر (Android، قراءة فقط):
//   - lib/domain/services/default_wallet_specs.dart          (المحافظ)
//   - lib/domain/services/default_wallet_templates_seeder.dart (قوالب التحويل الواردة)
//   - lib/domain/services/default_pos_templates_seeder.dart  (قوالب POS الواردة)
//   - lib/domain/services/outbound_template_catalog.dart      (قوالب الرسائل الصادرة)
//   - lib/domain/entities/setting.dart                        (النصوص الأولية)
//
// قواعد ثابتة:
//   - معرّف قالب التحويل الوارد = `tpl-default-<senderCode-lowercase-hyphenated>-<variant>`
//     وهو نفس المعرّف الذي يزرعه Android حرفيًا.
//   - مفتاح القالب الصادر = مفتاح الإعداد (`SettingKeys.*`) نفسه.
//   - معرّف المحفظة هو `WalletSpec.catalogId` الثابت بصيغة `wallet-default-*`.
//     تُرسل الإدارة المعرّف نفسه الوارد في manifest، وتُرحّل نسخة Android الجديدة
//     الصفوف المحلية القديمة عبر هوية الكتالوج دون تكرار المحفظة.
// ============================================================

/** رمز الهوية المستخرجة من نص القالب (يطابق TemplateIdentifierKind في Android). */
export const IDENTIFIER_KINDS = Object.freeze({
  PHONE: 'phone',
  ALTERNATIVE_NUMBER: 'alternativeNumber',
  ACCOUNT: 'account',
  SENDER_NAME_ONLY: 'senderNameOnly',
  BALANCE_REQUEST_CODE: 'balanceRequestCode',
});

/**
 * عقد معرّف المحفظة الموحد بين الإدارة وكتالوج Android الرسمي:
 *
 * - Android catalog v1 يعرّف `wallet-default-*` كمعرّف ثابت عبر `WalletSpec.catalogId`.
 * - تستخدم الإدارة المعرّف نفسه حرفيًا، كما تستخدمه قوالب التحويل الواردة في
 *   `walletId`؛ لا تُنشأ IDs مستقلة بصيغة slug.
 * - قد تحمل التثبيتات الأقدم IDs محلية مولدة. إصدار Android الذي يطبّق الكتالوج
 *   يربطها بهوية الكتالوج المحلية، ثم يحمي تعديلات المستخدم من الاستبدال.
 */
export const WALLET_ID_CONTRACT = Object.freeze({
  androidStableKey: 'WalletSpec.catalogId',
  androidRowId: 'wallet-default-* — stable catalog ID',
  adminId: 'same WalletSpec.catalogId as the Android manifest',
  status: 'resolved',
  note: 'التثبيتات القديمة تُرحّل محليًا بواسطة Android catalog identity map؛ الإصدارات الجديدة تستخدم المعرّف الثابت نفسه.',
});

/** يبني معرّفًا مطابقًا لصيغة Android الرسمية: wallet-default-<key-slug>. */
export function walletIdFromKey(key) {
  const slug = String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `wallet-default-${slug}`;
}

/**
 * المحافظ الافتراضية الست المعتمدة — مطابقة لـ`DefaultWalletSpecs.all` بالترتيب.
 * `key` هو المفتاح الثابت في Android، و`id` هو الـslug الذي تستخدمه اللوحة.
 */
export const ANDROID_DEFAULT_WALLETS = Object.freeze([
  { id: walletIdFromKey('Jaib'), key: 'Jaib', name: 'جيب', nameEn: 'Jaib', sourceMode: 'notification', senderId: 'Jaib', packageName: 'com.ahd.jaib' },
  { id: walletIdFromKey('Jawali'), key: 'Jawali', name: 'جوالي', nameEn: 'Jawali', sourceMode: 'sms', senderId: 'Jawali', packageName: 'com.wecash.jawali' },
  { id: walletIdFromKey('MFloos'), key: 'MFloos', name: 'أم فلوس', nameEn: 'MFloos', sourceMode: 'sms', senderId: 'MFloos', packageName: null },
  { id: walletIdFromKey('Floosak'), key: 'Floosak', name: 'فلوسك', nameEn: 'Floosak', sourceMode: 'sms', senderId: 'Floosak', packageName: 'co.ysys.floosak' },
  { id: walletIdFromKey('KuraimiLMB'), key: 'KuraimiLMB', name: 'الكريمي', nameEn: 'KuraimiLMB', sourceMode: 'sms', senderId: 'KuraimiLMB', packageName: null },
  { id: walletIdFromKey('ONE Cash'), key: 'ONE Cash', name: 'ون كاش', nameEn: 'ONE Cash', sourceMode: 'sms', senderId: 'ONE Cash', packageName: 'com.one.onecustomer' },
]);

const WALLET_ID_BY_KEY = Object.freeze(
  Object.fromEntries(ANDROID_DEFAULT_WALLETS.map((wallet) => [wallet.key, wallet.id])),
);

/** يُعيد معرّف اللوحة لمفتاح محفظة Android، أو null إن كان المفتاح غير معروف. */
export function walletIdForKey(key) {
  return WALLET_ID_BY_KEY[key] ?? null;
}

/**
 * قوالب التحويل الواردة الافتراضية — مطابقة لـ`DefaultWalletTemplatesSeeder._specs`.
 * المعرّف محسوب بنفس صيغة Android: `tpl-default-<senderCode>-<variant>`.
 */
const INBOUND_SPECS = [
  // ── جيب — Jaib ──
  { walletKey: 'Jaib', senderCode: 'Jaib', variant: 'ar-shared', name: 'جيب — تحويل مشترك', priority: 10, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: true, pattern: 'اضيف {amount} ر.ي تحويل مشترك رص:{ref} ر.ي من {account} {phone}', sampleBody: 'اضيف 500ر.ي تحويل مشترك رص:515920ر.ي من علي القواتي 715813555' },
  { walletKey: 'Jaib', senderCode: 'Jaib', variant: 'ar-phone-only', name: 'جيب — تحويل (رقم بديل)', priority: 20, identifierKind: IDENTIFIER_KINDS.ALTERNATIVE_NUMBER, requireReference: true, pattern: 'اضيف {amount} ر.ي تحويل مشترك رص:{ref} ر.ي من {phone}', sampleBody: 'اضيف 500ر.ي تحويل مشترك رص:255265ر.ي من 8483883' },
  { walletKey: 'Jaib', senderCode: 'Jaib', variant: 'ar-blocked', name: 'جيب — إشعار محجوب', priority: 30, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: true, pattern: 'اضيف {amount} ر.ي تحويل مشترك رص:{ref} ر.ي من {account}-{phone}', sampleBody: 'اضيف 300ر.ي تحويل مشترك رص:4650ر.ي من د**** ح****** ح** م******-6557728' },
  // ── جوالي — Jawali ──
  { walletKey: 'Jawali', senderCode: 'Jawali', variant: 'ar-received', name: 'جوالي — استلمت مبلغ', priority: 10, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: true, pattern: 'استلمت مبلغ {amount} YER من {phone} رصيدك هو {ref}', sampleBody: 'استلمت مبلغ 200 YER من 733332303 رصيدك هو 245' },
  // ── أم فلوس — MFloos ──
  { walletKey: 'MFloos', senderCode: 'MFloos', variant: 'ar-deposit', name: 'أم فلوس — إيداع', priority: 10, identifierKind: IDENTIFIER_KINDS.ACCOUNT, requireReference: true, pattern: 'تم إيداع مبلغ {amount} YER من: {account} المرجع: {ref}', sampleBody: 'تم إيداع مبلغ 300.00 YER من: منيره جبر المرجع:939493993' },
  // ── فلوسك — Floosak ──
  { walletKey: 'Floosak', senderCode: 'Floosak', variant: 'ar-hawala', name: 'فلوسك — استلمت حوالة', priority: 10, identifierKind: IDENTIFIER_KINDS.ACCOUNT, requireReference: true, pattern: 'استلمت حوالة من {account} بمبلغ {amount} ر.ي رصيدك {ref} ر.ي', sampleBody: 'استلمت حوالة من بسام الشيباني بمبلغ 250.00 ر.ي رصيدك 250.00 ر.ي' },
  { walletKey: 'Floosak', senderCode: 'Floosak', variant: 'ar-shared', name: 'فلوسك — تحويل مشترك', priority: 20, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: true, pattern: 'اضيف {amount} ر.ي تحويل مشترك رص:{ref} ر.ي من {account}-{phone}', sampleBody: 'اضيف 2000 ر.ي تحويل مشترك رص:2000 ر.ي من عميل-770000001' },
  { walletKey: 'Floosak', senderCode: 'Floosak', variant: 'sms-generic', name: 'فلوسك — تحويل عام', priority: 30, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: false, pattern: 'تم استلام {amount} من {phone}', sampleBody: 'تم استلام 2000 من 770000001' },
  // ── الكريمي — KuraimiLMB ──
  { walletKey: 'KuraimiLMB', senderCode: 'KuraimiLMB', variant: 'ar-deposit', name: 'الكريمي — إيداع لحسابك', priority: 10, identifierKind: IDENTIFIER_KINDS.ACCOUNT, requireReference: true, pattern: 'أودع/ {account} لحسابك مبلغ {amount} رصيدك {ref} YER', sampleBody: 'أودع/احمد جابر حسن المنتصر لحسابك مبلغ 600 رصيدك 10030 YER' },
  // ── ون كاش — ONE Cash ──
  { walletKey: 'ONE Cash', senderCode: 'ONE Cash', variant: 'ar-received', name: 'ون كاش — استلمت', priority: 10, identifierKind: IDENTIFIER_KINDS.ACCOUNT, requireReference: true, pattern: 'استلمت {amount}\nمن {account}\nرصيدك{ref} ر.ي', sampleBody: 'استلمت 500.00\nمن عبدالله عادل عب\nرصيدك500.00 ر.ي' },
  { walletKey: 'ONE Cash', senderCode: 'ONE Cash', variant: 'ar-shared', name: 'ون كاش — تحويل مشترك', priority: 20, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: true, pattern: 'اضيف {amount} ر.ي تحويل مشترك رص:{ref} ر.ي من {account}-{phone}', sampleBody: 'اضيف 1000 ر.ي تحويل مشترك رص:1000 ر.ي من عميل-771234567' },
  { walletKey: 'ONE Cash', senderCode: 'ONE Cash', variant: 'ar-hawala', name: 'ون كاش — استلمت حوالة', priority: 30, identifierKind: IDENTIFIER_KINDS.ACCOUNT, requireReference: true, pattern: 'استلمت حوالة من {account} بمبلغ {amount} ر.ي رصيدك {ref} ر.ي', sampleBody: 'استلمت حوالة من عميل بمبلغ 500.00 ر.ي رصيدك 1500.00 ر.ي' },
  { walletKey: 'ONE Cash', senderCode: 'ONE Cash', variant: 'sms-generic', name: 'ون كاش — تحويل عام', priority: 40, identifierKind: IDENTIFIER_KINDS.PHONE, requireReference: false, pattern: 'تم استلام {amount} من {phone}', sampleBody: 'تم استلام 1000 من 771234567' },
];

/** معرّف قالب التحويل الوارد بنفس صيغة Android. */
export function inboundTemplateId(senderCode, variant) {
  return `tpl-default-${String(senderCode).toLowerCase().replaceAll(' ', '-')}-${variant}`;
}

/** قوالب التحويل الواردة بصيغة الحمولة (معرّفات Android الأصلية + ربط المحفظة). */
export const ANDROID_DEFAULT_INBOUND_TEMPLATES = Object.freeze(
  INBOUND_SPECS.map((spec) => Object.freeze({
    id: inboundTemplateId(spec.senderCode, spec.variant),
    name: spec.name,
    pattern: spec.pattern,
    isActive: true,
    walletId: walletIdForKey(spec.walletKey),
    walletKey: spec.walletKey,
    posId: null,
    priority: spec.priority,
    sampleBody: spec.sampleBody,
    senderCode: spec.senderCode,
    identifierKind: spec.identifierKind,
    requireReference: spec.requireReference,
  })),
);

/**
 * قوالب POS الواردة الافتراضية (ثلاثة) — مطابقة لـ`DefaultPosTemplatesSeeder._specs`.
 * ملاحظة: معرّفها في Android يعتمد على `posId` وقت التشغيل (`tpl-pos-<posId>-<variant>`)،
 * لذلك لا تدخل حمولة عامة بلا نقطة بيع مربوطة — تبقى مرجعًا للشكل المعتمد.
 */
export const ANDROID_DEFAULT_POS_TEMPLATE_SPECS = Object.freeze([
  { variant: 'cards-to-pos', name: 'إرسال كروت إلى نقطة البيع', priority: 1, pattern: '{qty} كرت {amount}', sampleBody: '10 كرت 100', identifierKind: IDENTIFIER_KINDS.SENDER_NAME_ONLY, senderNameLabel: 'نقطة البيع', noteLabel: 'كروت لنقطة البيع', requireReference: false },
  { variant: 'cards-to-pos-customer', name: 'إرسال كروت إلى عميل نقطة البيع', priority: 2, pattern: '{qty} كرت {amount} {phone}', sampleBody: '1 كرت 100 779776919', identifierKind: IDENTIFIER_KINDS.PHONE, senderNameLabel: 'نقطة البيع', noteLabel: 'كروت لعميل نقطة البيع', requireReference: false },
  { variant: 'balance-request', name: 'استعلام رصيد نقطة البيع', priority: 20, pattern: '111', sampleBody: '111', identifierKind: IDENTIFIER_KINDS.BALANCE_REQUEST_CODE, senderNameLabel: 'نقطة البيع', noteLabel: 'طلب رصيد', requireReference: false },
]);

/**
 * قوالب الرسائل الصادرة — المفتاح هو مفتاح الإعداد نفسه في Android.
 * `required` بالمتغيرات القانونية للوحة الإدارة (تطابق كتالوج الخادم).
 */
export const ANDROID_DEFAULT_OUTBOUND_TEMPLATES = Object.freeze([
  { key: 'voucher_delivery_sms_template', body: 'نشكرك على استخدامك شبكة {NETWORK_NAME}.\nكود الكرت: {CARD_CODE}\nفئة: {CARD_VALUE} ر.ي\nالرمز: {code}' },
  { key: 'pos_customer_card_delivery_template', body: 'شبكة {NETWORK_NAME}\nالفئة: {category}\n{cards}' },
  { key: 'customer_debt_payment_template', body: 'تم استلام إيداع بمبلغ {amount} {CURRENCY}\nتم خصم {paid} {CURRENCY} لسداد الدين\nتم إضافة {surplus} {CURRENCY} إلى رصيد حسابك\nرصيدك الحالي: {balance} {CURRENCY}' },
  { key: 'pos_order_success_template', body: 'تم إرسال {QUANTITY_TEXT} بنجاح إلى {CUSTOMER_PHONE}\nالفئة: {CARD_VALUE} {CURRENCY}\nنقطة البيع: {POS_NAME}\nإجمالي الخصم من الحساب: {TOTAL} {CURRENCY}' },
  { key: 'pos_customer_sms_tail_template', body: '\n— {pos}' },
  { key: 'pos_balance_response_template', body: 'رصيد نقطة البيع {pos}: {balance} ر.ي\nالدين: {debt} ر.ي' },
  { key: 'pos_credit_limit_exceeded_template', body: 'تعذر تنفيذ الطلب: تجاوزت نقطة البيع {pos} سقف الدين المسموح ({limit} ر.ي)' },
  { key: 'pos_request_rejected_template', body: 'تم رفض طلب نقطة البيع {pos}: {reason}' },
  { key: 'pos_instant_charge_confirm_template', body: 'تم إرسال كرت {amount} ر.ي إلى {phone}' },
  { key: 'daily_pos_summary_template', body: 'ملخص يومي لنقطة البيع {pos}\nالمبيعات: {sales}\nالتحويلات: {transfers}\nالرصيد: {balance} ر.ي' },
  { key: 'pos_settlement_template_success', body: 'تم تأكيد تسوية نقطة البيع {pos} بمبلغ {amount} ر.ي' },
  { key: 'pos_settlement_template_failed', body: 'فشلت تسوية نقطة البيع {pos}: {reason}' },
  { key: 'pos_settlement_template_unknown', body: 'تعذر التحقق من تسوية نقطة البيع {pos}. راجع السجل يدوياً' },
  { key: 'promotion_reward_sms_template', body: 'مكافأة عرض {title}\nالرقم: {serial}\nالرمز: {secret}' },
  { key: 'salafni_template_accepted', body: 'تم تفعيل سلفني بقيمة {amount} ريال. الكرت: {serial} | الرمز: {code}' },
  { key: 'salafni_template_rejected', body: 'تعذر تنفيذ سلفني: {reason}' },
  { key: 'salafni_template_settled', body: 'تم استلام إيداع بمبلغ {amount} {CURRENCY}\nتم خصم {paid} {CURRENCY} لسداد السلفة\nتم إضافة {surplus} {CURRENCY} إلى رصيد حسابك\nرصيدك الحالي: {balance} {CURRENCY}' },
  { key: 'low_stock_alert_template', body: 'فئات كروت أوشكت على النفاد\nالفئة {category} — المتبقي: {count}' },
  { key: 'card_delivery_cash_template', body: 'كرتك من شبكة {network_name}\n{الفئة}\n{الرقم}\n{الرمز}' },
  { key: 'card_delivery_credit_template', body: 'كرت آجل عليكم في حسابكم\nمن شبكة {network_name}\n{الفئة}\n{الرقم}\n{الرمز}' },
  { key: 'card_delivery_gift_template', body: 'كرتك الهدية\nمن شبكة {network_name}\n{الفئة}\n{الرقم}\n{الرمز}' },
  { key: 'salafni_card_delivery_template', body: 'كرتك من خدمة سلفني\nشبكة {network_name}\n{الفئة}\n{الرقم}\n{الرمز}' },
  { key: 'deposit_no_stock_template', body: 'عزيزي {اسم_الزبون_الاول}\nتم استلام {المبلغ}﷼\nسوف يتم مشاركة الكرت آلياً فور توفره' },
]);

/** مفاتيح الصادر التي يزرعها Android ولا يقبلها كتالوج الخادم الحالي بعد. */
export const OUTBOUND_KEYS_MISSING_FROM_SERVER_CATALOG = Object.freeze([
  'card_delivery_cash_template',
  'card_delivery_credit_template',
  'card_delivery_gift_template',
  'salafni_card_delivery_template',
  'deposit_no_stock_template',
]);

/** كل معرّفات قوالب التحويل الواردة الافتراضية (للكشف عن التكرار والمطابقة). */
export const ANDROID_DEFAULT_INBOUND_TEMPLATE_IDS = Object.freeze(
  ANDROID_DEFAULT_INBOUND_TEMPLATES.map((template) => template.id),
);

/** كل مفاتيح الصادر الافتراضية. */
export const ANDROID_DEFAULT_OUTBOUND_KEYS = Object.freeze(
  ANDROID_DEFAULT_OUTBOUND_TEMPLATES.map((template) => template.key),
);

/** كل معرّفات المحافظ الافتراضية في اللوحة. */
export const ANDROID_DEFAULT_WALLET_IDS = Object.freeze(
  ANDROID_DEFAULT_WALLETS.map((wallet) => wallet.id),
);
