/**
 * فحص `no-undef` لطبقة الواجهة: يكتشف متغيّرًا استُخدم في JSX/الكود بلا تعريف.
 * `vite build` لا يكتشف هذه الفئة (الاسم غير المعرّف يصبح خطأ وقت التشغيل فقط)،
 * وقد حدث فعليًا أثناء ترحيل الشاشات إلى القاعدة المحلية.
 *
 * التشغيل (بلا إضافة اعتماد دائم للمشروع):
 *   npx --yes eslint@10 --no-config-lookup \
 *     -c scripts/eslint-no-undef.config.mjs src/
 *
 * المتوقّع حاليًا: أخطاء globals المتصفح فقط (Notification, Blob, TextEncoder,
 * URLSearchParams, HTMLElement, cancelAnimationFrame) وتنبيه تعليق
 * `react-hooks/exhaustive-deps` — لا أخطاء `no-undef` حقيقية في الكود.
 */
export default [
  {
    files: ['**/*.jsx', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        MutationObserver: 'readonly',
        crypto: 'readonly',
        indexedDB: 'readonly',
        process: 'readonly',
        queueMicrotask: 'readonly',
        requestAnimationFrame: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
        performance: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
];
