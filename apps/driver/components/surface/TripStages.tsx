import React, { useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Pressable, SheetContent, SwipeToConfirm, callNumber } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { StopTimeline } from '../trip/StopTimeline';
import { useTripStops } from '../trip/useTripStops';
import { openExternalNavigation } from '../../utils/externalNav';
import { useTripAdvance } from './useTripAdvance';
import type { DriverStage } from './driverStage';

/**
 * THE DRIVING STAGES, AS SHEET BODIES.
 *
 * BUGFIX ("the new manage trip page and the tracking pages of the driver app…
 * should be very aesthetic and clean like the way the rider tracking page is").
 *
 * They now are, in the most literal sense available: this publishes into the
 * same `MapSheetHost` the rider's TrackingStage publishes into, over the same
 * never-unmounting map, with the same detents, the same crossfade and the same
 * chrome table. The two apps are not "styled alike" — they are the same
 * surface with different content.
 *
 * ── WHAT LIVES HERE AND WHAT STAYS A SCREEN ─────────────────────────────────
 *
 * The sheet carries the FLOW: where the next stop is, who is on board, and the
 * one action that moves the trip forward. That is what a driver reads at a
 * junction, and it is all Uber puts in front of one.
 *
 * The detailed work — the passenger roster, PIN boarding, adding an offline
 * passenger, seat management — stays on `(trip)/active/[id]`, reached from the
 * "Manage trip" row. That is not a compromise: those are two-handed, stopped-
 * vehicle tasks that want a full screen, and putting them in a drawer over a
 * live map would make the common case worse to serve the rare one.
 */

export interface TripStagesProps {
  stage: DriverStage;
  trip: any | null;
  /** Opens the full manage screen for roster / PIN / seat work. */
  onManage?: () => void;
}

export function TripStages({ stage, trip, onManage }: TripStagesProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /**
   * Every hook runs before any early return — including this one, which is the
   * exact rule the manage screen broke when it called `useTripStops` below its
   * loading guard and crashed with "rendered more hooks than during the
   * previous render". `scripts/e2e/conditional-hooks.mjs` now enforces it.
   */
  const { stops } = useTripStops(trip);
  const underMinimumAck = useRef(false);
  const { advance, label, busy, canAdvance } = useTripAdvance({
    tripId: trip?.id ?? '',
    status: trip?.status,
    underMinimumAck,
  });

  /**
   * The one passenger worth surfacing on the sheet: on the way to a pickup it
   * is who you are collecting, mid-ride it is who is aboard. A list belongs on
   * the manage screen; a driver at a junction needs a name and a phone.
   */
  const focusPassenger = useMemo(() => {
    const all = stops.flatMap((s: any) => s.passengers ?? []);
    return all[0] ?? null;
  }, [stops]);

  /**
   * Hands the stop to the driver's own map app.
   *
   * `openExternalNavigation` is the existing utility the manage screen already
   * uses — it owns the Google/Apple/Waze chooser, the "no coordinates" notice
   * and the platform URL shapes. Writing a second navigation launcher here is
   * exactly how the two trip screens drifted apart in the first place.
   *
   * No `origin`: on this surface the driver is being sent from where they
   * ARE — to the pickup, or onward to the next stop. The whole-leg form
   * (pickup → drop-off) belongs to the manage screen, which knows whether the
   * passenger is aboard.
   */
  const handleNavigate = useCallback((stop: any) => {
    const lat = stop?.lat ?? stop?.latitude ?? null;
    const lng = stop?.lng ?? stop?.longitude ?? null;
    void openExternalNavigation(
      { lat, lng, name: stop?.title ?? stop?.name ?? null, address: stop?.subtitle ?? null } as any,
      { origin: null },
    );
  }, []);

  const isDriving = stage === 'enroute' || stage === 'arrived' || stage === 'intrip';
  if (!isDriving || !trip) return null;

  const heading =
    stage === 'enroute' ? 'Heading to pickup'
    : stage === 'arrived' ? 'At the pickup'
    : 'On the way';

  return (
    <SheetContent stage={stage}>
      <View style={styles.body}>
        <View style={styles.headRow}>
          <Text style={styles.heading} numberOfLines={1}>{heading}</Text>
          {onManage ? (
            <Pressable
              onPress={onManage}
              accessibilityRole="button"
              accessibilityLabel="Manage this trip"
              style={styles.manage}
            >
              <Ionicons name="options-outline" size={15} color={colors.onSurfaceVariant} />
              <Text style={styles.manageLabel}>Manage</Text>
            </Pressable>
          ) : null}
        </View>

        {/* The route as places, not statuses — the same projection the manage
            screen renders, from the same hook, so they cannot disagree. */}
        <StopTimeline stops={stops} onNavigate={handleNavigate} />

        {focusPassenger?.phone ? (
          <Pressable
            onPress={() => callNumber(focusPassenger.phone)}
            accessibilityRole="button"
            accessibilityLabel={`Call ${focusPassenger.name ?? 'passenger'}`}
            style={styles.callRow}
          >
            <Ionicons name="call" size={16} color={colors.primary} />
            <Text style={styles.callLabel} numberOfLines={1}>
              Call {focusPassenger.name ?? 'passenger'}
            </Text>
          </Pressable>
        ) : null}

        {/*
          A SWIPE, NOT A TAP.

          Every action here is one-way and legal exactly once — arriving,
          departing, completing. A misfire costs a rider their ride or a driver
          their fare, and the driver's hands are on a wheel. Same control the
          manage screen has always used.
        */}
        {canAdvance && label ? (
          <SwipeToConfirm label={label} onConfirm={advance} disabled={busy} />
        ) : null}
      </View>
    </SheetContent>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    body: { gap: spacing.md, paddingTop: 2 },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: {
      flex: 1,
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleMedium,
      color: colors.onSurface,
    },
    /**
     * 44pt MINIMUM, as a real height — not as invisible hit padding.
     *
     * `@eyego/ui`'s Pressable adds 8pt of hitSlop by default, so at its original
     * 33pt this control was technically compliant. That is the wrong standard to
     * hold a DRIVING control to: the driver is glancing down from a windscreen
     * at a moving vehicle's dashboard, and a target that is only reachable
     * because of padding they cannot see is one they will miss. The HIG minimum
     * is a floor for a seated user with two hands.
     */
    manage: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainer,
    },
    manageLabel: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
    },
    /** Same 44pt floor, and for the same reason — see `manage`. Calling a
     *  passenger is the control most likely to be used at a kerb, one-handed. */
    callRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: `${colors.primary}18`,
    },
    callLabel: { fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.primary },
  });
