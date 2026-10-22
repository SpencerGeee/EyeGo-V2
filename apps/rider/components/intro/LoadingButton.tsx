import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fonts, fontSizes } from '@eyego/config';
import { Text } from '@eyego/ui';

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

const H = 54;

/**
 * The submit button that BECOMES the progress: the label fades (120 ms), the
 * pill draws in to a circle (320 ms, soft ease), a ring spins inside it. On
 * success the circle fills and a check lands; on failure it springs back to
 * full width and the caller shakes the form. Double taps are ignored while it
 * is anything but idle.
 */
export function LoadingButton({
  label,
  onPress,
  state,
  disabled,
  color,
  onColor,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  state: LoadingState;
  disabled?: boolean;
  color: string;
  onColor: string;
  accessibilityLabel?: string;
}) {
  const [w, setW] = useState(0);
  const k = useSharedValue(0); // 0 = pill, 1 = circle
  const done = useSharedValue(0);
  const press = useSharedValue(1);

  useEffect(() => {
    const ease = Easing.bezier(0.22, 1, 0.36, 1);
    if (state === 'loading') {
      k.value = withTiming(1, { duration: 320, easing: ease });
      done.value = 0;
    } else if (state === 'success') {
      k.value = withTiming(1, { duration: 200, easing: ease });
      done.value = withTiming(1, { duration: 300, easing: ease });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      done.value = 0;
      k.value = withSpring(0, { stiffness: 260, damping: 26, mass: 1 });
      if (state === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [state, k, done]);

  const boxStyle = useAnimatedStyle(() => ({
    width: w > 0 ? interpolate(k.value, [0, 1], [w, H]) : '100%',
    transform: [{ scale: press.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: interpolate(k.value, [0, 0.35], [1, 0], 'clamp') }));
  const spinStyle = useAnimatedStyle(() => ({ opacity: interpolate(k.value, [0.6, 1], [0, 1], 'clamp') * (1 - done.value) }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: done.value, transform: [{ scale: 0.5 + done.value * 0.5 }] }));

  const busy = state === 'loading' || state === 'success';
  const off = disabled && !busy;
  return (
    <View style={styles.row} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Pressable
        onPress={() => {
          if (busy || off) return;
          press.value = withSequence(withTiming(0.97, { duration: 90 }), withSpring(1, { stiffness: 400, damping: 30, mass: 1 }));
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }}
        disabled={busy || off}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !!off, busy }}
      >
        <Animated.View style={[styles.box, { backgroundColor: off ? `${color}55` : color }, boxStyle]}>
          <Animated.View style={labelStyle}>
            <Text style={[styles.label, { color: onColor }]} numberOfLines={1}>{label}</Text>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, spinStyle]} pointerEvents="none">
            <ActivityIndicator color={onColor} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, checkStyle]} pointerEvents="none">
            <Ionicons name="checkmark" size={26} color={onColor} />
          </Animated.View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%', alignItems: 'center' },
  box: { height: H, borderRadius: H / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', alignSelf: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge },
});
