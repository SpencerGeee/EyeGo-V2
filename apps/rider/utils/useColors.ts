import { useThemeStore } from '../stores/theme.store';

export const darkColors = {
  // Backgrounds
  backgroundDeep: '#091009',
  background: '#0e150e',
  surfaceContainer: '#1a221a',
  surfaceContainerHigh: '#242c24',
  surfaceContainerHighest: '#2f372e',

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

  // Text
  onBackground: '#dce5d9',
  onSurface: '#dce5d9',
  onSurfaceVariant: '#bccbb9',
  inverseOnSurface: '#2a322a',
  inverseSurface: '#dce5d9',

  // UI
  outline: '#869585',
  outlineVariant: '#3d4b3c',
  surfaceTint: '#4ae176',
  scrim: '#000000',

  // Semantic
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',

  // Glows
  glowPrimary: 'rgba(75, 226, 119, 0.4)',
  glowSecondary: 'rgba(5, 102, 217, 0.4)',
  glowError: 'rgba(255, 180, 171, 0.4)',
} as const;

export const lightColors = {
  // Backgrounds
  backgroundDeep: '#f4fbf4',
  background: '#edf5ec',
  surfaceContainer: '#e1ebe0',
  surfaceContainerHigh: '#d5e3d4',
  surfaceContainerHighest: '#c9d8c8',

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
  inverseOnSurface: '#dce5d9',
  inverseSurface: '#0d1f0d',

  // UI
  outline: '#607860',
  outlineVariant: '#b5c8b4',
  surfaceTint: '#1a7a3c',
  scrim: '#000000',

  // Semantic
  error: '#b3261e',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#410002',

  // Glows
  glowPrimary: 'rgba(26, 122, 60, 0.2)',
  glowSecondary: 'rgba(40, 71, 119, 0.2)',
  glowError: 'rgba(179, 38, 30, 0.2)',
} as const;

export type Colors = typeof darkColors;

export function useColors(): Colors {
  const isDark = useThemeStore((s) => s.isDark);
  return isDark ? darkColors : lightColors;
}
