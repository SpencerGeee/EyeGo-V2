import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from './Pressable';
import { colors, spacing, radii } from '@eyego/config';
import { Text } from './Text';
import { Avatar } from './Avatar';

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
}

export function DriverInfoCard({ driver, vehicle, showActions = false, onCall, onChat }: DriverInfoCardProps) {
  return (
    <View style={styles.card}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: spacing.md,
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
    borderColor: 'rgba(255,255,255,0.10)',
  },
});
