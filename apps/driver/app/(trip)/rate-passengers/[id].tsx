import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, type DriverColors } from '../../../utils/useColors';

const COMPLIMENTS = [
  { label: 'Polite', icon: 'hand-left-outline' },
  { label: 'On Time', icon: 'time-outline' },
  { label: 'Quiet', icon: 'ear-outline' },
  { label: 'Helpful', icon: 'heart-outline' },
  { label: 'Clean', icon: 'sparkles-outline' },
  { label: 'Courteous', icon: 'people-outline' },
];

const STAR_MESSAGES = ['', 'Needs improvement', 'Fair passenger', 'Good', 'Great', 'Excellent passenger!'];

export default function RatePassengersScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: tripData } = useQuery({
    queryKey: ['driver', 'trip', id],
    queryFn: () => driverApi.getTripById(id),
    select: (r) => (r.data as any)?.data?.trip ?? null,
    enabled: !!id,
  });

  const passengers = useMemo(() => {
    const bookings: any[] = (tripData as any)?.bookings ?? [];
    return bookings
      .filter((b: any) => b.status !== 'CANCELLED' && b.user?.id)
      .map((b: any) => ({
        bookingId: b.id,
        userId: b.user.id,
        name: b.user.name ?? `Seat ${b.seatNumber}`,
        seatNumber: b.seatNumber,
      }));
  }, [tripData]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [ratings, setRatings] = useState<Record<string, { stars: number; comment: string; compliments: string[] }>>({});
  const [comment, setComment] = useState('');
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>([]);

  const currentPassenger = passengers[currentIndex];
  const currentRating = currentPassenger ? (ratings[currentPassenger.bookingId]?.stars ?? 0) : 0;

  const submitRating = useMutation({
    mutationFn: async (data: { bookingId: string; stars: number; comment: string; compliments: string[] }) => {
      if (data.stars === 0) {
        throw new Error('Please select a star rating');
      }
      const commentText = [data.compliments.join(', '), data.comment]
        .filter(Boolean)
        .join(' — ');
      await driverApi.ratePassenger(data.bookingId, {
        stars: data.stars,
        comment: commentText || undefined,
      });
    },
    onSuccess: () => {
      // Clear inputs for next passenger
      setComment('');
      setSelectedCompliments([]);
      if (currentIndex < passengers.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        // All passengers rated — go home
        router.replace('/(tabs)/home');
      }
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.message || 'Failed to submit rating. Please try again.');
    },
  });

  const handleStarPress = useCallback((star: number) => {
    if (!currentPassenger) return;
    setRatings((prev) => ({
      ...prev,
      [currentPassenger.bookingId]: {
        stars: star,
        comment,
        compliments: selectedCompliments,
      },
    }));
  }, [currentPassenger, comment, selectedCompliments]);

  const toggleCompliment = useCallback((label: string) => {
    setSelectedCompliments((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );
  }, []);

  const handleNext = useCallback(() => {
    if (!currentPassenger) return;
    const stars = currentRating || 5;
    submitRating.mutate({
      bookingId: currentPassenger.bookingId,
      stars,
      comment,
      compliments: selectedCompliments,
    });
  }, [currentPassenger, currentRating, comment, selectedCompliments, submitRating]);

  if (passengers.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={64} color={colors.onSurfaceVariant} />
          <Text variant="bodyLarge" color={colors.onSurfaceVariant} style={{ marginTop: spacing.lg, textAlign: 'center' }}>
            No passengers to rate
          </Text>
          <Button label="Back to Home" onPress={() => router.replace('/(tabs)/home')} style={{ marginTop: spacing.xl }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Progress indicator */}
        <View style={styles.progressRow}>
          {passengers.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                { backgroundColor: i < currentIndex ? colors.primary : i === currentIndex ? colors.onSurface : colors.outlineVariant },
              ]}
            />
          ))}
        </View>

        {/* Passenger avatar + name */}
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          style={styles.heroSection}
        >
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {currentPassenger?.name?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <Text style={styles.passengerName}>{currentPassenger?.name}</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant}>
            Seat {currentPassenger?.seatNumber ?? '—'} · {currentIndex + 1} of {passengers.length}
          </Text>
        </MotiView>

        {/* Star rating */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 80 }}
          style={styles.starsSection}
        >
          <Text style={styles.sectionTitle}>Rate this passenger</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                key={star}
                onPress={() => handleStarPress(star)}
                hitSlop={6}
              >
                <Text style={[styles.star, { color: (currentRating >= star ? '#F59E0B' : colors.outlineVariant) }]}>
                  ★
                </Text>
              </Pressable>
            ))}
          </View>
          {currentRating > 0 && (
            <Text variant="bodySmall" color={colors.onSurfaceVariant}>
              {STAR_MESSAGES[currentRating]}
            </Text>
          )}
        </MotiView>

        {/* Compliments */}
        {currentRating > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 50 }}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>What went well?</Text>
            <View style={styles.chipsWrap}>
              {COMPLIMENTS.map((c) => {
                const active = selectedCompliments.includes(c.label);
                return (
                  <Pressable
                    key={c.label}
                    onPress={() => toggleCompliment(c.label)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Ionicons
                      name={c.icon as any}
                      size={13}
                      color={active ? colors.onPrimary : colors.onSurfaceVariant}
                    />
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </MotiView>
        )}

        {/* Comment */}
        {currentRating > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 80 }}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>Leave a comment (optional)</Text>
            <TextInput
              style={styles.commentInput}
              value={comment}
              onChangeText={setComment}
              placeholder="Any feedback about this passenger..."
              placeholderTextColor={colors.onSurfaceVariant}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </MotiView>
        )}

        {/* CTA */}
        <Button
          label={
            submitRating.isPending
              ? 'Submitting…'
              : currentIndex < passengers.length - 1
              ? 'Next Passenger'
              : 'Finish Rating'
          }
          onPress={handleNext}
          loading={submitRating.isPending}
          disabled={currentRating === 0}
        />

        {/* Skip link */}
        <Pressable
          onPress={() => router.replace('/(tabs)/home')}
          style={styles.skipLink}
        >
          <Text variant="bodySmall" color={colors.onSurfaceVariant}>
            Skip — go to home
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
      gap: spacing.xl,
    },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing['2xl'] },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    progressDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    heroSection: {
      alignItems: 'center',
      gap: spacing.sm,
    },
    avatarCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.primary + '60',
    },
    avatarInitial: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.primary,
    },
    passengerName: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      color: colors.onSurface,
    },
    starsSection: { alignItems: 'center', gap: spacing.sm },
    sectionTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    starsRow: { flexDirection: 'row', gap: spacing.md },
    star: { fontSize: 42 },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      gap: spacing.md,
    },
    cardTitle: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
    },
    chipsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipLabel: {
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.onSurface,
    },
    chipLabelActive: {
      color: colors.onPrimary,
    },
    commentInput: {
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      padding: spacing.base,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      minHeight: 80,
    },
    skipLink: {
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
  });
