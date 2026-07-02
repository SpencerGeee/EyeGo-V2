import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from './Pressable';
import { spacing, radii, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useThemedColors } from './ColorsContext';
import { GradientGlowBorder } from './effects/GradientGlowBorder';
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
  /** Animated gradient ring + glow + a drifting glass-lens sheen — the
   * "hero" treatment for the matched-driver moment. Keep off for repeated
   * list rows (perf: see effects/GradientGlowBorder). */
  premium?: boolean;
}

export function DriverInfoCard({ driver, vehicle, showActions = false, onCall, onChat, premium = false }: DriverInfoCardProps) {
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
            </Pressable>
          )}
        </View>
      )}
    </>
  );

  if (premium) {
    return (
      <GradientGlowBorder
        colors={[colors.primary, colors.secondary]}
        fillColor={colors.surfaceCard}
        borderRadius={radii.xl}
        glow
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
  });
}
