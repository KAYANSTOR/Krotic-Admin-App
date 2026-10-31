/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Krotak Admin Design System v1.0 — المصدر المركزي للألوان في طبقة Tailwind.
        // نفس القيم معرّفة كمتغيرات CSS في src/index.css (--ui-*).
        terracotta: { DEFAULT: '#D97757', dark: '#B85C3E', light: '#F3C5B5', deep: '#2D1810' },
        beige: '#F7F4EF',
        forest: '#2D1810',
        deepForest: '#4A2418',
        forestGreen: '#8E4330',
        primaryGreen: '#D97757',
        sageGreen: '#E89F85',
        mintSurface: '#FBE9E2',
        primary: {
          50: '#FEF5F1', 100: '#FBE9E2', 200: '#F3C5B5', 300: '#E89F85',
          400: '#D97757', 500: '#D97757', 600: '#B85C3E', 700: '#8E4330',
          800: '#4A2418', 900: '#2D1810', 950: '#1A1410',
        },
        brand: { DEFAULT: 'var(--ui-brand)', dark: 'var(--ui-brand-deep)', light: 'var(--ui-brand-tint)', soft: 'var(--ui-brand-soft)', gold: '#B8953A' },
        canvas: '#F7F4EF',
        surface: { DEFAULT: '#FFFFFF', app: '#F7F4EF', raised: '#FFFFFF', sunken: 'var(--ui-sunken)', muted: 'var(--ui-brand-soft)' },
        ink: { DEFAULT: 'var(--ui-ink)', secondary: 'var(--ui-ink-soft)', tertiary: 'var(--ui-faint)', soft: 'var(--ui-ink-soft)' },
        muted: 'var(--ui-muted)',
        line: { DEFAULT: 'var(--ui-line)', strong: 'var(--ui-line-strong)' },
        sidebar: { DEFAULT: '#2D1810', hover: '#4A2418', active: '#8E4330' },
        success: { DEFAULT: '#3F7A5B', soft: '#E6F3EB', ink: '#1F5138' },
        danger: { DEFAULT: '#B3403F', soft: '#FBECEC', ink: '#8A2B2B' },
        warning: { DEFAULT: '#A97620', soft: '#FBF1DF', ink: '#6E4B0E' },
        gold: { DEFAULT: '#B8953A', soft: '#FBF3DD', ink: '#7A5F14' },
      },
      // الخط الحالي المعتمد في المشروع — لا يُستبدل.
      fontFamily: { sans: ['Tajawal', '-apple-system', 'system-ui', 'sans-serif'] },
      spacing: { touch: '48px', 'safe-b': 'env(safe-area-inset-bottom)', 'safe-t': 'env(safe-area-inset-top)' },
      borderRadius: { 'm3-sm': '8px', 'm3-md': '12px', 'm3-lg': '16px', 'm3-xl': '20px', 'm3-2xl': '28px' },
      borderRadius: { control: '10px', card: '16px', hero: '20px', tile: '12px', sheet: '20px' },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(11, 31, 24, 0.06)',
        card: '0 1px 3px 0 rgba(11, 31, 24, 0.04), 0 1px 2px -1px rgba(11, 31, 24, 0.04)',
        elevated: '0 10px 40px -10px rgba(11, 31, 24, 0.14)',
        brand: '0 10px 28px -6px rgba(35, 83, 71, 0.26)',
      },
      transitionTimingFunction: {
        ui: 'cubic-bezier(0.2, 0.75, 0.25, 1)',
        'ui-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'ui-in': 'cubic-bezier(0.4, 0, 1, 1)',
        'ui-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: { fast: '120ms', base: '160ms', slow: '240ms' },
      zIndex: { header: '30', bottomnav: '40', overlay: '50', modal: '60', toast: '70' },
      maxWidth: { shell: '1500px' },
    },
  },
  plugins: [],
};
