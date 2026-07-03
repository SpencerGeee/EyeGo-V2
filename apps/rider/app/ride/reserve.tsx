import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { tripsApi } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';
import { formatCurrency } from '@eyego/utils';
import { captureException } from '../../lib/sentry';

// Parse a "6:30 PM" slot into 24h {hours, minutes}.
const parseSlot = (slot: string) => {
  const [time, modifier] = slot.split(' ');
  const [h, m] = time.split(':');
  let hours = parseInt(h, 10);
  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return { hours, minutes: parseInt(m, 10) };
};

// Generate next 14 days
const generateDates = () => {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push(date);
  }
  return dates;
};

// Generate time slots
const generateTimeSlots = () => {
  const slots = [];
  for (let i = 6; i <= 22; i++) {
    const hour = i > 12 ? i - 12 : i;
    const ampm = i >= 12 ? 'PM' : 'AM';
    slots.push(`${hour}:00 ${ampm}`);
    slots.push(`${hour}:30 ${ampm}`);
  }
  return slots;
};

export default function ReserveScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { setScheduledTime, selectedTrip } = useRideStore();

  const dates = useMemo(() => generateDates(), []);
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  const [selectedDate, setSelectedDate] = useState<Date>(dates[0]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // A route is known only when the rider already picked a trip. The schedule
  // endpoint creates a ScheduledRideIntent which requires a routeId; without
  // one (entry from pre-search) we can only store the time as a search filter.
  const routeId: string | undefined = (selectedTrip as any)?.route?.id ?? (selectedTrip as any)?.routeId;

  const trip = selectedTrip as any;
  const pickup =
    trip?.pickupLocation?.name ?? trip?.route?.originName ?? 'Your pickup point';
  const dropoff =
    trip?.dropoffLocation?.name ?? trip?.route?.destinationName ?? 'Your destination';
  const fare = trip?.fareAmount ?? trip?.price ?? 0;

  // Build the concrete pickup Date from the selected day + slot.
  const buildScheduledDate = (): Date | null => {
    if (!selectedDate || !selectedTime) return null;
    const { hours, minutes } = parseSlot(selectedTime);
    const d = new Date(selectedDate);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const isToday = selectedDate?.toDateString() === new Date().toDateString();
  // A slot is in the past only for today's date.
  const isSlotPast = (slot: string): boolean => {
    if (!isToday) return false;
    const { hours, minutes } = parseSlot(slot);
    const now = new Date();
    return hours < now.getHours() || (hours === now.getHours() && minutes <= now.getMinutes());
  };

  const scheduleMutation = useMutation({
    mutationFn: (scheduledAt: string) =>
      tripsApi.schedule({ routeId: routeId as string, scheduledAt, seatCount: 1 }),
    onSuccess: (_res, scheduledAt) => {
      setScheduledTime(scheduledAt);
      router.back();
    },
    onError: (err) => {
      captureException(err, { screen: 'reserve', action: 'schedule', routeId });
      const msg = (err as any)?.response?.data?.message ?? 'Could not schedule your ride. Please try again.';
      Alert.alert('Scheduling failed', msg);
    },
  });

  const handleSchedule = () => {
    const scheduledDate = buildScheduledDate();
    if (!scheduledDate) return;
    if (scheduledDate.getTime() <= Date.now()) {
      Alert.alert('Pick a future time', 'The selected time has already passed. Choose a later slot.');
      return;
    }
    const iso = scheduledDate.toISOString();

    if (routeId) {
      // Route known → create a real scheduled-ride intent on the backend.
      scheduleMutation.mutate(iso);
    } else {
      // Pre-search flow → store the time as a client-side search preference.
      // select.tsx reads scheduledTime as a display label and search filter.
      setScheduledTime(iso);
      router.back();
    }
  };

  const isScheduling = scheduleMutation.isPending;

  const renderDateItem = ({ item }: { item: Date }) => {
    const isSelected = item.toDateString() === selectedDate.toDateString();
    const dayName = item.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNumber = item.getDate();

    return (
      <Pressable
        style={[styles.dateCard, isSelected && styles.dateCardSelected]}
        onPress={() => setSelectedDate(item)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`${dayName} ${dayNumber}`}
      >
        <Text style={[styles.dateDayName, { color: isSelected ? colors.onPrimary : colors.onSurfaceVariant }]}>
          {dayName.toUpperCase()}
        </Text>
        <Text style={[styles.dateNumber, { color: isSelected ? colors.onPrimary : colors.onSurface }]}>
          {dayNumber}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Reserve Seat</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Select Date */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        >
          <Text style={styles.sectionTitle}>Select Date</Text>
          <FlatList
            data={dates}
            renderItem={renderDateItem}
            keyExtractor={(item) => item.toISOString()}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateList}
            snapToInterval={64 + spacing.sm}
            decelerationRate="fast"
          />
        </MotiView>

        {/* Select Time */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
          style={styles.timeSection}
        >
          <Text style={styles.sectionTitle}>Select Time</Text>
          <View style={styles.timeGrid}>
            {timeSlots.map((time) => {
              const isSelected = time === selectedTime;
              const past = isSlotPast(time);
              return (
                <Pressable
                  key={time}
                  style={[
                    styles.timeCard,
                    isSelected && styles.timeCardSelected,
                    past && styles.timeCardPast,
                  ]}
                  onPress={() => !past && setSelectedTime(time)}
                  disabled={past}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: past }}
                  accessibilityLabel={`${time}${past ? ' — unavailable' : ''}`}
                >
                  <Text
                    style={[
                      styles.timeText,
                      { color: past ? colors.onSurfaceVariant : isSelected ? colors.primary : colors.onSurface },
                      past && { textDecorationLine: 'line-through' },
                    ]}
                  >
                    {time}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </MotiView>

        {/* Route summary glass panel */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 150 }}
          style={styles.routePanel}
        >
          <View style={styles.routeTimeline}>
            <View style={styles.routeDotFilled} />
            <View style={styles.routeTimelineLine} />
            <View style={styles.routeDotHollow} />
          </View>
          <View style={styles.routeContent}>
            <View style={styles.routeItem}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text variant="bodyLarge" numberOfLines={1} style={{ color: colors.onSurface }}>
                {pickup}
              </Text>
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeItem}>
              <Text style={styles.routeLabel}>DROPOFF</Text>
              <Text variant="bodyLarge" numberOfLines={1} style={{ color: colors.onSurface }}>
                {dropoff}
              </Text>
            </View>
          </View>
        </MotiView>
      </ScrollView>

      {/* Fixed bottom bar */}
      <View style={styles.footer}>
        <View style={styles.fareRow}>
          <View>
            <Text style={styles.fareLabel}>ESTIMATED FARE</Text>
            <Text style={styles.fareValue}>{fare > 0 ? formatCurrency(fare) : '—'}</Text>
          </View>
          <View style={styles.sharedPill}>
            <Ionicons name="people-outline" size={15} color={colors.primary} />
            <Text style={styles.sharedText}>Shared</Text>
          </View>
        </View>
        <Pressable
          onPress={handleSchedule}
          disabled={!selectedTime || isScheduling}
          style={({ pressed }) => [
            styles.confirmBtn,
            (!selectedTime || isScheduling) && { opacity: 0.5 },
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <Text style={styles.confirmText}>
            {isScheduling ? 'Reserving…' : 'Confirm Reservation'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingBottom: 220,
  },
  sectionTitle: {
    paddingHorizontal: spacing['2xl'],
    marginBottom: spacing.md,
    marginTop: spacing.xl,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onSurfaceVariant,
  },
  dateList: {
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
  },
  dateCard: {
    width: 64,
    height: 80,
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  dateCardSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    transform: [{ scale: 1.05 }],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  dateDayName: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    opacity: 0.9,
  },
  dateNumber: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
    marginTop: 4,
  },
  timeSection: {
    marginTop: spacing.lg,
  },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
  },
  timeCard: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  timeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: withOpacity(colors.primary, 0.1),
  },
  timeCardPast: {
    opacity: 0.4,
    backgroundColor: colors.surfaceContainerHigh,
  },
  timeText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodySmall,
    letterSpacing: 0.4,
  },
  routePanel: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.base,
    marginHorizontal: spacing['2xl'],
    marginTop: spacing.xl,
    backgroundColor: colors.surfaceCard,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    padding: spacing.lg,
  },
  routeTimeline: {
    width: 12,
    alignItems: 'center',
    paddingVertical: 6,
  },
  routeDotFilled: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  routeTimelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: colors.rimLight,
    marginVertical: 4,
  },
  routeDotHollow: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  routeContent: { flex: 1 },
  routeItem: { gap: 2 },
  routeLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.onSurfaceVariant,
  },
  routeDivider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginVertical: spacing.md,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceCard,
    borderTopWidth: 1,
    borderTopColor: colors.rimLight,
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.base,
  },
  fareLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.onSurfaceVariant,
    marginBottom: 2,
  },
  fareValue: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.onSurface,
  },
  sharedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.rimLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sharedText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.onSurface,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii['2xl'],
    paddingVertical: spacing.base + 2,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  confirmText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onPrimary,
  },
});
