import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useToastStore, type ToastType } from '../stores/toast.store';
import { Text } from '@eyego/ui';
import { spacing, radii, springs, durations } from '@eyego/config';

const CONFIG: Record<ToastType, { bg: string; iconColor: string; name: React.ComponentProps<typeof Ionicons>['name'] }> = {
  success: { bg: '#0f2e14', iconColor: '#4be277', name: 'checkmark-circle' },
  error:   { bg: '#2e0f0f', iconColor: '#ff6b6b', name: 'alert-circle'     },
  warning: { bg: '#2e220f', iconColor: '#ffb347', name: 'warning'           },
  info:    { bg: '#0f1e2e', iconColor: '#7dd8f5', name: 'information-circle'},
};

export function GlobalToast() {
  const { visible, message, type, hide } = useToastStore();
  const insets = useSafeAreaInsets();
  /**
   * Migrated off the legacy `Animated` API to Reanimated.
   *
   * Both ran on the native thread, so this is not a frame-rate fix — it is a
   * consistency one. Every other moving surface in this app is a shared value
   * driven by the `springs` tokens, and a toast that arrives on a hand-written
   * spring while the sheet beside it uses `springs.standard` reads as two
   * different products. The exit stays a timing curve on purpose: a dismissal
   * should leave immediately, and a spring on the way out looks like hesitation.
   */
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, springs.standard);
      opacity.value = withTiming(1, { duration: durations.fast });
    } else {
      translateY.value = withTiming(-120, { duration: durations.base });
      opacity.value = withTiming(0, { duration: durations.fast });
    }
  }, [visible, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const { bg, iconColor, name } = CONFIG[type];

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.container, { top: insets.top + 8, backgroundColor: bg }, animatedStyle]}
    >
      <Ionicons name={name} size={20} color={iconColor} />
      <Text variant="bodySmall" style={[styles.message]}>{message}</Text>
      <Pressable onPress={hide} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Ionicons name="close" size={18} color="rgba(255,255,255,0.45)" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg ?? 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  message: {
    flex: 1,
    color: '#fff',
  },
});
