/**
 * EyeGo Font System — Onyx
 * UI: Geist (geometric, premium)
 * Data/labels/mono-caps: JetBrains Mono
 */

export const fonts = {
  // Geist
  displayExtraBold: 'Geist_700Bold',
  displayBold: 'Geist_700Bold',
  displaySemiBold: 'Geist_600SemiBold',
  displayMedium: 'Geist_500Medium',

  semiBold: 'Geist_600SemiBold',
  medium: 'Geist_500Medium',
  regular: 'Geist_400Regular',
  light: 'Geist_300Light',
  bold: 'Geist_600SemiBold',

  // JetBrains Mono — tabular-figure digits (OTP boxes, animated fare ticker)
  // and uppercase "label-caps" chips/step-indicators/distance labels
  monoBold: 'JetBrainsMono_700Bold',
  monoRegular: 'JetBrainsMono_500Medium',
  labelCaps: 'JetBrainsMono_500Medium',
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
