/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lumi: {
          50: '#f3e8ff',
          100: '#e4ccff',
          200: '#c999ff',
          300: '#ae66ff',
          400: '#9333ff',
          500: '#7c1fff',
          600: '#6b00f0',
          700: '#5500c0',
          800: '#3d008a',
          900: '#270057',
          950: '#15002e',
        },
        dark: {
          50: '#f5f5f6',
          100: '#e6e6e8',
          200: '#d0d0d4',
          300: '#aeaeb5',
          400: '#86868f',
          500: '#6b6b74',
          600: '#5b5b63',
          700: '#4d4d54',
          800: '#434348',
          850: '#2a2a2f',
          900: '#1e1e22',
          925: '#18181b',
          950: '#0f0f11',
        },
      },
    },
  },
  plugins: [],
};
