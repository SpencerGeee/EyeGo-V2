import { driverColors, driverLightColors, type DriverColorTokens } from '@eyego/config';
import { useDriverStore } from '../stores/driver.store';

export type DriverColors = DriverColorTokens;
export { driverColors, driverLightColors };

export function useColors(): DriverColors {
  const theme = useDriverStore((s) => s.theme);
  return theme === 'light' ? driverLightColors : driverColors;
}
