// ============================================================
// توليد المعرّفات التقنية للعناصر التي ينشئها المدير من اللوحة.
// ------------------------------------------------------------
// المعرّف هوية ثابتة تُخزَّن في Drift على Android ولا يُعاد استخدامها.
// لذلك:
//   - لا نكشفه كحقل نصي حر في النموذج (لا يختاره المدير ولا يغيّره).
//   - نعطيه بادئة مستقلة تمنع الالتباس مع معرّفات Android:
//       * محافظ Android وقت التشغيل: wallet-N / عشوائي
//       * كتالوج الأندرويد المرجعي:    wallet-default-*
//       * عناصر أنشأها المدير:         wallet-admin-<hex>
//       * قوالب الأندرويد المرجعية:    tpl-default-*
//       * قوالب أنشأها المدير:         tpl-admin-<hex>
// البادئة تشرح المصدر في السجل نفسه، وتقلّل خطر مطابقة صف Android قديم
// بالخطأ. الشكل يطابق SAFE_ID في الخادم: ^[A-Za-z0-9_-]{1,128}$.
// ============================================================

const ADMIN_TOKEN_BYTES = 8;

function adminToken() {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const buffer = new Uint8Array(ADMIN_TOKEN_BYTES);
    cryptoObject.getRandomValues(buffer);
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // مسار احتياطي للبيئات القديمة فقط؛ Node 20 والمتصفحات الحديثة تدعم Web Crypto.
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return fallback.replace(/[^a-z0-9]/g, '').slice(0, ADMIN_TOKEN_BYTES * 2).padEnd(ADMIN_TOKEN_BYTES * 2, '0');
}

/** معرّف مصدر رسائل ينشئه المدير (لا يمثل أرصدة ولا محفظة مالية). */
export function createMessageSourceId() {
  return `wallet-admin-${adminToken()}`;
}

/** معرّف قالب تحليل رسالة واردة ينشئه المدير. */
export function createInboundTemplateId() {
  return `tpl-admin-${adminToken()}`;
}

/** للعرض/التحقق فقط: هل المعرّف مولّد من اللوحة؟ */
export function isAdminGeneratedId(id) {
  return typeof id === 'string' && /^(wallet|tpl)-admin-[a-z0-9]{8,64}$/.test(id);
}
