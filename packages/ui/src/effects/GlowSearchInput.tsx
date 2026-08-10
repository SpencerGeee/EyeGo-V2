import React, { useRef, type ReactNode } from 'react';
import {
  TextInput,
  type TextInputProps,
  View,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { radii, spacing, fonts, fontSizes } from '@eyego/config';
import { useThemedColors } from '../ColorsContext';
import { Pressable } from '../Pressable';
import {
  GradientGlowBorder,
  type GradientGlowBorderHandle,
  PREMIUM_RING_COLORS,
  PREMIUM_RING_LOCATIONS,
} from './GradientGlowBorder';

interface GlowSearchInputProps extends TextInputProps {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Real-TextInput variant of the premium glow search bar: a thin ambient-
 * rotating gradient ring (via GradientGlowBorder) with a soft glow, that
 * bursts brighter on focus — the RN equivalent of the web sample's
 * hover/focus reaction.
 */
export function GlowSearchInput({
  leftIcon,
  rightIcon,
  containerStyle,
  onFocus,
  onBlur,
  style,
  ...props
}: GlowSearchInputProps) {
  const colors = useThemedColors();
  const ringRef = useRef<GradientGlowBorderHandle>(null);

  return (
    <GradientGlowBorder
      ref={ringRef}
      colors={PREMIUM_RING_COLORS}
      locations={PREMIUM_RING_LOCATIONS}
      fillColor={colors.surfaceInput}
      borderRadius={radii['2xl']}
      thickness="thin"
      glow
      glowColor={colors.premiumBlue}
      glowColorSecondary={colors.premiumOrange}
      style={[styles.container, containerStyle]}
    >
      {leftIcon && <View style={styles.iconSlot}>{leftIcon}</View>}
      <TextInput
        style={[styles.input, { color: colors.onSurface }, style]}
        placeholderTextColor={colors.onSurfaceVariant}
        selectionColor={colors.primary}
        onFocus={(e) => {
          ringRef.current?.burst();
          onFocus?.(e);
        }}
        onBlur={onBlur}
        {...props}
      />
      {rightIcon && <View style={styles.iconSlot}>{rightIcon}</View>}
    </GradientGlowBorder>
  );
}

interface GlowSearchPressableProps {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /**
   * Ring/glow palette. Defaults to the blue+orange "premium" pair, which is
   * tuned for a near-black surround. Pass `'green'` on anything sitting over
   * the lit green home background — see below.
   */
  palette?: RingPalette;
  /** Glow strength multiplier, forwarded to GradientGlowBorder. */
  glowIntensity?: number;
  /** Caps the halo's reach so intensity can raise brightness alone — see GradientGlowBorder. */
  maxGlowRadius?: number;
}

type RingPalette =
  | 'default' | 'green' | 'brandGreen' | 'driver' | 'gold' | 'royal' | 'economy' | 'comfort';

/**
 * Fake-search-bar variant (navigates on press rather than accepting input) —
 * used for home.tsx's "Where to?" entry point.
 *
 * ── On the palette ───────────────────────────────────────────────────────────
 * "the glow is too faint and the colour clashes with the green background."
 *
 * Both halves of that are the same mistake. The default ring is blue with an
 * orange counter-arc, designed against near-black; over the home screen's green
 * it is simultaneously the wrong hue (blue and orange are the two things green
 * sits between, so the ring reads as dirty rather than as light) and invisible,
 * because a glow is only ever as bright as its contrast with what is behind it.
 * `RING_PALETTES.green` already existed for precisely this surround — it was
 * simply never pointed at the search bar.
 */
export function GlowSearchPressable({
  onPress,
  children,
  style,
  accessibilityLabel,
  palette = 'default',
  glowIntensity,
  maxGlowRadius,
}: GlowSearchPressableProps) {
  const colors = useThemedColors();
  const ringRef = useRef<GradientGlowBorderHandle>(null);
  const isDefault = palette === 'default';

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => ringRef.current?.burst()}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <GradientGlowBorder
        ref={ringRef}
        palette={palette}
        // The explicit props win over a palette, so only pass them when there
        // is no palette to honour — otherwise `palette="green"` would keep the
        // blue ring it was chosen to replace.
        colors={isDefault ? PREMIUM_RING_COLORS : undefined}
        locations={isDefault ? PREMIUM_RING_LOCATIONS : undefined}
        glowColor={isDefault ? colors.premiumBlue : undefined}
        glowColorSecondary={isDefault ? colors.premiumOrange : undefined}
        fillColor={colors.surfaceInput}
        borderRadius={radii['2xl']}
        thickness="thin"
        glow
        glowIntensity={glowIntensity}
        maxGlowRadius={maxGlowRadius}
        style={[styles.container, style]}
      >
        {children}
      </GradientGlowBorder>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    minHeight: 56,
    gap: spacing.sm,
  },
  iconSlot: {
    marginHorizontal: spacing.xs,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLarge,
    paddingVertical: 0,
  },
});
