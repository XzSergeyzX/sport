/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'media' ломает веб-рантайм NativeWind (color-scheme observer). Наш UI тёмный
  // безусловно (явные bg-graphite-*), dark: варианты не используем.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Графит-форвард палитра (см. docs/SPEC.md §6)
        graphite: {
          50: '#F6F7F9',
          100: '#ECEEF1',
          200: '#D5D9DF',
          300: '#B0B7C1',
          400: '#848D9A',
          500: '#5C6675',
          600: '#454E5C',
          700: '#343B47',
          800: '#23272F',
          900: '#16191F',
          950: '#0C0E12',
        },
        // Провизорный акцент — финальный оттенок подберём на первых экранах
        accent: {
          DEFAULT: '#1FB89A',
          dark: '#17A085',
        },
      },
    },
  },
  plugins: [],
};
