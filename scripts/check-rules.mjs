// ============================================================
// فحص ثابت لقواعد Firestore (لا يحتاج Java أو محاكيًا).
// يتحقق من الثوابت الأمنية التي حسمها المالك في سجل القرارات:
//   - لا مشرف مضمّن في الكود (لا UID/بريد ثابت، لا isPrimaryAdmin).
//   - حقول الصلاحية مملوكة للخادم (touchesAccessFields موجودة، والتسجيل الذاتي لا يقبلها).
//   - كتابة العميل مغلقة على التسويات والدفعات وإعدادات التطبيق.
//   - الشبكة تُدار من الخادم (networks/{networkId} بكتابة مغلقة).
// يُشغَّل عبر: npm run test:rules:static
// ============================================================

import { readFile } from 'node:fs/promises';

const RULES_PATH = new URL('../firestore.rules', import.meta.url);
const rules = await readFile(RULES_PATH, 'utf8');

const FORBIDDEN = [
  { pattern: 'akicZMi3cqcDXqlLUZMLL9OdAg53', why: 'UID المشرف المضمّن يجب ألا يوجد' },
  { pattern: 'jarallhalkboudi@gmail.com', why: 'بريد المشرف المضمّن يجب ألا يوجد' },
  { pattern: 'isPrimaryAdmin', why: 'دالة المشرف المضمّن يجب أن تُحذف' },
];

const REQUIRED = [
  { pattern: /function\s+touchesAccessFields\s*\(/, why: 'قفل حقول الصلاحية يجب أن يوجد' },
  { pattern: /function\s+accessFields\s*\(/, why: 'تعريف حقول الصلاحية يجب أن يوجد' },
  { pattern: /match\s+\/networks\/\{networkId\}/, why: 'نموذج الشبكة NET يجب أن يوجد' },
  { pattern: /match\s+\/settlements\/\{settlementId\}/, why: 'كتلة التسويات يجب أن توجد' },
  { pattern: /function\s+isNetworkOwner\s*\(/, why: 'ملكية الشبكة عبر owner_uid يجب أن توجد' },
  { pattern: /match\s+\/template_center_drafts\/\{draftId\}\s*\{\s*allow read, write:\s*if false;/, why: 'مسودات القوالب يجب أن تكون خادمية فقط' },
  { pattern: /match\s+\/template_center_releases\/\{releaseId\}\s*\{\s*allow read, write:\s*if false;/, why: 'إصدارات القوالب يجب أن تكون خادمية فقط' },
  { pattern: /match\s+\/template_center_pointers\/\{scopeKey\}\s*\{\s*allow read, write:\s*if false;/, why: 'مؤشرات الإصدارات يجب أن تكون خادمية فقط' },
];

const failures = [];

for (const { pattern, why } of FORBIDDEN) {
  if (rules.includes(pattern)) failures.push(`وجدنا نمطًا محظورًا «${pattern}» — ${why}`);
}

for (const { pattern, why } of REQUIRED) {
  if (!pattern.test(rules)) failures.push(`نمط مطلوب مفقود ${pattern} — ${why}`);
}

// التسجيل الذاتي يجب ألا يقبل is_active / is_trial.
const selfRegMatch = rules.match(/function\s+validSelfRegistration\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{4}\}/);
if (!selfRegMatch) {
  failures.push('تعذّر إيجاد validSelfRegistration لفحص حقول التسجيل الذاتي');
} else if (/['"]is_active['"]|['"]is_trial['"]/.test(selfRegMatch[1])) {
  failures.push('التسجيل الذاتي ما زال يقبل is_active / is_trial (يجب أن تكون قرارًا خادميًا)');
}

// كتلة التسويات والدفعات وإعدادات التطبيق يجب أن تكون كتابتها مغلقة.
function blockIsClosed(header) {
  const start = rules.indexOf(header);
  if (start === -1) return false;
  // نأخذ حتى نهاية الكتلة الأولى المتوازنة تقريبيًا (١٦ سطرًا تكفي لفحصنا).
  const slice = rules.slice(start, start + 700);
  return /allow\s+write:\s*if\s+false/.test(slice);
}
for (const header of ['match /settlements/{settlementId} {', 'match /payments/{paymentId} {', 'match /Admins/{adminId} {']) {
  if (!blockIsClosed(header)) failures.push(`كتابة العميل ليست مغلقة في الكتلة: ${header}`);
}
if (!/match\s+\/app_settings\/\{document\}\s*\{[\s\S]{0,200}allow\s+write:\s*if\s+false/.test(rules)) {
  failures.push('كتابة العميل على app_settings ليست مغلقة');
}

if (failures.length) {
  console.error('✗ فحص القواعد الثابت فشل:');
  failures.forEach((line) => console.error('  - ' + line));
  process.exit(1);
}

console.log('✓ فحص القواعد الثابت نجح: لا مشرف مضمّن، حقول الصلاحية مقفلة، والكتابة الخادمية مقفلة على التسويات/الدفعات/الإعدادات.');
