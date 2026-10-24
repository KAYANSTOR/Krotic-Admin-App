import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/** يستخرج جسم قاعدة CSS بسيطة (بدون أقواس متداخلة) لفحصها بمعزل عن بقية الملف. */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `CSS rule not found: ${selector}`);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

test('design tokens have a single central source with the six identity colours', async () => {
  const [css, tailwind] = await Promise.all([read('src/index.css'), read('tailwind.config.js')]);
  const rootBlocks = css.match(/:root\s*\{/g) || [];
  assert.equal(rootBlocks.length, 1, 'يجب أن يكون هناك كتلة :root واحدة فقط لمصدر التوكنات');

  const expected = {
    '--ui-forest-black': '#051F20',
    '--ui-deep-forest': '#0B2B26',
    '--ui-forest-green': '#163832',
    '--ui-primary-green': '#235347',
    '--ui-sage-green': '#8EB69B',
    '--ui-mint-surface': '#DAF1DE',
  };
  for (const [token, value] of Object.entries(expected)) {
    assert.match(css, new RegExp(`${token}:\\s*${value}`, 'i'), `${token} must be ${value}`);
    assert.ok(tailwind.toUpperCase().includes(value), `${value} should also exist in tailwind.config.js`);
  }

  // أسماء المكونات القديمة تبقى كأسماء مستعارة للهوية، فلا تنكسر أي صفحة.
  assert.match(css, /--ui-brand:\s*var\(--ui-primary-green\)/);
  assert.match(css, /--ui-brand-deep:\s*var\(--ui-forest-green\)/);
  assert.match(css, /--ui-brand-soft:\s*var\(--ui-mint-surface\)/);

  // لا بقايا من الهوية اللونية السابقة في طبقة الأنماط.
  assert.doesNotMatch(css, /#D97757|#B85C3E|#9A4A32|#e56b50/i);
});

test('existing font and RTL direction are preserved as instructed', async () => {
  const [css, tailwind, html] = await Promise.all([
    read('src/index.css'),
    read('tailwind.config.js'),
    read('index.html'),
  ]);
  assert.match(css, /html \{[^}]*direction:\s*rtl/);
  assert.match(css, /font-family:\s*'Tajawal'/);
  assert.match(tailwind, /fontFamily:\s*\{\s*sans:\s*\['Tajawal'/);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /family=Tajawal/);
  assert.doesNotMatch(css, /IBM Plex Sans Arabic/);
});

test('browser chrome and sidebar follow the hybrid dark/light identity', async () => {
  const [html, css, layout] = await Promise.all([
    read('index.html'),
    read('src/index.css'),
    read('src/components/Layout.jsx'),
  ]);
  assert.match(html, /name="theme-color" content="#051F20"/);
  assert.match(css, /\.sidebar \{[^}]*var\(--ui-forest-black\)/);
  assert.match(css, /\.sidebar \{[^}]*width:264px/);
  assert.match(layout, /lg:ms-\[264px\]/);
  assert.match(css, /--ui-paper:\s*#F4F7F5/);
  assert.match(css, /--ui-surface:\s*#FFFFFF/);
});

test('mobile bottom navigation is dark, lightweight and touch-safe', async () => {
  const css = await read('src/index.css');
  const nav = ruleBody(css, '.bottom-nav');
  assert.match(nav, /var\(--ui-deep-forest\)/);
  assert.match(nav, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(nav, /backdrop-filter/, 'لا نستخدم blur في شريط التنقل حفاظًا على الأداء');

  const item = ruleBody(css, '.bottom-nav-item');
  assert.match(item, /min-height:\s*52px/);
  assert.match(item, /var\(--ui-motion-fast\)/);

  const activeStart = css.indexOf('.bottom-nav-item.is-active');
  const active = css.slice(activeStart, activeStart + 260);
  assert.match(active, /var\(--ui-mint-surface\)/);
  assert.match(css, /\.bottom-nav-icon \{[^}]*width:21px/);
});

test('mobile motion uses central tokens and honours prefers-reduced-motion', async () => {
  const css = await read('src/index.css');
  assert.match(css, /--ui-motion-fast:\s*120ms/);
  assert.match(css, /--ui-motion-base:\s*160ms/);
  assert.match(css, /--ui-motion-slow:\s*240ms/);
  assert.match(css, /--ui-ease-out:/);
  assert.match(css, /--ui-ease-in:/);
  assert.match(css, /--ui-ease-in-out:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  // حركة دخول الصفحة تعتمد opacity/transform فقط (بلا layout shift) وتُعطَّل عند تقليل الحركة.
  const kfStart = css.indexOf('@keyframes ui-content-in');
  const keyframes = css.slice(kfStart, css.indexOf('.app-main > div', kfStart));
  assert.match(keyframes, /opacity/);
  assert.match(keyframes, /translateY/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{[^}]*\.app-main \.ptr__content > :first-child \{ animation: ui-content-in/s);
});

test('mobile layout reserves space for the docked bar and uses touch-friendly sizing', async () => {
  const [css, button] = await Promise.all([read('src/index.css'), read('src/components/ui/Button.jsx')]);
  assert.match(css, /\.app-main \{[^}]*calc\(6\.5rem \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /a, button, \[role="button"\], label, summary \{ touch-action: manipulation; \}/);
  assert.match(css, /\.input-field,[\s\S]{0,140}font-size: 16px/, 'منع تكبير iOS عند التركيز على الحقول');
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)/);
  assert.match(css, /\.btn \{[\s\S]*?user-select:none/);
  assert.match(button, /disabled=\{isDisabled\}/);
  assert.match(button, /aria-disabled=\{isDisabled \|\| undefined\}/);
});

test('mobile sheets and modals stay performant and avoid nested-scroll bleed', async () => {
  const css = await read('src/index.css');
  const sheet = ruleBody(css, '.sheet');
  assert.match(sheet, /overscroll-behavior: contain/);
  assert.match(sheet, /max-height: 88dvh/);
  assert.match(sheet, /var\(--ui-motion-slow\)/);
  assert.doesNotMatch(ruleBody(css, '.sheet-backdrop'), /backdrop-filter/);
  assert.doesNotMatch(ruleBody(css, '.overlay'), /backdrop-filter/);
});

test('semantic status colours stay distinct from the brand green', async () => {
  const [css, tailwind] = await Promise.all([read('src/index.css'), read('tailwind.config.js')]);
  const success = /--ui-success:\s*(#[0-9A-F]{6})/i.exec(css)?.[1];
  const danger = /--ui-danger:\s*(#[0-9A-F]{6})/i.exec(css)?.[1];
  const warning = /--ui-warning:\s*(#[0-9A-F]{6})/i.exec(css)?.[1];
  assert.ok(success && danger && warning);
  for (const value of [success, danger, warning]) {
    assert.notEqual(value.toUpperCase(), '#235347', 'الحالات الدلالية يجب ألا تُستبدل بلون الهوية');
  }
  assert.match(tailwind, /success:\s*\{/);
  assert.match(tailwind, /danger:\s*\{/);
  assert.match(tailwind, /warning:\s*\{/);
});

test('mobile drawer and quick sheet lock background scrolling and close predictably', async () => {
  const [layout, nav, css, lock] = await Promise.all([
    read('src/components/Layout.jsx'),
    read('src/components/BottomNav.jsx'),
    read('src/index.css'),
    read('src/lib/useBodyScrollLock.js'),
  ]);
  assert.match(layout, /useBodyScrollLock\(sidebarOpen\)/);
  assert.match(layout, /event\.key === 'Escape'\) setSidebarOpen\(false\)/);
  assert.match(layout, /setSidebarOpen\(false\);\s*\}, \[location\.pathname\]\)/);
  assert.match(nav, /useBodyScrollLock\(quickOpen\)/);
  assert.match(lock, /activeLocks/);
  assert.match(lock, /body\.style\.overflow = 'hidden'/);

  const backdrop = ruleBody(css, '.sidebar-backdrop');
  assert.match(backdrop, /z-index:44/, 'الخلفية يجب أن تغطي شريط التنقل السفلي عند فتح الدرج');
});
