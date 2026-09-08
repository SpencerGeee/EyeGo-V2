import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  useReducedMotion,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { scheduleOnRN } from 'react-native-worklets';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Pressable, ChromeBlur, backgroundScrollPauseProps } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverConnection } from '../../stores/connection.store';

/**
 * ── THE SURFACE THE STOP TIMELINE LIVES ON ───────────────────────────────────
 *
 * A collapsible MAP PANE on top, the timeline scrolling under it, and one
 * action pinned to the bottom. Both driver trip screens wear this, so manage
 * and tracking are the same object in two states rather than two screens the
 * driver has to re-learn mid-shift.
 *
 * ── WHY A PANE AND NOT A SHEET ──────────────────────────────────────────────
 * The rider's surface is a sheet that rises over a full-bleed map, because a
 * passenger's map is the whole story and the sheet is a caption on it. A driver
 * inverts that: the list of stops is the story and the map is a reference they
 * glance at. A sheet over a map forces the driver to choose one or the other —
 * which is the reported symptom, "the map is shown just a little at the top and
 * the texts cover all the space".
 *
 * So the map gets a real, fixed share of the screen (42%), the timeline gets
 * the rest and scrolls independently, and the driver can DRAG the pane to trade
 * between them without either ever disappearing. Two detents, both useful:
 *
 *   PEEK (18%)  a strip — enough to see the next turn and the puck, when the
 *               driver is working through a long passenger list.
 *   OPEN (42%)  the default — a map you can actually navigate by.
 *
 * ── THE ACTION BAR ──────────────────────────────────────────────────────────
 * Pinned, outside the scroller, always exactly one primary action. The old
 * screens stacked four buttons in the panel and let the list push them off the
 * bottom, so the single most important control on the screen was the one most
 * likely to be out of view.
 */

const PEEK_FRACTION = 0.18;
const OPEN_FRACTION = 0.42;
/** Past this much drag, the pane commits to the other detent. */
const COMMIT_RATIO = 0.35;

export interface StopTimelineSurfaceProps {
  /** The live map. Rendered inside the pane, clipped to its rounded bottom. */
  map: React.ReactNode;
  /** Floats over the map — an ETA pill, a status chip. */
  mapOverlay?: React.ReactNode;
  /** The scrolling body. `StopTimeline`, plus whatever else the screen needs. */
  children: React.ReactNode;
  /** Pinned at the bottom. One action. */
  action?: React.ReactNode;
  /** Top-left control. Usually a back or close button. */
  onBack?: () => void;
  title?: string;
  subtitle?: string;
}

export function StopTimelineSurface({
  map,
  mapOverlay,
  children,
  action,
  onBack,
  title,
  subtitle,
}: StopTimelineSurfaceProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const connected = useDriverConnection((s) => s.connected);

  const PEEK = Math.round(height * PEEK_FRACTION);
  const OPEN = Math.round(height * OPEN_FRACTION);

  /** 0 = peek, 1 = open. A fraction, so the height is derived, never stored. */
  const open = useSharedValue(1);
  /** Where the drag started, so the gesture is relative and can be reversed. */
  const startOpen = useSharedValue(1);

  const tick = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  /**
   * The pane is dragged, so it settles on a SPRING carrying the finger's
   * velocity — a timing curve here restarts from zero and reads as the pane
   * being taken away from you. `overshootClamping` because the pane has a hard
   * edge at both detents and bouncing past one exposes the screen underneath.
   */
  const pan = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      startOpen.value = open.value;
    })
    .onUpdate((e) => {
      'worklet';
      const span = OPEN - PEEK;
      const next = startOpen.value + e.translationY / span;
      // Rubber-band rather than a hard stop: a pane that simply refuses to move
      // reads as broken, one that resists reads as at its limit.
      open.value = next < 0 ? next * 0.25 : next > 1 ? 1 + (next - 1) * 0.25 : next;
    })
    .onEnd((e) => {
      'worklet';
      const span = OPEN - PEEK;
      // Velocity OR distance — a flick is a decision even if it moved 20 pt.
      const flung = Math.abs(e.velocityY) > 600;
      const target = flung
        ? e.velocityY > 0
          ? 1
          : 0
        : open.value > startOpen.value
          ? open.value - startOpen.value > COMMIT_RATIO
            ? 1
            : Math.round(startOpen.value)
          : startOpen.value - open.value > COMMIT_RATIO
            ? 0
            : Math.round(startOpen.value);

      if (target !== Math.round(startOpen.value)) scheduleOnRN(tick);
      open.value = withSpring(target, {
        duration: 320,
        dampingRatio: 0.82,
        velocity: e.velocityY / span,
        overshootClamping: true,
      });
    });

  const paneStyle = useAnimatedStyle(() => ({
    height: PEEK + (OPEN - PEEK) * Math.max(-0.2, Math.min(1.2, open.value)),
  }));

  /** The overlay fades out as the pane closes — there is no room for it. */
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : interpolate(open.value, [0.25, 0.7], [0, 1], Extrapolation.CLAMP),
  }));

  const toggle = useCallback(() => {
    tick();
    const next = open.value > 0.5 ? 0 : 1;
    open.value = reduced
      ? withTiming(next, { duration: 160, easing: Easing.bezier(0.23, 1, 0.32, 1) })
      : withSpring(next, { duration: 340, dampingRatio: 0.82, overshootClamping: true });
  }, [open, reduced, tick]);

  return (
    <View style={styles.root}>
      {/*
        THE MAP PANE.

        `height` rather than a transform, and this is the documented exception
        to that rule: the pane is a layout container whose sibling must take the
        remaining space, so a transform would slide it over the list instead of
        resizing against it. It has no children competing for layout — the map
        is absolutely filled inside it — so the Yoga pass is one node deep.
      */}
      <Animated.View style={[styles.pane, paneStyle]}>
        <View style={StyleSheet.absoluteFill}>{map}</View>

        <Animated.View style={[styles.mapOverlay, overlayStyle]} pointerEvents="box-none">
          {mapOverlay}
        </Animated.View>

        {/* Chrome sits ON the map, so it needs its own reading ground. */}
        <View style={[styles.topChrome, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={styles.chromeBtn}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChromeBlur style={StyleSheet.absoluteFill} fallbackColor={colors.surfaceContainerHigh} />
              <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
            </Pressable>
          ) : (
            <View style={styles.chromeBtn} />
          )}

          {title ? (
            <View style={styles.titleWrap} pointerEvents="none">
              <ChromeBlur style={StyleSheet.absoluteFill} fallbackColor={colors.surfaceContainerHigh} />
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/*
            The connection state, where the driver already is. It used to live
            in the panel, which is the half of the screen they are not looking
            at when it matters — a driver notices a dead socket by the map
            failing to move.
          */}
          {!connected ? (
            <View style={styles.offline} pointerEvents="none">
              <ChromeBlur style={StyleSheet.absoluteFill} fallbackColor={colors.surfaceContainerHigh} />
              <Ionicons name="cloud-offline-outline" size={15} color={colors.statusWarning} />
            </View>
          ) : (
            <View style={styles.chromeBtn} />
          )}
        </View>

        {/*
          The grab handle. A 44 pt strip, not a 4 pt bar — the bar is the
          affordance, the strip is the target, and on a phone in a cradle the
          difference is whether the gesture works at arm's length.
        */}
        <GestureDetector gesture={pan}>
          <Animated.View style={styles.grabStrip}>
            <Pressable
              onPress={toggle}
              style={styles.grabHit}
              accessibilityRole="button"
              accessibilityLabel="Resize the map"
            >
              <View style={styles.grabBar} />
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Animated.View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: (action ? 96 : 0) + insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        {...backgroundScrollPauseProps}
      >
        {children}
      </ScrollView>

      {action ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md }]}>
          {/* Opaque, not glass: the list scrolls under it and a translucent bar
              over moving text is unreadable exactly when it matters. */}
          <View style={styles.actionFill} pointerEvents="none" />
          {action}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep },

    pane: {
      overflow: 'hidden',
      borderBottomLeftRadius: radii['2xl'],
      borderBottomRightRadius: radii['2xl'],
      backgroundColor: colors.surfaceDim,
    },
    mapOverlay: {
      position: 'absolute',
      left: spacing.base,
      right: spacing.base,
      bottom: spacing['3xl'],
    },

    topChrome: {
      position: 'absolute',
      left: spacing.base,
      right: spacing.base,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    chromeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    titleWrap: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: spacing.base,
      paddingVertical: 6,
      borderRadius: radii.full,
      overflow: 'hidden',
    },
    title: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
    },
    offline: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },

    grabStrip: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 32,
      justifyContent: 'flex-end',
    },
    grabHit: {
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    grabBar: {
      width: 44,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.onSurfaceVariant,
      opacity: 0.55,
      marginBottom: 8,
    },

    list: { flex: 1 },
    listContent: {
      paddingHorizontal: spacing.base,
      paddingTop: spacing.lg,
    },

    actionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
    },
    actionFill: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.backgroundDeep,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
  });
