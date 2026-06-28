import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { tripsApi } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';
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
    const monthName = item.toLocaleDateString('en-US', { month: 'short' });

    return (
      <Pressable
        style={[styles.dateCard, isSelected && styles.dateCardSelected]}
        onPress={() => setSelectedDate(item)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`${dayName} ${monthName} ${dayNumber}`}
      >
        <Text
          variant="caption"
          color={isSelected ? colors.primary : colors.onSurfaceVariant}
          style={styles.dateDayName}
        >
          {dayName}
        </Text>
        <Text
          variant="titleLarge"
          color={isSelected ? colors.primary : colors.onSurface}
          style={styles.dateNumber}
        >
          {dayNumber}
        </Text>
        <Text
          variant="caption"
          color={isSelected ? colors.primary : colors.onSurfaceVariant}
        >
          {monthName}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium">Schedule Ride</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        >
          <Text variant="titleSmall" style={styles.sectionTitle}>
            Select Date
          </Text>
          <FlatList
            data={dates}
            renderItem={renderDateItem}
            keyExtractor={(item) => item.toISOString()}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateList}
            snapToInterval={72 + spacing.md}
            decelerationRate="fast"
          />
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
          style={styles.timeSection}
        >
          <Text variant="titleSmall" style={styles.sectionTitle}>
            Select Time
          </Text>
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
                    variant="labelLarge"
                    color={past ? colors.onSurfaceVariant : isSelected ? colors.primary : colors.onSurface}
                    style={past && { textDecorationLine: 'line-through' }}
                  >
                    {time}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </MotiView>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.summaryContainer}>
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          <View style={styles.summaryTextContainer}>
            <Text variant="labelMedium" color={colors.onSurfaceVariant}>
              Pickup Time
            </Text>
            <Text variant="titleSmall" color={colors.onSurface}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {selectedTime ? `, ${selectedTime}` : ' - Select time'}
            </Text>
          </View>
        </View>
        <Button
          label="Confirm Schedule"
          onPress={handleSchedule}
          disabled={!selectedTime || isScheduling}
          loading={isScheduling}
        />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  scroll: {
    paddingBottom: spacing['3xl'],
  },
  sectionTitle: {
    paddingHorizontal: spacing['2xl'],
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  dateList: {
    paddingHorizontal: spacing['2xl'],
    gap: spacing.md,
  },
  dateCard: {
    width: 72,
    height: 96,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
  },
  dateCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  dateDayName: {
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  dateNumber: {
    fontFamily: fonts.bold,
    marginBottom: 2,
  },
  timeSection: {
    marginTop: spacing.lg,
  },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing['2xl'],
    gap: spacing.md,
  },
  timeCard: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  timeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  timeCardPast: {
    opacity: 0.4,
    backgroundColor: colors.surfaceContainerHigh,
  },
  footer: {
    padding: spacing['2xl'],
    paddingTop: spacing.md,
    backgroundColor: colors.backgroundDeep,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  summaryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    padding: spacing.md,
    borderRadius: radii.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  summaryTextContainer: {
    marginLeft: spacing.md,
  },
});
