import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { spacing, radii, fonts, fontSizes, MAX_SEATS_PER_BOOKING, clampSeats } from '@eyego/config';
// `Pressable` from @eyego/ui, never react-native — NativeWind's interop runtime
// drops the `({ pressed }) => style` function form on RN's Pressable, which
// silently deletes the whole style. See components/trip/stages/SearchStage.tsx.
import { Text, Button, Pressable, GradientGlowBorder, GlassSurface, goDeeper, goBack, goFresh, notify } from '@eyego/ui';
import { clearTripSurfaceReturn } from '../../utils/tripSurfaceReturn';
import { useColors, Colors } from '../../utils/useColors';
import { tripsApi, ridesApi } from '@eyego/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consumePickedPlace } from '../../utils/placePickerResult';
import { useRideStore } from '../../stores/ride.store';
import { useTripFlow } from '../../stores/tripFlow.store';
import { clockTime, dayMonth, weekdayShort } from '@eyego/utils';

/**
 * SCHEDULE A RIDE — Uber Reserve's shape.
 *
 * "Uber Reserve style": the question is WHEN, so the page leads with it. A
 * strip of days, the pickup times for the chosen day in 15-minute steps, and a
 * summary that reads the answer back the way the rider will think about it —
 * "Thu 9 Oct · 8:45 AM · arrives about 9:10". Where and how many sit below,
 * already filled in from the Where-to screen.
 *
 * WHAT IT REPLACED. A form: two address bars, a seat stepper, and the time
 * behind a modal spinner on iOS and two system dialogs on Android — so the one
 * thing this screen exists to set was the hardest thing on it to see, and it
 * said "Step 1 of 2" for a flow with no step 2. Slots work the same on both
 * platforms and need no modal at all.
 *
 * The rules are the server's: at least 30 minutes' notice, at most 30 days
 * out (scheduleTrip: SCHEDULE_TOO_FAR_OUT). Nothing is charged by scheduling —
 * an intent holds no money — and it can be cancelled until a driver is
 * matched (cancelScheduledRide accepts PENDING and DISPATCHED only).
 */

interface PickedLocation {
  lat: number;
  lng: number;
  address: string;
}

const NOTICE_MIN = 30;
const MAX_DAYS = 30;
const SLOT_MIN = 15;

/** The earliest pickup the server accepts, rounded up to the next slot. */
function earliestSlot(now = new Date()): Date {
  const d = new Date(now.getTime() + NOTICE_MIN * 60_000);
  const m = d.getMinutes();
  const up = Math.ceil(m / SLOT_MIN) * SLOT_MIN;
  d.setMinutes(up, 0, 0);
  return d;
}

function latestAllowed(now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + MAX_DAYS);
  return d;
}

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Every bookable pickup time on one calendar day. */
function slotsFor(day: Date): Date[] {
  const start = startOfDay(day).getTime();
  const min = earliestSlot().getTime();
  const max = latestAllowed().getTime();
  const out: Date[] = [];
  for (let m = 0; m < 24 * 60; m += SLOT_MIN) {
    const t = start + m * 60_000;
    if (t >= min && t <= max) out.push(new Date(t));
  }
  return out;
}

export default function ScheduleRideScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  // Clamped, not trusted — see the history in clampSeats.
  const [seatCount, setSeatCount] = useState(() => clampSeats(useRideStore.getState().requestSeatCount || 1));

  /** Bookable days: today (if any slot is left) through MAX_DAYS out. */
  const days = useMemo(() => {
    const out: Date[] = [];
    const today = startOfDay(new Date());
    for (let i = 0; i <= MAX_DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      if (slotsFor(d).length) out.push(d);
    }
    return out;
  }, []);

  const [day, setDay] = useState<Date>(() => days[0] ?? startOfDay(new Date()));
  const slots = useMemo(() => slotsFor(day), [day]);
  /** A morning default for a later day; the first bookable slot for today. */
  const defaultSlot = useCallback(
    (forDay: Date, list: Date[]) =>
      startOfDay(forDay).getTime() === startOfDay(new Date()).getTime()
        ? list[0]
        : list.find((s) => s.getHours() === 8 && s.getMinutes() === 0) ?? list[0],
    [],
  );
  const [selected, setSelected] = useState<Date>(() => defaultSlot(day, slots) ?? earliestSlot());

  const pickDay = (d: Date) => {
    void Haptics.selectionAsync().catch(() => {});
    setDay(d);
    const list = slotsFor(d);
    // Keep the same clock time on the new day when it exists there.
    const same = list.find((s) => s.getHours() === selected.getHours() && s.getMinutes() === selected.getMinutes());
    setSelected(same ?? defaultSlot(d, list) ?? earliestSlot());
  };

  // Scroll the time strip so the chosen slot is in view.
  const timeStripRef = useRef<ScrollView>(null);
  const SLOT_W = 92;
  useEffect(() => {
    const i = slots.findIndex((s) => s.getTime() === selected.getTime());
    if (i < 0) return;
    const t = setTimeout(() => timeStripRef.current?.scrollTo({ x: Math.max(0, i * SLOT_W - SLOT_W), animated: true }), 60);
    return () => clearTimeout(t);
  }, [day, slots, selected]);

  // Carried over from Where-to: scheduling the same journey should not mean
  // re-picking it. Same stores SearchStage writes.
  const carriedDest = useTripFlow((s) => s.searchPlace);
  const carriedOrigin = useRideStore((s) => s.origin);
  const [requestPickup, setRequestPickup] = useState<PickedLocation | null>(() =>
    carriedOrigin ? { lat: carriedOrigin.latitude, lng: carriedOrigin.longitude, address: carriedOrigin.address } : null,
  );
  const [requestDest, setRequestDest] = useState<PickedLocation | null>(() =>
    carriedDest
      ? { lat: carriedDest.latitude, lng: carriedDest.longitude, address: carriedDest.fullAddress || carriedDest.name }
      : null,
  );
  const pickingFieldRef = useRef<'pickup' | 'dest' | null>(null);

  // Default pickup to the device's position; the rider only has to pick where to.
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
        // No fix — the rider sets it on the map.
      }
    })();
  }, [requestPickup]);

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
    }, []),
  );

  /**
   * "ARRIVES ABOUT 9:10" — from the road, not a guess.
   *
   * The same quote the ride picker uses measures the journey and returns its
   * duration. A preview only: nothing is booked or held by it.
   */
  const [tripMin, setTripMin] = useState<number | null>(null);
  useEffect(() => {
    if (!requestPickup || !requestDest) {
      setTripMin(null);
      return;
    }
    let cancelled = false;
    ridesApi
      .quote({
        pickupLat: requestPickup.lat,
        pickupLng: requestPickup.lng,
        dropoffLat: requestDest.lat,
        dropoffLng: requestDest.lng,
        tier: 'ECO',
        seatCount,
      } as any)
      .then((q: any) => {
        if (!cancelled && typeof q?.durationMin === 'number' && Number.isFinite(q.durationMin)) {
          setTripMin(Math.max(1, Math.round(q.durationMin)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [requestPickup?.lat, requestPickup?.lng, requestDest?.lat, requestDest?.lng, seatCount]);

  const queryClient = useQueryClient();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const scheduleMutation = useMutation({
    mutationFn: () =>
      tripsApi.schedule({
        destination: requestDest!.address,
        scheduledAt: selected.toISOString(),
        seatCount,
        pickupLat: requestPickup!.lat,
        pickupLng: requestPickup!.lng,
        destLat: requestDest!.lat,
        destLng: requestDest!.lng,
        pickupName: requestPickup!.address,
      }),
    onSuccess: () => {
      if (!mountedRef.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['trips', 'scheduled'] });
      // A booked ride is a new chapter: the Where-To / ride-options pages that
      // led here are done, so Back from the list goes Home, not into them.
      clearTripSurfaceReturn();
      goFresh('/scheduled-rides');
    },
    onError: (err: any) => {
      // The server's own reason (a duplicate, too far out) — a bare status code
      // left riders unsure whether the first attempt had already gone through.
      notify('Could not schedule that', err?.response?.data?.message || err?.message || 'Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!requestPickup) return notify('Set a pickup point', 'Choose where you want to be picked up.');
    if (!requestDest) return notify('Choose a destination', 'Pick where you are going.');
    if (selected < earliestSlot(new Date(Date.now() - SLOT_MIN * 60_000))) {
      return notify('Pick a later time', `Scheduled rides need at least ${NOTICE_MIN} minutes' notice.`);
    }
    scheduleMutation.mutate();
  };

  const isToday = startOfDay(selected).getTime() === startOfDay(new Date()).getTime();
  const isTomorrow = startOfDay(selected).getTime() === startOfDay(new Date(Date.now() + 86_400_000)).getTime();
  const dayWord = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : `${weekdayShort(selected)} ${dayMonth(selected)}`;
  const arrives = tripMin != null ? clockTime(new Date(selected.getTime() + tripMin * 60_000)) : null;

  const openPicker = (field: 'pickup' | 'dest') => {
    pickingFieldRef.current = field;
    goDeeper('/profile/place-picker' as any);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={22} />
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Schedule a ride</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>When should we pick you up?</Text>

        {/* THE ANSWER, READ BACK. The page's one glow. */}
        <GradientGlowBorder
          palette="brandGreen"
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii['2xl']}
          glow
          glowIntensity={0.6}
          style={styles.summaryWrap}
        >
          <View style={styles.summary}>
            <Text style={styles.summaryDay}>{dayWord}</Text>
            <Text style={styles.summaryTime}>{clockTime(selected)}</Text>
            <View style={styles.summaryMeta}>
              <Ionicons name="flag-outline" size={13} color={colors.onSurfaceVariant} />
              <Text style={styles.summaryMetaText} numberOfLines={1}>
                {arrives ? `Arrives about ${arrives}` : 'Pickup time'}
                {seatCount > 1 ? ` · ${seatCount} seats` : ''}
              </Text>
            </View>
          </View>
        </GradientGlowBorder>

        {/* DAYS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
          {days.map((d, i) => {
            const active = startOfDay(d).getTime() === startOfDay(day).getTime();
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => pickDay(d)}
                style={[styles.dayChip, active && styles.dayChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={i === 0 ? 'Today' : `${weekdayShort(d)} ${dayMonth(d)}`}
              >
                <Text style={[styles.dayChipTop, active && styles.dayChipTopActive]} numberOfLines={1}>
                  {i === 0 && startOfDay(d).getTime() === startOfDay(new Date()).getTime()
                    ? 'Today'
                    : weekdayShort(d)}
                </Text>
                <Text style={[styles.dayChipNum, active && styles.dayChipNumActive]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* TIMES — the same control on iPhone and Android, no modal. */}
        <ScrollView
          ref={timeStripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.timeStrip}
        >
          {slots.map((s) => {
            const active = s.getTime() === selected.getTime();
            return (
              <Pressable
                key={s.toISOString()}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  setSelected(s);
                }}
                style={[styles.timeChip, active && styles.timeChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Pick up at ${clockTime(s)}`}
              >
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                  {clockTime(s)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* WHERE */}
        <View style={styles.tripCard}>
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
          <Pressable style={styles.tripRow} onPress={() => openPicker('pickup')} accessibilityRole="button" accessibilityLabel="Change pickup">
            <View style={[styles.dot, { borderColor: colors.onSurfaceVariant }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.tripLabel}>PICKUP</Text>
              <Text style={styles.tripValue} numberOfLines={1}>{requestPickup?.address ?? 'Finding your location…'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
          <View style={styles.tripDivider} />
          <Pressable style={styles.tripRow} onPress={() => openPicker('dest')} accessibilityRole="button" accessibilityLabel="Change destination">
            <Ionicons name="location" size={14} color={colors.primary} style={{ width: 12 }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.tripLabel, { color: colors.primary }]}>DROP-OFF</Text>
              <Text style={[styles.tripValue, !requestDest && { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                {requestDest?.address ?? 'Where are you going?'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* HOW MANY */}
        <View style={styles.seatRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.seatLabel}>Seats</Text>
            <Text style={styles.seatHint}>How many of you are travelling</Text>
          </View>
          <Pressable
            onPress={() => setSeatCount((s) => Math.max(1, s - 1))}
            disabled={seatCount <= 1}
            style={[styles.stepBtn, seatCount <= 1 && { opacity: 0.4 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Fewer seats"
          >
            <Ionicons name="remove" size={18} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.seatValue}>{seatCount}</Text>
          <Pressable
            onPress={() => setSeatCount((s) => Math.min(MAX_SEATS_PER_BOOKING, s + 1))}
            disabled={seatCount >= MAX_SEATS_PER_BOOKING}
            style={[styles.stepBtn, seatCount >= MAX_SEATS_PER_BOOKING && { opacity: 0.4 }]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="More seats"
          >
            <Ionicons name="add" size={18} color={colors.onSurface} />
          </Pressable>
        </View>

        {/* THE TERMS, IN ONE LINE — what Uber Reserve puts under its button. */}
        <View style={styles.policy}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
          <Text style={styles.policyText}>
            Nothing is charged now. We find your driver ahead of time, and you can cancel free until one is matched.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={`Schedule for ${isToday ? 'today' : isTomorrow ? 'tomorrow' : weekdayShort(selected)} · ${clockTime(selected)}`}
          onPress={handleSubmit}
          loading={scheduleMutation.isPending}
          disabled={scheduleMutation.isPending || !requestDest}
          variant="glow"
        />
      </View>
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
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    headerTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
    },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 140, gap: spacing.lg },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineMedium,
      lineHeight: Math.round(fontSizes.headlineMedium * 1.2),
      letterSpacing: -0.5,
      color: colors.onSurface,
      marginTop: spacing.sm,
    },
    summaryWrap: { width: '100%' },
    summary: { paddingVertical: spacing.xl, paddingHorizontal: spacing.xl, alignItems: 'center', gap: 2 },
    summaryDay: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.primary, letterSpacing: 0.2 },
    summaryTime: {
      fontFamily: fonts.displayBold,
      fontSize: 44,
      lineHeight: 52,
      letterSpacing: -1.2,
      color: colors.onSurface,
    },
    summaryMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    summaryMetaText: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant },
    dayStrip: { gap: spacing.sm, paddingVertical: 2 },
    dayChip: {
      width: 58,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      alignItems: 'center',
      gap: 2,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outlineVariant,
    },
    dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    dayChipTop: { fontFamily: fonts.medium, fontSize: fontSizes.caption, color: colors.onSurfaceVariant },
    dayChipTopActive: { color: colors.onPrimary },
    dayChipNum: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleSmall, color: colors.onSurface },
    dayChipNumActive: { color: colors.onPrimary },
    timeStrip: { gap: spacing.sm, paddingVertical: 2 },
    timeChip: {
      width: 84,
      height: 44,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outlineVariant,
    },
    timeChipActive: { backgroundColor: `${colors.primary}22`, borderColor: colors.primary, borderWidth: 1.5 },
    timeChipText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall, color: colors.onSurface },
    timeChipTextActive: { color: colors.primary },
    tripCard: { borderRadius: radii.xl, overflow: 'hidden', paddingHorizontal: spacing.base },
    tripRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
    tripDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.outlineVariant, marginLeft: 24 },
    dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5 },
    tripLabel: { fontFamily: fonts.semiBold, fontSize: 10, letterSpacing: 1, color: colors.onSurfaceVariant },
    tripValue: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface, marginTop: 1 },
    seatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      borderRadius: radii.xl,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outlineVariant,
    },
    seatLabel: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    seatHint: { fontFamily: fonts.regular, fontSize: fontSizes.caption, color: colors.onSurfaceVariant },
    stepBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.outline,
    },
    seatValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      color: colors.onSurface,
      minWidth: 22,
      textAlign: 'center',
    },
    policy: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.xs },
    policyText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      lineHeight: Math.round(fontSizes.caption * 1.5),
      color: colors.onSurfaceVariant,
    },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.xl,
    },
  });
