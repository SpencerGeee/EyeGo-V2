import React, { useEffect } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  RadialGradient,
  Stop,
  Path,
  Text as SvgText,
  TextPath,
} from 'react-native-svg';
import { fonts } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

interface LoaderProps {
  /** Contextual label, e.g. "Finding your driver…" or "Processing payment…". */
  label: string;
  size?: number;
  style?: ViewStyle;
}

/**
 * Premium full-screen/blocking-wait loader: a "blackhole" radial-gradient
 * disc with a pulsing glow, and the label following a curved SVG path
 * around it — both rotate/pulse continuously via worklet-driven Reanimated,
 * never JS state. Reserved for genuinely blocking waits (ride matching,
 * payment processing, splash); inline spinners stay ActivityIndicator.
 */
export function Loader({ label, size = 128, style }: LoaderProps) {
  const colors = useThemedColors();
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 9000, easing: Easing.linear }),
      -1,
      false
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [rotation, pulse]);

  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.25,
    transform: [{ scale: 1 + pulse.value * 0.06 }],
  }));

  const cx = size / 2;
  const cy = size / 2;
  const arcRadius = size * 0.62;
  const arcPath = `M ${cx - arcRadius} ${cy} A ${arcRadius} ${arcRadius} 0 0 1 ${cx + arcRadius} ${cy}`;
  const glowSize = size * 1.3;

  return (
    <View style={[styles.container, { width: size * 1.9, height: size * 1.9 }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            width: glowSize,
            height: glowSize,
            borderRadius: glowSize / 2,
            backgroundColor: colors.primary,
            shadowColor: colors.primary,
          },
          glowStyle,
        ]}
      />
      <Animated.View style={rotateStyle}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <RadialGradient id="loaderDisc" cx="50%" cy="50%" r="60%">
              <Stop offset="0%" stopColor={colors.backgroundDeep} stopOpacity={1} />
              <Stop offset="65%" stopColor={colors.primary} stopOpacity={0.35} />
              <Stop offset="100%" stopColor={colors.backgroundDeep} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={size * 0.4} fill="url(#loaderDisc)" />
          <Circle
            cx={cx}
            cy={cy}
            r={size * 0.4}
            stroke={colors.rimLight}
            strokeWidth={1}
            fill="none"
          />
          <Path id="loaderArc" d={arcPath} fill="none" />
          <SvgText
            fill={colors.onSurfaceVariant}
            fontSize={size * 0.09}
            fontFamily={fonts.labelCaps}
            letterSpacing={2}
          >
            <TextPath href="#loaderArc" startOffset="50%" textAnchor="middle">
              {label.toUpperCase()}
            </TextPath>
          </SvgText>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
  },
});
