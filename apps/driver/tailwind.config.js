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
        // EyeGo Driver — Electric Blue
        'background-deep': '#030C18',
        background: '#060F1A',
        surface: '#0D1B2A',
        'surface-high': '#112240',
        'surface-highest': '#162B4F',
        primary: '#3B82F6',
        'on-primary': '#EFF6FF',
        accent: '#60A5FA',
        secondary: '#22C55E',
        'on-surface': '#E2E8F0',
        'on-surface-variant': '#94A3B8',
        outline: '#1E3A5F',
        'outline-variant': '#0F2239',
        error: '#F87171',
        'error-container': '#991B1B',
        online: '#22C55E',
        offline: '#64748B',
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
