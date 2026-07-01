/**
 * EyeGo Font System
 * Display: Space Grotesk (geometric, premium)
 * Body: Inter (legible, clean)
 */

export const fonts = {
  // Space Grotesk
  displayExtraBold: 'SpaceGrotesk_700Bold',
  displayBold: 'SpaceGrotesk_700Bold',
  displaySemiBold: 'SpaceGrotesk_600SemiBold',
  displayMedium: 'SpaceGrotesk_500Medium',

  // Inter
  semiBold: 'Inter_600SemiBold',
  medium: 'Inter_500Medium',
  regular: 'Inter_400Regular',
  light: 'Inter_300Light',

  // Mono (mapped to SpaceGrotesk bold for fare numbers)
  monoBold: 'SpaceGrotesk_700Bold',
  monoRegular: 'SpaceGrotesk_500Medium',
  bold: 'Inter_600SemiBold',
} as const;

export const fontSizes = {
  hero: 48,
  display: 36,
  headlineLarge: 28,
  headlineMedium: 24,
  headlineSmall: 20,
  titleLarge: 20,
  titleMedium: 18,
  titleSmall: 16,
  bodyLarge: 16,
  bodyMedium: 14,
  bodySmall: 12,
  label: 14,
  caption: 11,
  // Fare display sizes
  fareLarge: 32,
  fareMedium: 24,
  fareSmall: 18,
  fareInline: 16,
} as const;

export const lineHeights = {
  // Legacy scale (keep for backward compat)
  tight: 1.1,
  normal: 1.4,
  relaxed: 1.6,
  // Onyx editorial scale
  display: 1.15,   // hero/fare headings
  body: 1.5,       // standard body text
} as const;

export const letterSpacings = {
  // Legacy scale (keep for backward compat)
  tight: -0.5,
  normal: 0,
  wide: 0.5,
  wider: 1,
  // Onyx editorial scale
  display: -1.5,   // hero / fare / display headings (≈ -0.03em at 48px)
  headline: -0.5,  // section headings (≈ -0.02em at 28px)
  label: 0.6,      // chip / badge / data labels (≈ 0.05em at 12px)
} as const;
