/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Krotak Admin Design System v1.0 — المصدر المركزي للألوان في طبقة Tailwind.
        // نفس القيم معرّفة كمتغيرات CSS في src/index.css (--ui-*).
        forest: '#051F20',
        deepForest: '#0B2B26',
        forestGreen: '#163832',
        primaryGreen: '#235347',
        sageGreen: '#8EB69B',
        mintSurface: '#DAF1DE',
        primary: {
          50: '#EAF4EC', 100: '#DAF1DE', 200: '#BBDCC4', 300: '#8EB69B',
          400: '#4F7A67', 500: '#235347', 600: '#1C4439', 700: '#163832',
          800: '#0B2B26', 900: '#051F20', 950: '#041617',
        },
        brand: { DEFAULT: '#235347', dark: '#163832', light: '#8EB69B', soft: '#DAF1DE', gold: '#B8953A' },
        canvas: '#F4F7F5',
        surface: { DEFAULT: '#FFFFFF', app: '#F4F7F5', raised: '#FFFFFF', sunken: '#EDF3EE', muted: '#DAF1DE' },
        ink: { DEFAULT: '#0B1F18', secondary: '#33544A', tertiary: '#8CA096', soft: '#33544A' },
        muted: '#5B7268',
        line: { DEFAULT: '#DDE8E1', strong: '#C6D8CC' },
        sidebar: { DEFAULT: '#051F20', hover: '#0B2B26', active: '#163832' },
        success: { DEFAULT: '#3F7A5B', soft: '#E6F3EB', ink: '#1F5138' },
        danger: { DEFAULT: '#B3403F', soft: '#FBECEC', ink: '#8A2B2B' },
        warning: { DEFAULT: '#A97620', soft: '#FBF1DF', ink: '#6E4B0E' },
        gold: { DEFAULT: '#B8953A', soft: '#FBF3DD', ink: '#7A5F14' },
      },
      // الخط الحالي المعتمد في المشروع — لا يُستبدل.
      fontFamily: { sans: ['Tajawal', 'sans-serif'] },
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
