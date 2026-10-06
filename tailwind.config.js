/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FDF6F3', 100: '#F3C5B5', 200: '#E8A890', 300: '#E08A6A',
          400: '#D97757', 500: '#D97757', 600: '#B85C3E', 700: '#9A4A32',
          800: '#7C3B28', 900: '#5E2D1F', 950: '#3D2A24',
        },
        brand: { DEFAULT: '#D97757', dark: '#B85C3E', light: '#F3C5B5', soft: '#FDF6F3', gold: '#B8953A' },
        canvas: '#F7F4EF',
        surface: { DEFAULT: '#FFFFFF', app: '#F7F4EF', raised: '#FFFEFC', sunken: '#F8F5F1', muted: '#F3C5B5' },
        ink: { DEFAULT: '#292524', secondary: '#78716C', tertiary: '#A8A29E', soft: '#57534E' },
        line: { DEFAULT: '#E7E2DC', strong: '#DED8D1' },
        sidebar: { DEFAULT: '#1F1F1F', hover: '#2A2A2A', active: '#333333' },
        success: { DEFAULT: '#6B8E72', soft: '#E8F0E9', ink: '#3F5A46' },
        danger: { DEFAULT: '#C65D5D', soft: '#F8E8E8', ink: '#8E3B3B' },
        warning: { DEFAULT: '#D59A3A', soft: '#FBF0E0', ink: '#7A5514' },
        gold: { DEFAULT: '#B8953A', soft: '#FBF3DD', ink: '#7A5F14' },
      },
      fontFamily: { sans: ['Tajawal', 'sans-serif'] },
      borderRadius: { control: '13px', card: '22px', hero: '28px', tile: '15px' },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(41, 37, 36, 0.06)',
        card: '0 1px 3px 0 rgba(41, 37, 36, 0.04), 0 1px 2px -1px rgba(41, 37, 36, 0.04)',
        elevated: '0 10px 40px -10px rgba(41, 37, 36, 0.12)',
        brand: '0 10px 28px -6px rgba(217, 119, 87, 0.28)',
      },
      transitionTimingFunction: { ui: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
      transitionDuration: { fast: '120ms', base: '160ms', slow: '220ms' },
      zIndex: { header: '30', bottomnav: '40', overlay: '50', modal: '60', toast: '70' },
      maxWidth: { shell: '1500px' },
    },
  },
  plugins: [],
};
