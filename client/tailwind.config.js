/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ['./index.html', './src/**/*.{js,jsx}'] },
  theme: {
    extend: {
      colors: {
        pirate: {
          dark: '#1a0f0a',
          brown: '#3d2b1f',
          tan: '#c4a265',
          gold: '#ffd700',
          red: '#8b0000',
          sea: '#1a3a4a',
          deepSea: '#0d2530',
        },
      },
      fontFamily: {
        pirate: ['"Pirata One"', 'cursive'],
      },
    },
  },
  plugins: [],
};
