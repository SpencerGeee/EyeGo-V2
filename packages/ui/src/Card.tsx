import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { radii, spacing, withOpacity, type ColorTokens } from '@eyego/config';
import { useThemedColors } from './ColorsContext';
import { GradientGlowBorder, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS } from './effects/GradientGlowBorder';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  glow?: boolean;
  /** glow + animated = the premium rotating gradient ring instead of the
   * static border+shadow. Reserve for the single selected/active card in a
   * list — not every row (see effects/GradientGlowBorder perf notes). */
  animated?: boolean;
  selected?: boolean;
  padding?: number;
  /** Ring palette for the glow variant — match it to the card's accent
   * (e.g. 'gold' for the PREMIUM tier card). */
  glowPalette?: 'default' | 'gold' | 'royal' | 'economy' | 'comfort' | 'driver' | 'green' | 'brandGreen';
  /**
   * Multiplier on the ring's glow. 1 is the tuned default; below it the card is
   * present but clearly secondary, above it the card is the loudest on screen.
   *
   * This is how a set of cards can share one ring treatment and still be RANKED
   * — Economy quiet, Comfort brighter, Premium brightest — without three
   * different components. Passed straight through to GradientGlowBorder, which
   * clamps it.
   */
  glowIntensity?: number;
}

export function Card({
  children,
  style,
  elevated = false,
  glow = false,
  animated = false,
  selected = false,
  padding = spacing.base,
  glowPalette,
  glowIntensity,
}: CardProps) {
  const colors = useThemedColors();
  const styles = getStyles(colors);

  /**
   * ── A PALETTE IS A PALETTE WHETHER OR NOT THE RING TURNS ────────────────────
   *
   * BUGFIX ("on the services page, make the comfort card glow border blue — its
   * green is matching the economy, but they all have different tier colours").
   *
   * The palette only reached `GradientGlowBorder` on the `glow && animated`
   * branch. Every other glowing card fell through to the plain `View` below,
   * whose `styles.glow` paints `colors.primary` — the brand GREEN — into both
   * the border and the shadow. So the Services screen asked for three tier
   * colours and got two: gold on PREMIUM, which is animated, and the same green
   * on ECONOMY and COMFORT, which are not. The Comfort card was not "matching
   * economy" by accident; the two were rendering the identical hard-coded colour
   * and the palette prop was being dropped on the floor.
   *
   * `animated` now decides one thing only — whether the sweep ROTATES. A static
   * ring is `disabled`, which is exactly what GradientGlowBorder's own low-power
   * path renders, so a non-animated card gets its real colour at no extra cost.
   *
   * Without a palette the behaviour is unchanged: animated cards keep the
   * premium blue/orange sweep, plain ones keep the cheap bordered surface.
   */
  if (glow && (animated || glowPalette)) {
    return (
      <GradientGlowBorder
        {...(glowPalette
          ? { palette: glowPalette }
          : {
              colors: PREMIUM_RING_COLORS,
              locations: PREMIUM_RING_LOCATIONS,
              glowColor: colors.premiumBlue,
              glowColorSecondary: colors.premiumOrange,
            })}
        fillColor={elevated ? colors.surfaceContainerHigh : colors.surfaceCard}
        borderRadius={radii['2xl']}
        glow
        glowIntensity={glowIntensity}
        /**
         * A CARD'S HALO MUST FIT BETWEEN CARDS.
         *
         * Uncapped, the ring's widest pass reaches ~28 pt past the card (36 with
         * a secondary colour), and a `Card` is almost always one of a stacked
         * list. At any sane list gap that put every card's light under its
         * neighbour's opaque body — "the way the glow borders are stacked on each
         * other, it's not nice". 20 pt is the reach a 32 pt gap can hold, and
         * `glowIntensity` still scales the brightness independently.
         */
        maxGlowRadius={20}
        // Colour always; motion only when asked for.
        disabled={!animated}
        style={[{ padding }, style]}
      >
        {children}
      </GradientGlowBorder>
    );
  }

  return (
    <View
      style={[
        styles.base,
        elevated && styles.elevated,
        glow && styles.glow,
        selected && styles.selected,
        { padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    base: {
      backgroundColor: colors.surfaceCard,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    elevated: {
      backgroundColor: colors.surfaceContainerHigh,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
    glow: {
      borderColor: colors.primary,
      borderWidth: 1.5,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
    selected: {
      borderColor: colors.primary,
      borderWidth: 1.5,
      backgroundColor: withOpacity(colors.primary, 0.05),
    },
  });
}
