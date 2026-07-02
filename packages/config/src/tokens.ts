/**
 * EyeGo Design Tokens
 * EyeGo Onyx — Midnight Tech-Luxury
 */

export const colors = {
  // Backgrounds — rich neutral Onyx blacks (no green tint)
  backgroundDeep: '#060607',          // deepest bg — near-pure black
  background: '#0A0A0B',              // main bg
  surfaceDim: '#0A0A0B',              // alias for main bg
  surfaceCard: '#161618',             // card surfaces — Onyx neutral
  surfaceContainer: '#1A1A1D',        // elevated cards
  surfaceContainerHigh: '#222225',    // further elevated
  surfaceContainerHighest: '#2C2C30',
  surfaceVariant: '#2C2C30',
  surfaceBright: '#333338',
  surfaceInput: '#0D0D0E',            // inputs/search boxes — darker than card

  // Rim lighting — 1px inner borders instead of drop shadows (Onyx "machined" look)
  rimLight: 'rgba(255, 255, 255, 0.10)',
  rimLightSubtle: 'rgba(255, 255, 255, 0.06)',

  // Brand
  primary: '#4be277',                 // green CTA
  primaryDim: '#4ae176',
  onPrimary: '#002109',
  inversePrimary: '#006e2f',
  primaryFixed: '#b1f2c5',
  primaryFixedDim: '#4ae176',
  onPrimaryFixed: '#002109',
  onPrimaryFixedVariant: '#005321',

  // Secondary (blue)
  secondary: '#adc6ff',
  secondaryContainer: '#284777',
  onSecondary: '#001a42',
  onSecondaryContainer: '#e6ecff',
  secondaryFixed: '#d8e2ff',
  secondaryFixedDim: '#adc6ff',

  // Tertiary (coral/red)
  tertiary: '#ffb5ab',
  tertiaryContainer: '#ff8b7c',
  onTertiary: '#60130d',
  onTertiaryContainer: '#76231b',

  // Text — Onyx warm white
  onBackground: '#dce4e5',
  onSurface: '#dce4e5',
  onSurfaceVariant: '#b9cacb',
  inverseOnSurface: '#2a322a',
  inverseSurface: '#dce4e5',

  // UI
  outline: '#849495',
  outlineVariant: '#3b494b',
  surfaceTint: '#4ae176',
  scrim: '#000000',

  // Semantic errors
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',

  // Status — explicit action-state colors
  statusSuccess: '#4be277',
  statusError: '#FF3B30',
  statusWarning: '#FED639',
  statusInfo: '#00B2FF',

  // Service tier colors
  tierEconomy: '#4BE277',             // = primary — clean, accessible
  tierComfort: '#00B2FF',             // electric blue
  tierPremium: '#FFD700',             // metallic gold
  tierRoyal: '#7000FF',               // deep purple

  // Glows
  glowPrimary: 'rgba(75, 226, 119, 0.4)',
  glowSecondary: 'rgba(5, 102, 217, 0.4)',
  glowError: 'rgba(255, 180, 171, 0.4)',

  // Premium glow accent — reserved for GradientGlowBorder-driven surfaces
  // (glow search bar, glow CTA, premium ride card ring). A cool-blue /
  // warm-orange duo reads as a crisp orbiting light against Onyx black in a
  // way the green/blue brand pair washes into a flat wash at ring-thickness.
  premiumRingDark: '#0A0A0C',
  premiumBlue: '#3D7EFF',
  premiumBlueDim: '#0A56FF',
  premiumBlueBright: '#9CC5FF',
  premiumOrange: '#FF7A3D',
  premiumOrangeDim: '#FF5500',
  premiumOrangeBright: '#FFC59C',
} as const;

export type ColorTokens = typeof colors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  '5xl': 64,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,    // bottom sheets, large modals
  full: 9999,
} as const;

export const shadows = {
  primaryGlow: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
} as const;

// ── Driver App Design Tokens (Electric Blue) ─────────────────────────────────
export const driverColors = {
  backgroundDeep: '#030C18',
  background: '#060F1A',
  surfaceContainer: '#0D1B2A',
  surfaceContainerHigh: '#112240',
  surfaceContainerHighest: '#162B4F',

  primary: '#3B82F6',
  primaryDim: '#2563EB',
  onPrimary: '#EFF6FF',
  accent: '#60A5FA',
  accentDim: '#3B82F6',

  secondary: '#60A5FA',
  secondaryContainer: '#1E3A5F',

  onBackground: '#E2E8F0',
  onSurface: '#E2E8F0',
  onSurfaceVariant: '#94A3B8',
  inverseOnSurface: '#0D1B2A',
  inverseSurface: '#E2E8F0',

  outline: '#1E3A5F',
  outlineVariant: '#0F2239',
  scrim: '#000000',

  error: '#F87171',
  onError: '#7F1D1D',
  errorContainer: '#991B1B',
  onErrorContainer: '#FEE2E2',

  online: '#3B82F6',
  offline: '#64748B',

  glowPrimary: 'rgba(59, 130, 246, 0.4)',
  glowAccent: 'rgba(96, 165, 250, 0.25)',
  glowError: 'rgba(248, 113, 113, 0.4)',
  warning: '#FBBF24',
} as const;

export const animation = {
  spring: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 20,
  },
  springFast: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 25,
  },
  springBouncy: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 15,
  },
  timing: (duration = 300) => ({
    type: 'timing' as const,
    duration,
  }),
  // Premium "high-tech" motion contract — overdamped, no cartoon bounce.
  // Micro-interactions should stay <=200ms, full-screen reveals <=350ms.
  premiumSpring: {
    type: 'spring' as const,
    mass: 0.6,
    damping: 16,
    stiffness: 120,
  },
  premiumEase: [0.16, 1, 0.3, 1] as const,
} as const;
