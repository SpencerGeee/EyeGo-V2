import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Text, Button } from '@eyego/ui';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../utils/useColors';

interface SafetyCheckModalProps {
  visible: boolean;
  reason: 'route_deviation' | 'stopped_too_long' | 'unknown';
  tripId: string;
  onDismiss: () => void;
}

// Emoji icons replaced with Ionicons (vector) for crisp, themeable safety icons.
const REASON_CONFIG: Record<
  string,
  { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; title: string; subtitle: string }
> = {
  route_deviation: {
    icon: 'warning',
    color: '#F59E0B',
    title: 'Route Deviation Detected',
    subtitle: 'Your driver appears to have gone off the planned route. Are you OK?',
  },
  stopped_too_long: {
    icon: 'pause-circle',
    color: '#F59E0B',
    title: 'Driver Stopped Too Long',
    subtitle: 'Your driver has been stopped for a while without moving. Are you OK?',
  },
  unknown: {
    icon: 'shield-checkmark',
    color: '#4be277',
    title: 'Safety Check',
    subtitle: 'We noticed something unusual about your ride. Are you OK?',
  },
};

export default function SafetyCheckModal({ visible, reason, tripId, onDismiss }: SafetyCheckModalProps) {
  const colors = useColors();
  const router = useRouter();
  const config = REASON_CONFIG[reason] ?? REASON_CONFIG.unknown;

  const handleGetHelp = useCallback(() => {
    onDismiss();
    router.push(`/ride/${tripId}/sos` as Href);
  }, [tripId, router, onDismiss]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <MotiView
          from={{ opacity: 0, scale: 0.92, translateY: 20 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={[styles.card, { backgroundColor: colors.surfaceContainer }]}
        >
          <Ionicons name={config.icon} size={44} color={config.color} style={styles.icon} />
          <Text variant="titleLarge" style={styles.title}>{config.title}</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtitle}>
            {config.subtitle}
          </Text>

          <View style={styles.actions}>
            <Button
              label="I'm fine"
              variant="primary"
              onPress={onDismiss}
              style={{ flex: 1 }}
            />
            <Button
              label="Get help"
              variant="destructive"
              onPress={handleGetHelp}
              style={{ flex: 1 }}
            />
          </View>

          <Pressable onPress={onDismiss} hitSlop={12} style={styles.dismiss}>
            <Ionicons name="close" size={20} color={colors.onSurfaceVariant} />
          </Pressable>
        </MotiView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radii['2xl'],
    padding: spacing['2xl'],
    alignItems: 'center',
    gap: spacing.base,
    position: 'relative',
  },
  icon: {
    fontSize: 44,
    lineHeight: 52,
    marginBottom: spacing.xs,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  dismiss: {
    position: 'absolute',
    top: spacing.base,
    right: spacing.base,
  },
});
