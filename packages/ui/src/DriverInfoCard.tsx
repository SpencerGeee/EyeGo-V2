import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from './Pressable';
import { spacing, radii, fonts, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useThemedColors } from './ColorsContext';
import { GradientGlowBorder, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS } from './effects/GradientGlowBorder';
import { LensSheen } from './effects/LensSheen';

interface TripDriver {
  id?: string;
  name?: string;
  avatarUrl?: string | null;
  rating?: number;
  phone?: string;
}

interface Vehicle {
  plate?: string;
  make?: string;
  model?: string;
  color?: string;
}

interface DriverInfoCardProps {
  driver: TripDriver;
  vehicle?: Vehicle;
  showActions?: boolean;
  onCall?: () => void;
  onChat?: () => void;
  /** Unread messages from the driver. Renders a badge on the chat button;
   *  0 or undefined renders nothing. */
  unreadChats?: number;
  /** Animated gradient ring + glow + a drifting glass-lens sheen — the
   * "hero" treatment for the matched-driver moment. Keep off for repeated
   * list rows (perf: see effects/GradientGlowBorder). */
  premium?: boolean;
}

export function DriverInfoCard({ driver, vehicle, showActions = false, onCall, onChat, unreadChats = 0, premium = false }: DriverInfoCardProps) {
  const colors = useThemedColors();
  const styles = getStyles(colors);

  const content = (
    <>
      <Avatar uri={driver.avatarUrl} name={driver.name} size={48} borderColor={colors.primary} />

      <View style={styles.info}>
        <Text variant="titleSmall">{driver.name ?? 'Your Driver'}</Text>
        <Text variant="bodySmall" color={colors.onSurfaceVariant}>
          ★ {driver.rating?.toFixed(1) ?? '—'}
          {vehicle?.plate ? ` · ${vehicle.plate}` : ''}
        </Text>
        {(vehicle?.make || vehicle?.model) ? (
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {[vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
          </Text>
        ) : null}
      </View>

      {showActions && (
        <View style={styles.actions}>
          {onCall && (
            <Pressable style={styles.actionBtn} onPress={onCall} haptic="light">
              <Ionicons name="call-outline" size={18} color={colors.primary} />
            </Pressable>
          )}
          {onChat && (
            <Pressable style={styles.actionBtn} onPress={onChat} haptic="light">
              <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
              {unreadChats > 0 && (
                <View style={[styles.chatBadge, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.chatBadgeText, { color: colors.onPrimary }]}>
                    {unreadChats > 9 ? '9+' : unreadChats}
                  </Text>
                </View>
              )}
            </Pressable>
          )}
        </View>
      )}
    </>
  );

  if (premium) {
    return (
      /**
       * BUGFIX ("when it moves to 'Your driver is here' there's a visible cut
       * out on the left and right of the card which clips stuff").
       *
       * `premium` turns on exactly at ARRIVED_AT_PICKUP, which is why the seams
       * appeared at that moment and not before. The cause is the one React
       * Native trap this codebase has now hit twice (see the note on `background`
       * in the rider's TripSheetHost): an `absoluteFill` child is laid out
       * against its parent's PADDING box, not its border box. `LensSheen` is an
       * absoluteFill with `overflow: 'hidden'`, and it used to sit directly
       * inside this card's content box, which carries `padding: spacing.base`.
       * So its clip rectangle was inset 16pt from every edge and the sweeping
       * highlight stopped dead at two hard vertical lines 16pt in from the left
       * and right — a bright band that visibly cuts off, over and over, as it
       * sweeps.
       *
       * The padding now lives on an inner wrapper, so the sheen fills the whole
       * card and is clipped only by the card's own rounded corners.
       *
       * `maxGlowRadius` is capped for the neighbouring half of the same report
       * ("the cut out seems to affect the glow borders"): this glow was
       * uncapped at a 28pt shadow radius, and the sheet it sits in clips at a
       * 32pt gutter, so the outer halo reached the clip edge and was sliced off
       * square. 18 keeps the whole falloff inside the gutter.
       */
      <GradientGlowBorder
        colors={PREMIUM_RING_COLORS}
        locations={PREMIUM_RING_LOCATIONS}
        fillColor={colors.surfaceCard}
        borderRadius={radii.xl}
        glow
        maxGlowRadius={18}
        glowColor={colors.premiumBlue}
        glowColorSecondary={colors.premiumOrange}
        style={styles.cardShell}
      >
        <LensSheen />
        <View style={styles.cardPadding}>{content}</View>
      </GradientGlowBorder>
    );
  }

  return <View style={[styles.cardLayout, styles.cardChrome]}>{content}</View>;
}

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    cardLayout: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radii.xl,
      padding: spacing.base,
      gap: spacing.md,
    },
    /**
     * The premium card, split in two: the shell carries shape only, and the
     * padding moves inside. Anything absolutely positioned against the shell —
     * `LensSheen` above all — then covers the whole card rather than a rectangle
     * inset by the padding. See the note in the `premium` branch.
     */
    cardShell: {
      borderRadius: radii.xl,
    },
    cardPadding: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.base,
      gap: spacing.md,
    },
    cardChrome: {
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    info: { flex: 1 },
    actions: { flexDirection: 'row', gap: spacing.sm },
    actionBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    chatBadge: {
      position: 'absolute',
      top: -2,
      right: -2,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.surfaceContainerHigh,
    },
    chatBadgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: Math.round(10 * 1.3),
    },
  });
}
