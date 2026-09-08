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
  /**
   * The dead segments of a GradientGlowBorder's conic sweep.
   *
   * The palettes in `RING_PALETTES` author these as '#0A0A0C' inline, which is
   * correct here and wrong on any light surface — a near-black band around a
   * white card is the "overshot glow border" a light theme ends up with. A theme
   * overrides this token with its own surface colour and the ring's gaps become
   * the card; dark themes leave it as the black the palettes were drawn against.
   */
  ringGap: '#0A0A0C',
  premiumBlue: '#3D7EFF',
  premiumBlueDim: '#0A56FF',
  premiumBlueBright: '#9CC5FF',
  premiumOrange: '#FF7A3D',
  premiumOrangeDim: '#FF5500',
  premiumOrangeBright: '#FFC59C',
} as const;

// Widened to plain `string` per key (not `typeof colors`) so any palette with
// the same key shape — e.g. driverColors — can satisfy this type. A literal
// `typeof colors` type would lock ColorsProvider/useThemedColors to rider's
// exact hex values, making the whole context rider-only.
export type ColorTokens = { [K in keyof typeof colors]: string };

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
// Full parity with `ColorTokens` (same keys as rider's `colors`) plus a small
// set of driver-only extras (accent/online/offline/warning/glowAccent) — this
// is what lets driverColors satisfy ColorsProvider's shared context type, so
// every packages/ui component (AppBackground, GlassSurface, GradientGlowBorder,
// etc.) renders blue for driver with zero per-component changes.
export type DriverColorTokens = ColorTokens & {
  accent: string;
  accentDim: string;
  online: string;
  offline: string;
  warning: string;
  glowAccent: string;
};

/**
 * DRIVER ONYX — THE GROUND IS BLACK, THE BLUE IS THE LIGHT ON IT.
 *
 * BUGFIX ("the rider tracking page uses deep black for the background even
 * though the green and the glows are shown… the driver app seems stocked and
 * basic/outdated").
 *
 * The old ramp started at `#030C18` — a saturated navy — and every surface
 * above it carried the same hue at a higher lightness. That is a BLUE app, not
 * a black app with blue in it, and it costs three things at once: the blue
 * glows have nothing dark to bloom against, the neutral greys used for
 * secondary text sit on a coloured ground and read muddy, and the whole thing
 * looks like a default Material dark-blue theme rather than a designed one.
 *
 * The rider's Onyx ramp is 06 → 0A → 16 → 1A → 22 → 2C → 33 in pure neutral.
 * The driver's is now the same lightness ladder with a cool cast that only
 * becomes legible as the surfaces rise — the ground is effectively black, and
 * the identity lives in `primary`, the glows, and the elevated containers,
 * which is where it was always supposed to live.
 */
export const driverColors: DriverColorTokens = {
  backgroundDeep: '#050507',
  background: '#090A0D',
  surfaceDim: '#090A0D',
  surfaceCard: '#14161C',
  surfaceContainer: '#181B23',
  surfaceContainerHigh: '#20242F',
  surfaceContainerHighest: '#2A2F3D',
  surfaceVariant: '#2A2F3D',
  surfaceBright: '#323847',
  surfaceInput: '#0C0D11',

  rimLight: 'rgba(255, 255, 255, 0.10)',
  rimLightSubtle: 'rgba(255, 255, 255, 0.06)',

  primary: '#3B82F6',
  primaryDim: '#2563EB',
  onPrimary: '#EFF6FF',
  inversePrimary: '#1D4ED8',
  primaryFixed: '#BFDBFE',
  primaryFixedDim: '#60A5FA',
  onPrimaryFixed: '#001B3D',
  onPrimaryFixedVariant: '#0B3E91',
  accent: '#60A5FA',
  accentDim: '#3B82F6',

  secondary: '#60A5FA',
  secondaryContainer: '#1E3A5F',
  onSecondary: '#001B3D',
  onSecondaryContainer: '#DCEAFF',
  secondaryFixed: '#D6E4FF',
  secondaryFixedDim: '#93C5FD',

  tertiary: '#ffb5ab',
  tertiaryContainer: '#ff8b7c',
  onTertiary: '#60130d',
  onTertiaryContainer: '#76231b',

  onBackground: '#E2E8F0',
  onSurface: '#E2E8F0',
  onSurfaceVariant: '#94A3B8',
  inverseOnSurface: '#181B23',
  inverseSurface: '#E2E8F0',

  outline: '#242A38',
  outlineVariant: '#171B25',
  surfaceTint: '#2563EB',
  scrim: '#000000',

  error: '#F87171',
  onError: '#7F1D1D',
  errorContainer: '#991B1B',
  onErrorContainer: '#FEE2E2',

  statusSuccess: '#22C55E',
  statusError: '#FF3B30',
  statusWarning: '#FED639',
  statusInfo: '#00B2FF',

  tierEconomy: '#4BE277',
  tierComfort: '#00B2FF',
  tierPremium: '#FFD700',
  tierRoyal: '#7000FF',

  glowPrimary: 'rgba(59, 130, 246, 0.4)',
  glowSecondary: 'rgba(96, 165, 250, 0.3)',
  glowAccent: 'rgba(96, 165, 250, 0.25)',
  glowError: 'rgba(248, 113, 113, 0.4)',

  premiumRingDark: '#050609',
  // Dark theme — the ring gaps stay the black the palettes were authored against.
  ringGap: '#0A0A0C',
  premiumBlue: '#3D7EFF',
  premiumBlueDim: '#0A56FF',
  premiumBlueBright: '#9CC5FF',
  premiumOrange: '#FF7A3D',
  premiumOrangeDim: '#FF5500',
  premiumOrangeBright: '#FFC59C',

  online: '#3B82F6',
  offline: '#64748B',
  warning: '#FBBF24',
};

export const driverLightColors: DriverColorTokens = {
  backgroundDeep: '#E2E8F0',
  background: '#F1F5F9',
  surfaceDim: '#F1F5F9',
  surfaceCard: '#FFFFFF',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F8FAFC',
  surfaceContainerHighest: '#F1F5F9',
  surfaceVariant: '#E2E8F0',
  surfaceBright: '#FFFFFF',
  surfaceInput: '#F8FAFC',

  rimLight: 'rgba(15, 23, 42, 0.08)',
  rimLightSubtle: 'rgba(15, 23, 42, 0.05)',

  primary: '#2563EB',
  primaryDim: '#1D4ED8',
  onPrimary: '#FFFFFF',
  inversePrimary: '#93C5FD',
  primaryFixed: '#BFDBFE',
  primaryFixedDim: '#60A5FA',
  onPrimaryFixed: '#001B3D',
  onPrimaryFixedVariant: '#0B3E91',
  accent: '#3B82F6',
  accentDim: '#2563EB',

  secondary: '#3B82F6',
  secondaryContainer: '#DBEAFE',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#001B3D',
  secondaryFixed: '#D6E4FF',
  secondaryFixedDim: '#93C5FD',

  tertiary: '#B3261E',
  tertiaryContainer: '#F9DEDC',
  onTertiary: '#FFFFFF',
  onTertiaryContainer: '#410E0B',

  onBackground: '#0F172A',
  onSurface: '#0F172A',
  onSurfaceVariant: '#64748B',
  inverseOnSurface: '#F1F5F9',
  inverseSurface: '#0F172A',

  outline: '#CBD5E1',
  outlineVariant: '#E2E8F0',
  surfaceTint: '#2563EB',
  scrim: '#000000',

  error: '#DC2626',
  onError: '#FFFFFF',
  errorContainer: '#FEF2F2',
  onErrorContainer: '#7F1D1D',

  statusSuccess: '#16A34A',
  statusError: '#DC2626',
  statusWarning: '#D97706',
  statusInfo: '#0284C7',

  tierEconomy: '#16A34A',
  tierComfort: '#0284C7',
  tierPremium: '#B7860B',
  tierRoyal: '#6D28D9',

  glowPrimary: 'rgba(37, 99, 235, 0.25)',
  glowSecondary: 'rgba(59, 130, 246, 0.15)',
  glowAccent: 'rgba(59, 130, 246, 0.15)',
  glowError: 'rgba(220, 38, 38, 0.25)',

  premiumRingDark: '#F1F5F9',
  // Driver light theme — the ring's dead segments become the card, not black.
  ringGap: '#FFFFFF',
  premiumBlue: '#2563EB',
  premiumBlueDim: '#1D4ED8',
  premiumBlueBright: '#93C5FD',
  premiumOrange: '#EA580C',
  premiumOrangeDim: '#C2410C',
  premiumOrangeBright: '#FDBA74',

  online: '#2563EB',
  offline: '#94A3B8',
  warning: '#D97706',
};

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

/**
 * THE ROUTE LINE IS NOT THE BRAND COLOUR.
 *
 * BUGFIX ("on the suggested trip, the map at the top that shows the route is in
 * green and the main roads are all green — change the colour of the route
 * polyline"). EyeGo's primary is `#4be277`, and so are the trunk roads in the
 * house map style. A green line drawn on top of green roads is not a route; it
 * is a slightly thicker road. `TripMap` had already moved to amber for exactly
 * this reason, but the trip-detail map was still painting `colors.primary`, so
 * the same journey looked different depending on which screen you were on.
 *
 * Amber sits opposite green on the wheel and appears nowhere in the base style,
 * so it reads as an overlay in both light and dark. The casing is the deep
 * background colour, which is what gives it an edge over pale roads.
 *
 * One value, both apps, every map. Never substitute `colors.primary` here.
 */
export const routeLine = {
  /** The line itself. */
  stroke: '#FFB020',
  /** Drawn underneath and wider, so the stroke never blends into a road. */
  casing: '#000000',
  /** The part already travelled, or a secondary leg (pickup → rider). */
  muted: '#8A6A2A',
} as const;
