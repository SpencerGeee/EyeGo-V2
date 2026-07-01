import { useThemeStore } from '../stores/theme.store';

export const darkColors = {
  // Backgrounds — Onyx neutral darks with subtle green environmental tint
  backgroundDeep: '#0A0A0B',
  background: '#0d150d',
  surfaceDim: '#0d150d',
  surfaceCard: '#161618',
  surfaceContainer: '#192122',
  surfaceContainerHigh: '#232b2c',
  surfaceContainerHighest: '#2e3637',
  surfaceVariant: '#2e3637',
  surfaceBright: '#333b3b',

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
} as const;

export const lightColors = {
  // Backgrounds
  backgroundDeep: '#f4fbf4',
  background: '#edf5ec',
  surfaceDim: '#edf5ec',
  surfaceCard: '#f0f8f0',
  surfaceContainer: '#e1ebe0',
  surfaceContainerHigh: '#d5e3d4',
  surfaceContainerHighest: '#c9d8c8',
  surfaceVariant: '#c9d8c8',
  surfaceBright: '#e4efe4',

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

  // Text
  onBackground: '#0d1f0d',
  onSurface: '#0d1f0d',
  onSurfaceVariant: '#3d4d3c',
  inverseOnSurface: '#dce4e5',
  inverseSurface: '#0d1f0d',

  // UI
  outline: '#607860',
  outlineVariant: '#b5c8b4',
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

  // Glows
  glowPrimary: 'rgba(26, 122, 60, 0.2)',
  glowSecondary: 'rgba(40, 71, 119, 0.2)',
  glowError: 'rgba(179, 38, 30, 0.2)',
} as const;

export type Colors = typeof darkColors;

export function useColors(): Colors {
  const isDark = useThemeStore((s) => s.isDark);
  return (isDark ? darkColors : lightColors) as Colors;
}
