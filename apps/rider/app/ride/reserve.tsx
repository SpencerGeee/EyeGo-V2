import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useRideStore } from '../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';

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
  const { setScheduledTime } = useRideStore();

  const dates = useMemo(() => generateDates(), []);
  const timeSlots = useMemo(() => generateTimeSlots(), []);

  const [selectedDate, setSelectedDate] = useState<Date>(dates[0]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);

  const handleSchedule = () => {
    if (!selectedDate || !selectedTime) return;
    
    setIsScheduling(true);
    
    // Mock API call
    setTimeout(() => {
      // Combine date and time
      const [time, modifier] = selectedTime.split(' ');
      let [hours, minutes] = time.split(':');
      let hoursNum = parseInt(hours, 10);
      
      if (modifier === 'PM' && hoursNum < 12) hoursNum += 12;
      if (modifier === 'AM' && hoursNum === 12) hoursNum = 0;
      
      const scheduledDate = new Date(selectedDate);
      scheduledDate.setHours(hoursNum, parseInt(minutes, 10), 0, 0);
      
      setScheduledTime(scheduledDate.toISOString());
      setIsScheduling(false);
      router.back();
    }, 1000);
  };

  const renderDateItem = ({ item }: { item: Date }) => {
    const isSelected = item.toDateString() === selectedDate.toDateString();
    const dayName = item.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNumber = item.getDate();
    const monthName = item.toLocaleDateString('en-US', { month: 'short' });

    return (
      <Pressable
        style={[styles.dateCard, isSelected && styles.dateCardSelected]}
        onPress={() => setSelectedDate(item)}
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
              return (
                <Pressable
                  key={time}
                  style={[styles.timeCard, isSelected && styles.timeCardSelected]}
                  onPress={() => setSelectedTime(time)}
                >
                  <Text
                    variant="labelLarge"
                    color={isSelected ? colors.primary : colors.onSurface}
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
