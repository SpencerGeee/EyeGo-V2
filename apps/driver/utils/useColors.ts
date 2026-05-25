import { useDriverStore } from '../stores/driver.store';

export interface DriverColors {
  backgroundDeep: string;
  background: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  primary: string;
  primaryDim: string;
  onPrimary: string;
  accent: string;
  accentDim: string;
  secondary: string;
  secondaryContainer: string;
  onBackground: string;
  onSurface: string;
  onSurfaceVariant: string;
  inverseOnSurface: string;
  inverseSurface: string;
  outline: string;
  outlineVariant: string;
  scrim: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  online: string;
  offline: string;
  glowPrimary: string;
  glowAccent: string;
  glowError: string;
}

export const driverColors: DriverColors = {
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
};

export const driverLightColors: DriverColors = {
  backgroundDeep: '#E2E8F0',
  background: '#F1F5F9',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F8FAFC',
  surfaceContainerHighest: '#F1F5F9',
  primary: '#2563EB',
  primaryDim: '#1D4ED8',
  onPrimary: '#FFFFFF',
  accent: '#3B82F6',
  accentDim: '#2563EB',
  secondary: '#3B82F6',
  secondaryContainer: '#DBEAFE',
  onBackground: '#0F172A',
  onSurface: '#0F172A',
  onSurfaceVariant: '#64748B',
  inverseOnSurface: '#F1F5F9',
  inverseSurface: '#0F172A',
  outline: '#CBD5E1',
  outlineVariant: '#E2E8F0',
  scrim: '#000000',
  error: '#DC2626',
  onError: '#FFFFFF',
  errorContainer: '#FEF2F2',
  onErrorContainer: '#7F1D1D',
  online: '#2563EB',
  offline: '#94A3B8',
  glowPrimary: 'rgba(37, 99, 235, 0.25)',
  glowAccent: 'rgba(59, 130, 246, 0.15)',
  glowError: 'rgba(220, 38, 38, 0.25)',
};

export function useColors(): DriverColors {
  const theme = useDriverStore((s) => s.theme);
  return theme === 'light' ? driverLightColors : driverColors;
}
