import * as Haptics from 'expo-haptics';

export const haptic = {
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  heavy:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  medium:  () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  light:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  select:  () => Haptics.selectionAsync(),
  /** Double medium pulse — used when driver arrives < 500 m */
  driverArrived: () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 280);
  },
};
