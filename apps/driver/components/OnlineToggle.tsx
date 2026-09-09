import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, usePressScale, Loader } from '@eyego/ui';
import { useColors } from '../utils/useColors';

interface Props {
  isOnline: boolean;
  loading?: boolean;
  onToggle: () => void;
}

export function OnlineToggle({ isOnline, loading, onToggle }: Props) {
  const driverColors = useColors();
  const press = usePressScale({ disabled: loading });
  const animStyle = press.style;

  return (
    <Pressable
      /**
       * The driver's most consequential control, and it carried no
       * accessibility label at all — a screen reader announced it as "button"
       * and nothing else. `switch` with a checked state is what it actually is.
       *
       * The testID is what lets an E2E flow drive it without depending on copy:
       * this label changes with state, and a flow matching "Go online" would
       * break the moment the driver is already online.
       */
      testID="driver-online-toggle"
      accessibilityRole="switch"
      accessibilityState={{ checked: isOnline, disabled: !!loading }}
      accessibilityLabel={isOnline ? 'Go offline' : 'Go online'}
      onPress={onToggle}
      {...press.handlers}
      disabled={loading}
    >
      <Animated.View style={[
        styles.pill,
        { backgroundColor: isOnline ? `${driverColors.online}22` : `${driverColors.offline}22` },
        { borderColor: isOnline ? `${driverColors.online}66` : `${driverColors.offline}66` },
        animStyle,
      ]}>
        {loading ? (
          <Loader size={12} color={isOnline ? driverColors.online : driverColors.offline} />
        ) : (
          <View style={[styles.dot, { backgroundColor: isOnline ? driverColors.online : driverColors.offline }]} />
        )}
        <Text style={[styles.label, { color: isOnline ? driverColors.online : driverColors.onSurfaceVariant }]}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    lineHeight: Math.round(11 * 1.3),
    letterSpacing: 0.8,
  },
});
