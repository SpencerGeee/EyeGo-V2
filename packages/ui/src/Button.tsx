import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { ShinyText } from './ShinyText';
import { LottieMoment } from './motion/LottieMoment';
import { RING_PALETTES } from './effects/GradientGlowBorder';
import { radii, spacing, fonts, fontSizes, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'glow';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  fullWidth?: boolean;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  /** variant="glow" only — overrides the default green/blue ring sweep.
   * e.g. [colors.tertiary, colors.statusError] for a SOS/urgent CTA. */
  glowColors?: readonly [string, string, ...string[]];
  /** variant="glow" only — a named ring palette (`'gold'`, `'comfort'`, …).
   * Lower precedence than `glowColors`. Use this to make a CTA carry the tier
   * the rider just picked rather than the generic blue/orange premium sweep. */
  palette?: keyof typeof RING_PALETTES;
  /**
   * Sweeps a shine across the label. The step CTA in the rider's book-a-ride
   * flow is a hero moment and read flat and generic without it ("no shiny
   * text"). Kept opt-in — a masked gradient per button is not free, and body
   * buttons should stay plain.
   */
  shiny?: boolean;
  /** `shiny` only — the resting label colour under the sweep. */
  shinyBaseColor?: string;
}

function getVariantStyles(colors: ColorTokens): Record<ButtonVariant, { container: ViewStyle; textColor: string }> {
  return {
    primary: {
      container: {
        backgroundColor: colors.primary,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
      },
      textColor: colors.onPrimary,
    },
    secondary: {
      container: {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.primary,
      },
      textColor: colors.primary,
    },
    ghost: {
      container: {
        backgroundColor: 'transparent',
      },
      textColor: colors.onSurface,
    },
    destructive: {
      container: {
        backgroundColor: colors.statusError,
      },
      textColor: '#FFFFFF',
    },
    glow: {
      // Filled at the call's accent below — see `isGlow`.
      container: {
        backgroundColor: 'transparent',
      },
      textColor: colors.onSurface,
    },
  };
}

// `lineHeight` travels with `fontSize`, always. Geist's ascenders clip against
// an implicit line box on iOS, which is the "top of the text is cut off" the
// driver app's forms showed — a button label is no different.
const sizeStyles: Record<ButtonSize, { container: ViewStyle; fontSize: number; lineHeight: number }> = {
  sm: {
    container: { paddingVertical: spacing.sm, paddingHorizontal: spacing.base, minHeight: 44 },
    fontSize: fontSizes.label,
    lineHeight: Math.round(fontSizes.label * 1.3),
  },
  md: {
    container: { paddingVertical: 14, paddingHorizontal: spacing.xl, minHeight: 52 },
    fontSize: fontSizes.titleSmall,
    lineHeight: Math.round(fontSizes.titleSmall * 1.3),
  },
  lg: {
    container: { paddingVertical: spacing.base, paddingHorizontal: spacing['2xl'], minHeight: 52 },
    fontSize: fontSizes.titleMedium,
    lineHeight: Math.round(fontSizes.titleMedium * 1.3),
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  style,
  fullWidth = true,
  icon,
  glowColors,
  palette,
  shiny = false,
  shinyBaseColor,
}: ButtonProps) {
  const colors = useThemedColors();
  const vStyle = getVariantStyles(colors)[variant];
  const sStyle = sizeStyles[size];
  const isDisabled = disabled || loading;
  const isGlow = variant === 'glow';

  const resolvedStyle: ViewStyle[] = [styles.base, vStyle.container, sStyle.container];
  if (fullWidth) resolvedStyle.push(styles.fullWidth);
  if (isDisabled) resolvedStyle.push(styles.disabled);
  if (style) {
    if (Array.isArray(style)) resolvedStyle.push(...style);
    else resolvedStyle.push(style);
  }

  const labelStyle = {
    fontFamily: fonts.semiBold,
    fontSize: sStyle.fontSize,
    lineHeight: sStyle.lineHeight,
    color: vStyle.textColor,
  };

  const content = loading ? (
    // Three dots rising in a wave (Lottie "loading"), sized to the label's line
    // box so a busy button keeps its height.
    <LottieMoment name="loading" size={sStyle.lineHeight * 2} color={vStyle.textColor} style={{ marginVertical: -sStyle.lineHeight / 2 }} />
  ) : (
    <>
      {icon}
      {shiny ? (
        <ShinyText
          baseColor={shinyBaseColor ?? vStyle.textColor}
          textStyle={labelStyle}
          singleLine
        >
          {label}
        </ShinyText>
      ) : (
        /* ONE LINE, ALWAYS. A label that wraps doubles the button's height and
           reads as a slab ("Accept changes" on two lines). It shrinks a little
           to fit instead — and a label that still cannot fit is too long. */
        <Text style={labelStyle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {label}
        </Text>
      )}
    </>
  );

  /**
   * THE HERO CTA IS SOLID (device recording 2026-10-30: "the card system is bad
   * compared to Uber"). It used to be a dark pill inside an animated gradient
   * ring with a coloured halo and grey text — the loudest object on every
   * booking screen, and the one that least looked like a button. Uber, Bolt and
   * Yango all close a flow on a flat, filled, high-contrast button. Same
   * variant name, so every caller's accent (tier palette, explicit colours) is
   * kept — it is now the FILL, under near-black text.
   */
  if (isGlow) {
    const fill = glowColors?.[0] ?? (palette ? RING_PALETTES[palette].glowColor : colors.primary);
    const ink = '#0A0A0C';
    const solidLabel = { ...labelStyle, color: ink };
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        haptic="medium"
        style={[...resolvedStyle, { backgroundColor: fill, shadowColor: fill, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 }]}
      >
        {loading ? (
          <LottieMoment name="loading" size={sStyle.lineHeight * 2} color={ink} style={{ marginVertical: -sStyle.lineHeight / 2 }} />
        ) : (
          <>
            {icon}
            <Text style={solidLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {label}
            </Text>
          </>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      haptic="medium"
      style={resolvedStyle}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    gap: spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.45,
  },
});
