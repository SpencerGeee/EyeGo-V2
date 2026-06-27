import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';

const PRIMARY = '#4be277';

export default function TripRequestScreen() {
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
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
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
            <Ionicons name="bus-outline" size={32} color={PRIMARY} />
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
          <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.4)" />
          <Text style={styles.infoText}>
            Trip requests are grouped — other riders heading the same way will be added automatically.
          </Text>
        </View>

        <Pressable
          style={styles.doneBtn}
          onPress={() => router.replace('/(tabs)/home' as any)}
        >
          <Text style={styles.doneBtnText}>Back to home</Text>
        </Pressable>

        <Pressable
          style={styles.activityBtn}
          onPress={() => router.replace('/(tabs)/activity' as any)}
        >
          <Text style={styles.activityBtnText}>View in Activity</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#091009',
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    borderColor: `${PRIMARY}50`,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${PRIMARY}15`,
    borderWidth: 2,
    borderColor: `${PRIMARY}40`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 22,
  },
  highlight: {
    fontFamily: fonts.semiBold,
    color: PRIMARY,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginTop: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 18,
  },
  doneBtn: {
    width: '100%',
    height: 52,
    borderRadius: 26,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  doneBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: '#091009',
  },
  activityBtn: {
    paddingVertical: spacing.md,
  },
  activityBtnText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.4)',
    textDecorationLine: 'underline',
  },
});
