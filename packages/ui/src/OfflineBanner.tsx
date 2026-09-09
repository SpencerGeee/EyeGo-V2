import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, springs } from '@eyego/config';
import { Text } from './Text';

/**
 * ── THE APP KNEW IT WAS OFFLINE AND SAID NOTHING ────────────────────────────
 *
 * Four screens out of ninety-three reacted to connectivity. The rider's root
 * layout has tracked `isOffline` off a NetInfo subscription for a long time and
 * never rendered it anywhere — the state was written and read by nobody.
 *
 * So a rider in a basement car park, a tunnel, or anywhere in a moving vehicle
 * with patchy coverage saw requests fail with no explanation, and every failure
 * read as "this app is broken" rather than "you have no signal". Those need
 * different reactions from the user, and only one of them is actionable.
 *
 * ONE instance, at the root of each app, above everything. It is deliberately
 * not a toast: a toast says something happened, and this is a CONDITION that
 * persists until it does not. It stays until connectivity returns, then leaves
 * on its own.
 *
 * Pairs with `QueryBoundary`, which uses the same signal to say "You're
 * offline" instead of blaming the server for a failure the network caused.
 */
export interface OfflineBannerProps {
  offline: boolean;
  /** Copy override, for an app with a better word than "You're offline". */
  label?: string;
}

const HEIGHT = 34;

export function OfflineBanner({ offline, label = "You're offline" }: OfflineBannerProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const shown = useSharedValue(0);

  useEffect(() => {
    /**
     * A spring in, a timing out. Arriving is an event worth a little life;
     * leaving is housekeeping and should not draw the eye back to a problem
     * that has just been solved.
     */
    if (reducedMotion) {
      shown.value = offline ? 1 : 0;
    } else {
      shown.value = offline
        ? withSpring(1, springs.standard)
        : withTiming(0, { duration: 180 });
    }
    // A `withSpring` left running past unmount is a UI-thread frame callback
    // nobody owns — the rule the motion harness enforces.
    return () => cancelAnimation(shown);
  }, [offline, reducedMotion, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * -(HEIGHT + 8) }],
  }));

  // Unmounted entirely when online: an invisible absolute layer over the whole
  // app is still a hit-test candidate, and this one sits over the header.
  if (!offline) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel={label}
      style={[styles.wrap, { top: insets.top + spacing.sm }, style]}
    >
      <View style={styles.pill}>
        <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Above app chrome, below the notice host so a toast can still be read.
    zIndex: 900,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: HEIGHT,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    // Fixed rather than themed: this is a system condition, and it must read
    // the same in both themes and over a map, a shader or a white sheet.
    backgroundColor: 'rgba(20,20,22,0.92)',
  },
  label: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: '#fff' },
});
