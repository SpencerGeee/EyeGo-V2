import { useThemeStore } from '../stores/theme.store';

export const darkColors = {
  // Backgrounds — rich neutral Onyx blacks (no green tint)
  backgroundDeep: '#060607',
  background: '#0A0A0B',
  surfaceDim: '#0A0A0B',
  surfaceCard: '#161618',
  surfaceContainer: '#1A1A1D',
  surfaceContainerHigh: '#222225',
  surfaceContainerHighest: '#2C2C30',
  surfaceVariant: '#2C2C30',
  surfaceBright: '#333338',
  surfaceInput: '#0D0D0E',            // inputs/search boxes recede toward base bg

  // Rim lighting — 1px inner borders instead of drop shadows
  rimLight: 'rgba(255, 255, 255, 0.10)',
  rimLightSubtle: 'rgba(255, 255, 255, 0.06)',

  // Brand
  primary: '#4be277',
  primaryDim: '#4ae176',
  onPrimary: '#002109',
  inversePrimary: '#006e2f',
  primaryFixed: '#b1f2c5',
  primaryFixedDim: '#4ae176',
  onPrimaryFixed: '#002109',
  onPrimaryFixedVariant: '#005321',

  // Secondary
  secondary: '#adc6ff',
  secondaryContainer: '#284777',
  onSecondary: '#001a42',
  onSecondaryContainer: '#e6ecff',
  secondaryFixed: '#d8e2ff',
  secondaryFixedDim: '#adc6ff',

  // Tertiary
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

  // Status
  statusSuccess: '#4be277',
  statusError: '#FF3B30',
  statusWarning: '#FED639',
  statusInfo: '#00B2FF',

  // Service tier colors
  tierEconomy: '#4BE277',
  tierComfort: '#00B2FF',
  tierPremium: '#FFD700',
  tierRoyal: '#7000FF',

  // Glows
  glowPrimary: 'rgba(75, 226, 119, 0.4)',
  glowSecondary: 'rgba(5, 102, 217, 0.4)',
  glowError: 'rgba(255, 180, 171, 0.4)',

  /** The "off" arc of a GradientGlowBorder sweep — see the light-mode note. */
  ringGap: '#0A0A0C',

  // Premium glow accent — reserved for GradientGlowBorder-driven surfaces
  // (glow search bar, glow CTA, premium ride card ring).
  premiumRingDark: '#0A0A0C',
  premiumBlue: '#3D7EFF',
  premiumBlueDim: '#0A56FF',
  premiumBlueBright: '#9CC5FF',
  premiumOrange: '#FF7A3D',
  premiumOrangeDim: '#FF5500',
  premiumOrangeBright: '#FFC59C',
} as const;

/**
 * LIGHT MODE IS THE DARK COMPOSITION WITH THE GROUND INVERTED — NOT A WASH.
 *
 * BUGFIX ("the light mode is completely done wrong… the glass cards can barely
 * be seen and the white isn't even a clearer shade of white, it's more like a
 * tint of it").
 *
 * The old palette read as a tint for a structural reason, not a taste one. In
 * DARK mode a card is LIGHTER than the page it sits on (#161618 on #0A0A0B), so
 * elevation is a step towards the light and the eye reads it instantly. The
 * light palette copied that direction and inverted only the numbers: page
 * #FFFFFF, card #F7F7F8 — a 3% step, in the WRONG direction, on the brightest
 * surface a phone can show. Every card was a faintly grey rectangle on white,
 * and the ambient wave laid a further green film over all of it, which is the
 * "tint" in the report.
 *
 * So the direction is flipped to match how light surfaces actually work:
 *
 *   - CARDS ARE PURE WHITE. `surfaceCard` is the cleanest white in the palette,
 *     and it is the page that carries the tone — exactly the inverse of dark
 *     mode, and the reason a white card reads as lifted rather than as a smudge.
 *   - The elevation ladder now steps DOWN from white in perceptible increments
 *     (~4–6% per step, versus the old ~3% total across four steps), so
 *     `surfaceContainerHigh` is a different colour from `surfaceCard` rather
 *     than a rounding error.
 *   - Rims and outlines are roughly 40% stronger. On a dark surface a card edge
 *     is carried by its own brightness; on a light one nothing but the edge
 *     itself separates two whites, so the edge has to be able to be seen.
 *
 * `backgroundDeep` stays pure white on purpose: it is what the Skia wave
 * composites ONTO (see AppBackground's `baseColor`), and that is what turns the
 * shader's black valleys white while keeping its green crests — the inversion
 * the brief actually asks for.
 */
export const lightColors = {
  // Backgrounds — white ground, white cards, tone in the steps between them.
  backgroundDeep: '#FFFFFF',
  background: '#FFFFFF',
  surfaceDim: '#F1F2F5',
  surfaceCard: '#FFFFFF',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F4F5F8',
  surfaceContainerHighest: '#E9EAEF',
  surfaceVariant: '#DFE1E7',
  surfaceBright: '#FFFFFF',
  surfaceInput: '#F1F2F5',            // recedes from a white card, as inputs should

  // Rim lighting — black-based on light surfaces (dark uses white-based).
  // Stronger than the old 0.10/0.06: on white, the rim IS the card edge.
  rimLight: 'rgba(0, 0, 0, 0.14)',
  rimLightSubtle: 'rgba(0, 0, 0, 0.08)',

  // Brand (darker green for contrast on light surfaces)
  primary: '#1a7a3c',
  primaryDim: '#1a7a3c',
  onPrimary: '#ffffff',
  inversePrimary: '#4ae176',
  primaryFixed: '#b1f2c5',
  primaryFixedDim: '#1a7a3c',
  onPrimaryFixed: '#002109',
  onPrimaryFixedVariant: '#005321',

  // Secondary
  secondary: '#284777',
  secondaryContainer: '#d8e2ff',
  onSecondary: '#ffffff',
  onSecondaryContainer: '#001a42',
  secondaryFixed: '#d8e2ff',
  secondaryFixedDim: '#284777',

  // Tertiary
  tertiary: '#76231b',
  tertiaryContainer: '#ffdad6',
  onTertiary: '#ffffff',
  onTertiaryContainer: '#410002',

  // Text — neutral ink (no green tint)
  onBackground: '#111113',
  onSurface: '#111113',
  onSurfaceVariant: '#4A4A52',
  inverseOnSurface: '#F4F4F5',
  inverseSurface: '#111113',

  // UI. `outlineVariant` is the hairline around most cards — the old #D4D4D8 was
  // invisible against the near-white surfaces it was drawn on.
  outline: '#5F6068',
  outlineVariant: '#C7C9D1',
  surfaceTint: '#1a7a3c',
  scrim: '#000000',

  // Semantic errors
  error: '#b3261e',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#410002',

  // Status
  statusSuccess: '#1a7a3c',
  statusError: '#D32F2F',
  statusWarning: '#E65100',
  statusInfo: '#1565C0',

  // Service tier colors (absolute brand colors — same in both themes)
  tierEconomy: '#1a7a3c',
  tierComfort: '#1565C0',
  tierPremium: '#B8860B',
  tierRoyal: '#5B00CC',

  // Glows. Raised from 0.2: a 20% wash of a mid-green over WHITE is a barely
  // perceptible grey, where the same alpha over near-black in dark mode is an
  // obvious halo. Same visual weight needs a bigger number on this ground.
  glowPrimary: 'rgba(26, 122, 60, 0.3)',
  glowSecondary: 'rgba(40, 71, 119, 0.3)',
  glowError: 'rgba(179, 38, 30, 0.3)',

  /**
   * The "off" arc of a GradientGlowBorder sweep.
   *
   * BUGFIX ("the glow borders are overshot" in light mode). Every ring palette in
   * `RING_PALETTES` interleaves its live colours with #0A0A0C — near-black — as
   * the gap between the two arcs. That is invisible against a dark card and a
   * hard black band around a white one, which is the whole of the "overshot"
   * ring. The ring now reads this token for its gaps, so on a light card the gap
   * is the card.
   */
  ringGap: '#FFFFFF',

  // Premium glow accent
  premiumRingDark: '#F0F0F2',
  premiumBlue: '#1B5FE0',
  premiumBlueDim: '#0A45B8',
  premiumBlueBright: '#5C90F0',
  premiumOrange: '#E85F1C',
  premiumOrangeDim: '#C24800',
  premiumOrangeBright: '#FF9D5C',
} as const;

export type Colors = typeof darkColors;

export function useColors(): Colors {
  const isDark = useThemeStore((s) => s.isDark);
  return (isDark ? darkColors : lightColors) as Colors;
}
