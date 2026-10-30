/** Account feature catalog — closed by default keys. */
export const ACCOUNT_FEATURES_VERSION = 1;

export const ACCOUNT_FEATURE_CATALOG = Object.freeze([
  Object.freeze({ key: 'mikrotik_card_generator', label_ar: 'توليد وطباعة الكروت', description_ar: 'إنشاء وطباعة كروت ميكروتك.', default: false, status: 'active', min_app_build: 0 }),
  Object.freeze({ key: 'hotspot_template_editor', label_ar: 'محرر صفحات الهوتسبوت', description_ar: 'تحرير قوالب وصفحات الهوتسبوت.', default: false, status: 'active', min_app_build: 0 }),
  Object.freeze({ key: 'whatsapp_card_delivery', label_ar: 'إرسال الكروت عبر WhatsApp Business', description_ar: 'تسليم الكروت عبر المزود المختار: Cloud API أو Local Gateway عبر QR، مع SMS احتياطي.', default: false, status: 'active', min_app_build: 0 }),
  Object.freeze({ key: 'smart_delivery_routing', label_ar: 'التوجيه الذكي ومسارات الإرسال', description_ar: 'إعداد مسارات تسليم الكروت المتقدمة ومتابعة حالات WhatsApp وSMS.', default: false, status: 'active', min_app_build: 0 }),
  Object.freeze({ key: 'hotspot_phone_recharge', label_ar: 'الشحن المباشر برقم الهاتف', description_ar: 'شحن حساب Hotspot برقم هاتف العميل بعد التحويل الموثوق، بلا كرت وبلا رسالة.', default: false, status: 'active', min_app_build: 0 }),
  Object.freeze({ key: 'sms_auto_parser', label_ar: 'تحليل رسائل المحافظ والحوالات', description_ar: 'تحليل رسائل المحافظ والحوالات تلقائياً.', default: false, status: 'active', min_app_build: 0 }),
  Object.freeze({ key: 'advanced_analytics', label_ar: 'التقارير المالية المتقدمة', description_ar: 'عرض التقارير والتحليلات المالية المتقدمة.', default: false, status: 'active', min_app_build: 0 }),
]);

export const KROTAK_PRO_REQUIRED_FEATURE_KEYS = Object.freeze([
  'hotspot_template_editor',
  'mikrotik_card_generator',
  'whatsapp_card_delivery',
  'smart_delivery_routing',
  'hotspot_phone_recharge',
]);
