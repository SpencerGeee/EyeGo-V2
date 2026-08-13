import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, AppState } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
// `Pressable` from @eyego/ui, never react-native — NativeWind's interop runtime
// drops the `({ pressed }) => style` function form on RN's Pressable, which
// silently deletes the whole style. See the note in rider SearchStage.tsx.
import { Text, Pressable, GradientGlowBorder } from '@eyego/ui';
import { useColors, type DriverColors } from '../utils/useColors';
import { consumePickedPlace } from '../utils/placePickerResult';

/**
 * DESTINATION MODE — "I'm heading home, only send me rides going my way."
 *
 * A driver finishing their shift used to have two options: keep taking whatever
 * dispatch sent and end up further from home, or go offline and earn nothing on
 * the way back. Every major platform solved this the same way, and so does
 * this: set where you are going and the matcher stops offering trips that would
 * take you the wrong way (see services/destination-mode.service.js).
 *
 * The allowance is rationed and the card says so plainly, because a driver who
 * discovers the limit by being refused reads it as a bug.
 */
export function DestinationModeCard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const [remainingLabel, setRemainingLabel] = useState<string | null>(null);

  const { data: mode } = useQuery({
    queryKey: ['driver', 'destination-mode'],
    queryFn: () => driverApi.getDestinationMode(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data ?? null,
    staleTime: 30_000,
  });

  const setMode = useMutation({
    mutationFn: (p: { lat: number; lng: number; address?: string | null }) =>
      driverApi.setDestinationMode(p),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['driver', 'destination-mode'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      Alert.alert('Could not set destination', msg ?? 'Please try again.');
    },
  });

  const clearMode = useMutation({
    mutationFn: () => driverApi.clearDestinationMode(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver', 'destination-mode'] }),
  });

  // The picker hands its result back through a one-shot module slot, so this
  // has to look for it on focus rather than receive it as a param.
  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedPlace();
      if (picked) {
        setMode.mutate({
          lat: picked.latitude,
          lng: picked.longitude,
          address: picked.fullAddress ?? picked.name ?? null,
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  /**
   * The countdown, against SERVER time.
   *
   * Ticks once a minute, not once a second: this is a two-hour window and a
   * per-second timer on the home screen is a wakeup a minute for no new
   * information. Re-synced on foreground so a backgrounded app does not come
   * back showing a stale number.
   */
  useEffect(() => {
    if (!mode?.active || !mode.expiresAtServerMs) {
      setRemainingLabel(null);
      return;
    }
    const skewMs = mode.serverNowMs - Date.now();
    const tick = () => {
      const leftMs = mode.expiresAtServerMs! - (Date.now() + skewMs);
      if (leftMs <= 0) {
        setRemainingLabel(null);
        qc.invalidateQueries({ queryKey: ['driver', 'destination-mode'] });
        return;
      }
      const mins = Math.ceil(leftMs / 60_000);
      setRemainingLabel(mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`);
    };
    tick();
    const t = setInterval(tick, 60_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [mode, qc]);

  const openPicker = () => {
    if (mode && mode.usesRemaining <= 0) {
      Alert.alert(
        'No destination trips left today',
        `You get ${mode.maxUsesPerDay} a day, and both are used. It resets tomorrow.`,
      );
      return;
    }
    void Haptics.selectionAsync();
    router.push('/(trip)/location-picker' as any);
  };

  if (!mode) return null;

  if (mode.active) {
    return (
      <GradientGlowBorder
        palette="driver"
        fillColor={colors.surfaceContainerHigh}
        borderRadius={radii.xl}
        thickness="thin"
        glow
        glowIntensity={0.85}
        style={styles.card}
      >
        <View style={[styles.icon, { backgroundColor: `${colors.primary}22` }]}>
          <Ionicons name="home" size={18} color={colors.primary} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {mode.address ?? 'Heading to your destination'}
          </Text>
          <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
            Only rides going this way
          </Text>
        </View>
        {remainingLabel ? (
          <View style={[styles.pill, { borderColor: `${colors.primary}55`, backgroundColor: `${colors.primary}18` }]}>
            <Text style={[styles.pillText, { color: colors.primary }]}>{remainingLabel}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => clearMode.mutate()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Turn off destination mode"
          style={styles.clearBtn}
        >
          <Ionicons name="close" size={16} color={colors.onSurfaceVariant} />
        </Pressable>
      </GradientGlowBorder>
    );
  }

  const exhausted = mode.usesRemaining <= 0;

  return (
    <Pressable
      onPress={openPicker}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel="Set a destination to only get rides heading that way"
    >
      {/*
        THE FAINT GLOW. This is an earner, not a setting — a driver who never
        notices it drives home empty. It gets a thin brand ring at reduced
        intensity so it reads as lit without competing with the Create Trip
        button directly below it, which is the screen's hero and carries the
        same ring at full strength.
      */}
      <GradientGlowBorder
        palette="driver"
        fillColor={colors.surfaceContainerHigh}
        borderRadius={radii.xl}
        thickness="thin"
        glow
        glowIntensity={exhausted ? 0 : 0.6}
        disabled={exhausted}
        style={styles.card}
      >
        <View
          style={[
            styles.icon,
            { backgroundColor: exhausted ? `${colors.onSurfaceVariant}18` : `${colors.primary}1A` },
          ]}
        >
          <Ionicons
            name="navigate-outline"
            size={18}
            color={exhausted ? colors.onSurfaceVariant : colors.primary}
          />
        </View>
        {/*
          LAYOUT BUGFIX. The subtitle used to read "Only get rides heading your
          way · 2 of 2 left today" as one unbroken string in a `flex: 1` column
          with no `numberOfLines`. On a phone that is three wrapped lines, so
          the row grew to ~90 pt, the icon and chevron floated centred against a
          block of text, and the whole card sat unbalanced next to the fixed
          height ones around it. The allowance is now a pill of its own — the
          part a driver actually scans for — and both text lines are clamped, so
          the row is one predictable height whatever the copy says.
        */}
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            Set a destination
          </Text>
          <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1}>
            {exhausted ? 'Resets tomorrow' : 'Only get rides heading your way'}
          </Text>
        </View>
        <View
          style={[
            styles.pill,
            exhausted
              ? { borderColor: colors.outline }
              : { borderColor: `${colors.primary}55`, backgroundColor: `${colors.primary}18` },
          ]}
        >
          <Text
            style={[styles.pillText, { color: exhausted ? colors.onSurfaceVariant : colors.primary }]}
          >
            {exhausted ? '0 left' : `${mode.usesRemaining} left`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
      </GradientGlowBorder>
    </Pressable>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
    },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** `minWidth: 0` is what actually lets `numberOfLines` bite: without it a
     *  flex child refuses to shrink below its text's intrinsic width and the
     *  clamp never engages, which is how the subtitle wrapped in the first
     *  place. */
    body: { flex: 1, minWidth: 0, gap: 1 },
    pill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    pillText: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: Math.round(11 * 1.4),
    },
    title: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.35),
      color: colors.onSurface,
    },
    clearBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
    },
  });
