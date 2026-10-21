// ============================================================
// حزمة الزرع الافتراضي المضمّنة — مبنية من كتالوج Android المرجعي.
// ------------------------------------------------------------
// ⚠️ هذه القيم مستخرجة من الـseeders الرسمية في تطبيق Android (انظر
// `androidSeedCatalog.js`) لتكون اللوحة والتطبيق متطابقين في **المعرّفات**
// نفسها، فلا يُنشئ الاستيراد/النشر نسخًا مكررة.
//
// ليست بيانات إنتاج ولا مسودة محفوظة في Firestore. تحميلها إلى المسودة إجراء
// محلي في المتصفح فقط؛ لا يصبح أي عنصر نشطًا حتى يُحفظ ويُنشر كإصدار، ولا
// يُطبَّق على Android إلا بعد ACK موثوق.
// ============================================================

import {
  ANDROID_DEFAULT_INBOUND_TEMPLATES,
  ANDROID_DEFAULT_OUTBOUND_TEMPLATES,
  ANDROID_DEFAULT_WALLETS,
} from './androidSeedCatalog.js';

/** وسم المصدر: كتالوج الزرع الافتراضي في Android (مرجع قراءة). */
export const BUNDLED_PACK_LABEL = 'كتالوج الزرع الافتراضي في Android (مرجع قراءة)';

export const BUNDLED_TEMPLATE_PACK = Object.freeze({
  wallets: ANDROID_DEFAULT_WALLETS.map((wallet) => Object.freeze({
    id: wallet.id,
    name: wallet.name,
    status: 'active',
    sourceMode: wallet.sourceMode,
    senderId: wallet.senderId,
    packageName: wallet.packageName,
  })),
  transferTemplates: ANDROID_DEFAULT_INBOUND_TEMPLATES.map((template) => Object.freeze({ ...template })),
  outboundTemplates: ANDROID_DEFAULT_OUTBOUND_TEMPLATES.map((template) => Object.freeze({ ...template })),
});

/**
 * نسخة قابلة للتعديل مع طابع زمني حديث للمحافظ (لا تُعدّل الأصل المجمّد).
 * `createdAt` مطلوب للنشر (قاعدة الخادم ترفض حمولة بلا تاريخ إنشاء صالح).
 */
export function cloneBundledPack(now = new Date().toISOString()) {
  const pack = structuredClone(BUNDLED_TEMPLATE_PACK);
  pack.wallets.forEach((wallet) => { wallet.createdAt = now; });
  return pack;
}

export const EMPTY_PAYLOAD = Object.freeze({ wallets: [], transferTemplates: [], outboundTemplates: [] });
