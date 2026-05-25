/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // EyeGo design tokens
        'background-deep': '#091009',
        background: '#0e150e',
        surface: '#1a221a',
        'surface-high': '#242c24',
        'surface-highest': '#2f372e',
        primary: '#4be277',
        'on-primary': '#002109',
        secondary: '#adc6ff',
        'on-surface': '#dce5d9',
        'on-surface-variant': '#bccbb9',
        outline: '#869585',
        'outline-variant': '#3d4b3c',
        error: '#ffb4ab',
        'error-container': '#93000a',
      },
      fontFamily: {
        'display-bold': ['SpaceGrotesk_700Bold'],
        'display-semibold': ['SpaceGrotesk_600SemiBold'],
        'display-medium': ['SpaceGrotesk_500Medium'],
        'body-semibold': ['Inter_600SemiBold'],
        'body-medium': ['Inter_500Medium'],
        'body-regular': ['Inter_400Regular'],
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
    },
  },
  plugins: [],
};
