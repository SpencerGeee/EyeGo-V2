import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes, withOpacity , MAX_SEATS_PER_BOOKING, clampSeats } from '@eyego/config';
// `Pressable` from @eyego/ui, never react-native — NativeWind's interop runtime
// drops the `({ pressed }) => style` function form on RN's Pressable, which
// silently deletes the whole style. See components/trip/stages/SearchStage.tsx.
import { Text, GlassCard, Button, Pressable } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { tripsApi } from '@eyego/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { consumePickedPlace } from '../../utils/placePickerResult';
import { useRideStore } from '../../stores/ride.store';
import { useTripFlow } from '../../stores/tripFlow.store';

interface PickedLocation {
  lat: number;
  lng: number;
  address: string;
}

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

  // Clamped, not trusted. This seeds from whatever Where To last set, and Where
  // To's stepper and this one used to disagree about the ceiling — so a value
  // this screen could not itself produce arrived here and was posted to a
  // validator that rejected it ("scheduling failed (validation failed)").
  const [seatCount, setSeatCount] = useState(() =>
    clampSeats(useRideStore.getState().requestSeatCount || 1),
  );
  const [selectedDate, setSelectedDate] = useState<Date>(getMinDate());
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(getMinDate());
  // Carry over whatever the rider already chose on the where-to surface.
  // Tapping "Schedule" there instead of "Order Ride" used to land on a blank
  // form, forcing them to re-pick a destination they had just set on the map.
  // Both stores are the same ones SearchStage writes to, so this works for any
  // entry point into this screen — no route params to keep in sync.
  const carriedDest = useTripFlow((s) => s.searchPlace);
  const carriedOrigin = useRideStore((s) => s.origin);

  const [requestPickup, setRequestPickup] = useState<PickedLocation | null>(() =>
    carriedOrigin
      ? { lat: carriedOrigin.latitude, lng: carriedOrigin.longitude, address: carriedOrigin.address }
      : null
  );
  const [requestDest, setRequestDest] = useState<PickedLocation | null>(() =>
    carriedDest
      ? {
          lat: carriedDest.latitude,
          lng: carriedDest.longitude,
          address: carriedDest.fullAddress || carriedDest.name,
        }
      : null
  );
  const pickingFieldRef = useRef<'pickup' | 'dest' | null>(null);

  // Default pickup to the device's current position so the rider only has to
  // actively pick a destination — pickup stays overridable via the map picker.
  useEffect(() => {
    if (requestPickup) return;
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setRequestPickup({ lat: loc.coords.latitude, lng: loc.coords.longitude, address: 'Current location' });
      } catch {
        // No GPS fix — pickup stays unset; rider can still set it manually via the map picker.
      }
    })();
  }, [requestPickup]);

  // Consume a location confirmed on the map picker screen — pickingFieldRef
  // tracks which of the two fields (pickup/dest) triggered the navigation.
  useFocusEffect(
    useCallback(() => {
      const field = pickingFieldRef.current;
      if (!field) return;
      const picked = consumePickedPlace();
      if (!picked) return;
      pickingFieldRef.current = null;
      const location: PickedLocation = { lat: picked.latitude, lng: picked.longitude, address: picked.fullAddress };
      if (field === 'pickup') setRequestPickup(location);
      else setRequestDest(location);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const queryClient = useQueryClient();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Dismiss any open picker modal before unmount to avoid native modal
      // conflicts during swipe-back gesture.
      setShowPicker(false);
    };
  }, []);

  // Group/on-demand model: scheduling only needs a pickup point + destination
  // (both map-picked), no route selection. Writes a real ScheduledRideIntent
  // so it shows up on /scheduled-rides and gets picked up by the backend's
  // scheduled-ride matching sweep (which also reminds the matched driver
  // ahead of the departure time).
  const scheduleMutation = useMutation({
    mutationFn: () =>
      tripsApi.schedule({
        destination: requestDest!.address,
        scheduledAt: selectedDate.toISOString(),
        seatCount,
        pickupLat: requestPickup!.lat,
        pickupLng: requestPickup!.lng,
        destLat: requestDest!.lat,
        destLng: requestDest!.lng,
        pickupName: requestPickup!.address,
      }),
    onSuccess: () => {
      if (!mountedRef.current) return;
      queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] });
      router.replace('/scheduled-rides' as any);
    },
    onError: (err: any) => {
      // err.message was the generic axios message ("Request failed with status
      // code 409") — the backend's actual reason (e.g. the duplicate-schedule
      // dedupe check) lives in the response body and was never surfaced, so a
      // 409 looked identical to any other failure and riders assumed nothing
      // had been scheduled when the first attempt may have already succeeded.
      Alert.alert('Scheduling Failed', err?.response?.data?.message || err?.message || 'Could not schedule your ride. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!requestPickup) {
      Alert.alert('Set a Pickup Point', 'Please set where you want to be picked up.');
      return;
    }
    if (!requestDest) {
      Alert.alert('Choose a Destination', 'Please pick where you want to go on the map.');
      return;
    }
    const minDate = getMinDate();
    if (selectedDate < minDate) {
      Alert.alert('Invalid Time', 'Scheduled time must be at least 30 minutes from now.');
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

  const isPending = scheduleMutation.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <GlassCard style={styles.backBtnGlass}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
        </GlassCard>
        <View style={styles.headerCenter}>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>Schedule Ride</Text>
          <Text style={styles.stepLabel}>Step 1 of 2</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* ── Pickup + destination — map-picked, no fixed routes ── */}
        <Text style={[styles.sectionLabel, { marginBottom: spacing.sm }]}>PICKUP &amp; DESTINATION</Text>
        <View style={{ gap: spacing.sm }}>
          <Pressable
            style={styles.searchBar}
            onPress={() => {
              pickingFieldRef.current = 'pickup';
              router.push('/profile/place-picker' as any);
            }}
          >
            <Ionicons name="radio-button-on-outline" size={18} color={colors.primary} />
            <Text
              variant="bodyLarge"
              numberOfLines={1}
              style={{ flex: 1, color: requestPickup ? colors.onSurface : colors.outlineVariant }}
            >
              {requestPickup?.address ?? 'Locating pickup…'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
          <Pressable
            style={styles.searchBar}
            onPress={() => {
              pickingFieldRef.current = 'dest';
              router.push('/profile/place-picker' as any);
            }}
          >
            <Ionicons name="navigate-outline" size={18} color={colors.primary} />
            <Text
              variant="bodyLarge"
              numberOfLines={1}
              style={{ flex: 1, color: requestDest ? colors.onSurface : colors.outlineVariant }}
            >
              {requestDest?.address ?? 'Choose destination on map'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* ── Seats ── */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>SEATS</Text>
        <GlassCard style={styles.fieldRow}>
          <Pressable
            onPress={() => setSeatCount((s) => Math.max(1, s - 1))}
            accessibilityRole="button"
            accessibilityLabel="Decrease seats"
            hitSlop={8}
          >
            <Ionicons name="remove-circle-outline" size={26} color={seatCount > 1 ? colors.primary : colors.outline} />
          </Pressable>
          <Text variant="bodyLarge" style={{ color: colors.onSurface, flex: 1, textAlign: 'center' }}>
            {seatCount} seat{seatCount > 1 ? 's' : ''}
          </Text>
          <Pressable
            onPress={() => setSeatCount((s) => Math.min(MAX_SEATS_PER_BOOKING, s + 1))}
            accessibilityRole="button"
            accessibilityLabel="Increase seats"
            hitSlop={8}
          >
            <Ionicons name="add-circle-outline" size={26} color={seatCount < MAX_SEATS_PER_BOOKING ? colors.primary : colors.outline} />
          </Pressable>
        </GlassCard>

        {/* ── Pickup Time ── */}
        <View style={[styles.modeRow, { marginTop: spacing.xl }]}>
          <Text style={styles.sectionLabel}>PICKUP TIME</Text>
          <View style={styles.noticePill}>
            <Ionicons name="information-circle-outline" size={13} color={colors.statusWarning} />
            <Text style={styles.noticeText}>Min. 30m notice</Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            setTempDate(selectedDate);
            setShowPicker(true);
          }}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <GlassCard style={styles.fieldRow}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <Text variant="bodyLarge" style={{ color: colors.onSurface, flex: 1 }}>
              {formatDate(selectedDate)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </GlassCard>
        </Pressable>

        {/* ── Helper text ── */}
        <Text variant="caption" style={{ color: colors.outlineVariant, marginTop: spacing.sm }}>
          Select a time at least 30 minutes from now to ensure driver availability.
        </Text>
      </ScrollView>

      {/* ── Fixed bottom bar - GlassCard sheet ── */}
      <View style={styles.footer}>
        <GlassCard sheet style={styles.footerSheet}>
          <View style={styles.footerSheetInner}>
            <Button
              label={scheduleMutation.isPending ? 'Scheduling…' : 'Confirm Schedule'}
              onPress={handleSubmit}
              disabled={isPending}
              loading={isPending}
              variant="glow"
              icon={<Ionicons name="calendar" size={20} color={colors.onSurface} />}
            />
          </View>
        </GlassCard>
      </View>

      {/* ── iOS Modal Picker ── */}
      {Platform.OS === 'ios' && showPicker && (
        <Modal
          transparent
          animationType="slide"
          visible={showPicker}
          onRequestClose={() => setShowPicker(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: colors.surfaceCard ?? colors.surfaceContainer }]}>
              <View style={styles.modalHeader}>
                <Pressable onPress={() => setShowPicker(false)}>
                  <Text variant="bodyMedium" style={{ color: colors.statusError }}>Cancel</Text>
                </Pressable>
                <Text variant="titleSmall" style={{ color: colors.onSurface }}>Select Date & Time</Text>
                <Pressable onPress={handleConfirmDate}>
                  <Text variant="bodyMedium" style={{ color: colors.primary }}>Done</Text>
                </Pressable>
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

      {/* ── Android inline picker ── */}
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
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtnGlass: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    backBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCenter: {
      alignItems: 'center',
    },
    stepLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: `${colors.primary}B3`,
      marginTop: 2,
    },
    headerSpacer: {
      width: 44,
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.sm,
      paddingBottom: 180,
    },
    modeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 11,
      lineHeight: 15,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.outline,
    },
    modeToggle: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.3),
      color: colors.primary,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      paddingHorizontal: spacing.base,
      height: 52,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyLarge,
      lineHeight: Math.round(fontSizes.bodyLarge * 1.4),
      color: colors.onSurface,
      height: '100%',
    },
    placeholderCard: {
      padding: spacing.lg,
      alignItems: 'center',
    },
    requestPromptCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.primary}10`,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: `${colors.primary}30`,
      padding: spacing.base,
    },
    routeCard: {
      padding: spacing.base,
      gap: spacing.base,
      overflow: 'hidden',
    },
    routeCardSelected: {
      borderColor: colors.primary,
      transform: [{ scale: 1.02 }],
    },

    routeBody: { flex: 1 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    originDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.outline,
    },
    originDotActive: {
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
    },
    routeConnector: {
      width: 2,
      height: 14,
      backgroundColor: colors.outlineVariant,
      marginLeft: 3,
      marginVertical: 2,
    },
    routeMeta: { alignItems: 'flex-end', gap: spacing.sm },
    etaPill: {
      backgroundColor: `${colors.surfaceVariant ?? colors.outlineVariant}80`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    etaPillSelected: {
      backgroundColor: `${colors.primary}20`,
    },
    etaText: {
      fontFamily: fonts.monoRegular,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.4,
      color: colors.onSurfaceVariant,
    },
    etaTextSelected: {
      color: colors.primary,
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.base,
      minHeight: 56,
    },
    noticePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: withOpacity(colors.statusWarning, 0.15),
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    noticeText: {
      fontFamily: fonts.monoRegular,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.4,
      color: colors.statusWarning,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['2xl'],
    },
    footerSheet: {
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    footerSheetInner: {
      padding: spacing.lg,
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
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
  });
