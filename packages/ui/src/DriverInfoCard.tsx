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
      <GradientGlowBorder
        colors={PREMIUM_RING_COLORS}
        locations={PREMIUM_RING_LOCATIONS}
        fillColor={colors.surfaceCard}
        borderRadius={radii.xl}
        glow
        glowColor={colors.premiumBlue}
        glowColorSecondary={colors.premiumOrange}
        style={styles.cardLayout}
      >
        <LensSheen />
        {content}
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
