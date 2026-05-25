import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { apiClient } from '@eyego/api';
import { useMutation } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';

function getMinDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  return d;
}

function formatDate(date: Date) {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ScheduleRideScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(getMinDate());
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(getMinDate());

  const scheduleMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/trips/schedule', {
        origin,
        destination,
        scheduledAt: selectedDate.toISOString(),
      }),
    onSuccess: () => {
      router.replace('/(tabs)/trips');
    },
    onError: (err: any) => {
      Alert.alert('Scheduling Failed', err?.message || 'Could not schedule your ride. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!origin.trim()) {
      Alert.alert('Missing Pickup', 'Please enter a pickup location.');
      return;
    }
    if (!destination.trim()) {
      Alert.alert('Missing Destination', 'Please enter a destination.');
      return;
    }
    const minDate = getMinDate();
    if (selectedDate < minDate) {
      Alert.alert(
        'Invalid Time',
        'Scheduled time must be at least 30 minutes from now.',
      );
      return;
    }
    scheduleMutation.mutate();
  };

  const handleDateChange = (_: any, date?: Date) => {
    if (date) {
      setTempDate(date);
      if (Platform.OS === 'android') {
        setSelectedDate(date);
        setShowPicker(false);
      }
    } else if (Platform.OS === 'android') {
      setShowPicker(false);
    }
  };

  const handleConfirmDate = () => {
    setSelectedDate(tempDate);
    setShowPicker(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Schedule a Ride</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          {/* Pickup */}
          <Text
            variant="labelSmall"
            style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
          >
            PICKUP LOCATION
          </Text>
          <View style={styles.inputWrap}>
            <Ionicons name="location" size={18} color={colors.primary} style={styles.inputIcon} />
            <TextInput
              value={origin}
              onChangeText={setOrigin}
              placeholder="Enter pickup address"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[styles.input, { color: colors.onSurface }]}
              returnKeyType="next"
            />
          </View>

          {/* Destination */}
          <Text
            variant="labelSmall"
            style={[styles.sectionLabel, { color: colors.onSurfaceVariant, marginTop: spacing['2xl'] }]}
          >
            DESTINATION
          </Text>
          <View style={styles.inputWrap}>
            <Ionicons name="navigate" size={18} color={colors.secondary ?? colors.primary} style={styles.inputIcon} />
            <TextInput
              value={destination}
              onChangeText={setDestination}
              placeholder="Enter destination"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[styles.input, { color: colors.onSurface }]}
              returnKeyType="done"
            />
          </View>

          {/* Date & Time */}
          <Text
            variant="labelSmall"
            style={[styles.sectionLabel, { color: colors.onSurfaceVariant, marginTop: spacing['2xl'] }]}
          >
            DATE & TIME
          </Text>
          <Pressable
            onPress={() => {
              setTempDate(selectedDate);
              setShowPicker(true);
            }}
            style={({ pressed }) => [
              styles.dateRow,
              {
                backgroundColor: colors.surfaceContainer,
                borderColor: colors.outlineVariant,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <Text variant="bodyMedium" style={{ color: colors.onSurface, flex: 1 }}>
              {formatDate(selectedDate)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>

          <View style={[styles.infoRow, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, flex: 1 }}>
              Rides can be scheduled at least 30 minutes from now.
            </Text>
          </View>

          <View style={{ marginTop: spacing['3xl'] }}>
            <Button
              label={scheduleMutation.isPending ? 'Scheduling...' : 'Schedule Ride'}
              onPress={handleSubmit}
              variant="primary"
              disabled={scheduleMutation.isPending}
            />
          </View>
        </MotiView>
      </ScrollView>

      {/* iOS Modal Picker */}
      {Platform.OS === 'ios' && showPicker && (
        <Modal
          transparent
          animationType="slide"
          visible={showPicker}
          onRequestClose={() => setShowPicker(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: colors.surfaceContainer }]}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text variant="bodyMedium" style={{ color: colors.error }}>Cancel</Text>
                </TouchableOpacity>
                <Text variant="titleSmall">Select Date & Time</Text>
                <TouchableOpacity onPress={handleConfirmDate}>
                  <Text variant="bodyMedium" style={{ color: colors.primary }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="datetime"
                display="spinner"
                minimumDate={getMinDate()}
                onChange={handleDateChange}
                textColor={colors.onSurface}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Android inline picker */}
      {Platform.OS === 'android' && showPicker && (
        <DateTimePicker
          value={tempDate}
          mode="datetime"
          display="default"
          minimumDate={getMinDate()}
          onChange={handleDateChange}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    sectionLabel: { letterSpacing: 1, marginBottom: spacing.base },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      paddingHorizontal: spacing.base,
      height: 52,
    },
    inputIcon: { marginRight: spacing.md },
    input: {
      flex: 1,
      fontSize: 15,
      height: '100%',
    },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderRadius: radii.xl,
      borderWidth: 1,
      padding: spacing.base,
      height: 52,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radii.lg ?? radii.xl,
      borderWidth: 1,
      padding: spacing.base,
      marginTop: spacing.base,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    modalSheet: {
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingBottom: spacing['3xl'],
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(0,0,0,0.1)',
    },
  });
