import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';

export default function TripRequestScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { destination, scheduledAt } = useLocalSearchParams<{
    destination?: string;
    scheduledAt?: string;
  }>();

  const formattedTime = scheduledAt
    ? new Date(scheduledAt).toLocaleString('en-GH', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Back */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Pulsing ring animation */}
        <View style={styles.iconContainer}>
          {[0, 1, 2].map((i) => (
            <MotiView
              key={i}
              from={{ opacity: 0.4, scale: 0.8 }}
              animate={{ opacity: 0, scale: 1.8 }}
              transition={{
                type: 'timing',
                duration: 2000,
                delay: i * 600,
                loop: true,
              }}
              style={[styles.ring, { position: 'absolute' }]}
            />
          ))}
          <View style={styles.iconCircle}>
            <Ionicons name="bus-outline" size={32} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>Looking for a driver</Text>
        <Text style={styles.subtitle}>
          Your trip request to{' '}
          <Text style={styles.highlight}>{destination ?? 'your destination'}</Text>
          {formattedTime ? ` on ${formattedTime}` : ''} has been sent to nearby drivers.
        </Text>
        <Text style={styles.hint}>
          You'll get a notification as soon as a driver accepts and creates the trip.
        </Text>

        {/* Info card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
          <Text style={styles.infoText}>
            Trip requests are grouped — other riders heading the same way will be added automatically.
          </Text>
        </View>

        <Button
          label="Back to home"
          onPress={() => router.replace('/(tabs)/home' as any)}
          style={{ width: '100%', marginTop: spacing.xl }}
        />

        <Pressable
          style={styles.activityBtn}
          onPress={() => router.replace('/(tabs)/activity' as any)}
          accessibilityRole="button"
          accessibilityLabel="View in Activity"
        >
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textDecorationLine: 'underline' }}>
            View in Activity
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.backgroundDeep,
  },
  header: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.base,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    gap: spacing.lg,
  },
  iconContainer: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: `${colors.primary}50`,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${colors.primary}15`,
    borderWidth: 2,
    borderColor: `${colors.primary}40`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
    lineHeight: fontSizes.headlineMedium * 1.25,
    color: colors.onSurface,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
  },
  highlight: {
    fontFamily: fonts.semiBold,
    color: colors.primary,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.outline,
    textAlign: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginTop: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  activityBtn: {
    paddingVertical: spacing.md,
  },
});
