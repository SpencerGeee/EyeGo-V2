import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
  type LayoutChangeEvent,
} from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  cancelAnimation,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { staticLoopingLayerProps } from './effects/hardwareTexture';
import { useLoopsActive } from './effects/useLoopsActive';
import { Text } from './Text';
import { useThemedColors } from './ColorsContext';

interface ShinyTextProps {
  children: string;
  textStyle?: TextStyle | TextStyle[];
  style?: ViewStyle;
  /** Highlight color sweeping across the text. Defaults to white. */
  shineColor?: string;
  /** Resting text color. Defaults to the theme's onSurface. */
  baseColor?: string;
  speedMs?: number;
}

/**
 * A masked-gradient shine sweep across text — the RN equivalent of the web
 * sample's CSS background-clip:text animation (not supported natively).
 * Reserved for a handful of hero moments (tier badges, wordmarks, hero fare
 * numbers) — not for body copy or list rows, per the curated scope.
 */
export function ShinyText({
  children,
  textStyle,
  style,
  shineColor = '#FFFFFF',
  baseColor,
  speedMs = 2600,
}: ShinyTextProps) {
  const colors = useThemedColors();
  const base = baseColor ?? colors.onSurface;
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(0);

  const loopsActive = useLoopsActive();

  useEffect(() => {
    // A shimmer on a tab the user left is a shimmer nobody sees, running for
    // the rest of the session — see useLoopsActive.
    if (!loopsActive) {
      cancelAnimation(sweep);
      return;
    }
    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: speedMs, easing: Easing.linear }),
      -1,
      false
    );
    // An infinite repeat survives unmount unless cancelled — see AppBackground.
    return () => cancelAnimation(sweep);
  }, [sweep, speedMs, loopsActive]);

  const bandWidth = Math.max(width * 0.6, 60);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -bandWidth + sweep.value * (width + bandWidth * 2) }],
  }));

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== width) setWidth(w);
  };

  return (
    <View style={style} onLayout={handleLayout}>
      <MaskedView maskElement={<Text style={textStyle}>{children}</Text>}>
        <Text style={[textStyle, { opacity: 0 }]}>{children}</Text>
        <View style={[StyleSheet.absoluteFillObject, styles.clip]}>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: base }]} />
          {/* A gradient band sweeping forever across fixed text — static pixels
              under a pure transform, so both platforms cache it. */}
          {width > 0 && (
            <Animated.View
              {...staticLoopingLayerProps}
              style={[styles.band, { width: bandWidth }, sweepStyle]}
            >
              <LinearGradient
                colors={['transparent', shineColor, 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>
          )}
        </View>
      </MaskedView>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
