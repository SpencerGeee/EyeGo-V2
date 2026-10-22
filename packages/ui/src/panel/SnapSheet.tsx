import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { springs } from '@eyego/config';
import { useSheetMetrics } from './sheetMetrics';

/**
 * ── THE SNAP SHEET — ONE CARD SYSTEM FOR BOTH APPS ──────────────────────────
 *
 * BUGFIX ("moving between snap points of the card there's no animation";
 * "fully extended, there's this cut-out on the sides of the glow border";
 * "the same affects the driver dispatch cards").
 *
 * The old 3-snap cards (`useSnapCard`) were React state: a snap change swapped
 * which rows were rendered, and the panel jumped to the new height while the
 * finger had only nudged a 56 pt rubber band. Nothing moved WITH the hand,
 * because there was nothing to move — the content of the next snap did not
 * exist until the drag ended. And the full snap wrapped everything in a
 * ScrollView that clipped every glow at its own edge.
 *
 * Uber, Bolt, Apple Maps and Google Maps all do the opposite, and this is
 * that: the WHOLE card is laid out once, and the sheet is a screen-tall
 * surface translated down so only the top part shows. A detent is just a
 * translateY, measured from where a section actually ends:
 *
 *   peek  — the grabber + `peek`              (the two-second read)
 *   half  — + `half`                          (the trip, the actions)
 *   full  — + `children`, capped, scrollable  (everything else)
 *
 * The finger moves the surface 1:1, release picks a detent from position and
 * velocity, and a critically damped spring carries the fling — so every snap
 * is the same physical object travelling, never a re-render. The `footer`
 * (the CTA, the swipe) is pinned to the bottom at every detent, which is why
 * it can never be pushed off-screen or scroll away.
 *
 * Transform-only, measured with onLayout (fires on content change, never per
 * frame), and box-none so the map behind it keeps every pan.
 */

export interface SnapSheetProps {
  /** Always visible. Its bottom edge is the first detent. */
  peek: React.ReactNode;
  /** Revealed by the second detent. Omit for a two-detent sheet. */
  half?: React.ReactNode;
  /** Revealed at full. Scrolls when taller than the sheet may be. */
  children?: React.ReactNode;
  /** Pinned under the content at every detent — the primary action. */
  footer?: React.ReactNode;
  /** Painted behind everything, reaching the sheet's real edges (glass, aurora). */
  background?: React.ReactNode;
  /** Drawn along the top edge, above the grabber (e.g. a countdown rail). */
  topEdge?: React.ReactNode;
  /** Detent to open on: 0 = peek. */
  initial?: number;
  /** Detent requested by the screen (a "show more" link). Changes are honoured. */
  detent?: number;
  onDetentChange?: (detent: number) => void;
  radius?: number;
  /** The sheet's fill — under `background`, and the footer's and tail's fill. */
  backgroundColor?: string;
  grabberColor?: string;
  /** Horizontal gutter — applied INSIDE the scroll so glows have room. */
  gutter?: number;
  /** Space between the rows of each section. */
  gap?: number;
  /** Highest the top edge may go, as a fraction of the screen. */
  maxHeightPct?: number;
  /** Slide up from below on mount. */
  animateOnMount?: boolean;
  /** Surface styling (border, shadow). Never padding: see `gutter`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Room a glow ring may bleed into before a clipping edge (maxGlowRadius 16 + margin). */
const GLOW_CORRIDOR = 20;
const GRAB_H = 26;
const FLICK = 900;
const PROJECT = 0.15;
const RUBBER = 0.14;

export function SnapSheet({
  peek,
  half,
  children,
  footer,
  background,
  topEdge,
  initial = 0,
  detent,
  onDetentChange,
  radius = 28,
  backgroundColor,
  grabberColor = 'rgba(255,255,255,0.22)',
  gutter = 20,
  gap = 14,
  maxHeightPct = 0.88,
  animateOnMount = true,
  style,
  testID,
}: SnapSheetProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const metrics = useSheetMetrics();

  const [peekH, setPeekH] = useState(0);
  const [halfH, setHalfH] = useState(0);
  const [restH, setRestH] = useState(0);
  const [footH, setFootH] = useState(0);
  const measure = (set: (n: number) => void) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    set(h);
  };

  const minTop = Math.max(insets.top + 8, Math.round(screenH * (1 - maxHeightPct)));
  // Padding a footer-less sheet keeps clear of the home indicator.
  const tailPad = footer ? 0 : Math.max(insets.bottom, 12);
  const chrome = GRAB_H + GLOW_CORRIDOR - 8;

  /** Detent tops, highest last: [peek, half?, full]. */
  const stops = useMemo(() => {
    if (peekH <= 0) return [screenH];
    const base = screenH - footH - tailPad - chrome;
    const s0 = base - peekH;
    const s1 = half ? s0 - halfH - (halfH > 0 ? gap : 0) : s0;
    const s2 = Math.max(minTop, s1 - restH - (restH > 0 ? gap : 0));
    const out = [Math.max(minTop, s0)];
    if (half && s1 < out[out.length - 1] - 4) out.push(Math.max(minTop, s1));
    if (s2 < out[out.length - 1] - 4) out.push(s2);
    return out;
  }, [peekH, halfH, restH, footH, tailPad, chrome, screenH, minTop, half, gap]);

  const y = useSharedValue(screenH);
  const placed = useSharedValue(false);
  const startY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const idx = useSharedValue(Math.min(initial, 2));
  const stopsSV = useSharedValue(stops);
  const [current, setCurrent] = useState(Math.min(initial, 2));

  const report = useCallback(
    (i: number) => {
      setCurrent(i);
      onDetentChange?.(i);
    },
    [onDetentChange],
  );
  const tick = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
  }, []);

  // Re-fit whenever a section changes size: same detent, new height — the
  // sheet travels to it on the spring rather than jumping.
  useEffect(() => {
    stopsSV.value = stops;
    if (peekH <= 0) return;
    const i = Math.min(idx.value, stops.length - 1);
    idx.value = i;
    // The first fit lands in place when an outer transition owns the entrance.
    y.value = !placed.value && !animateOnMount ? stops[i] : withSpring(stops[i], springs.emphasized);
    placed.value = true;
  }, [stops, peekH, stopsSV, idx, y, placed, animateOnMount]);

  // A screen asking for a detent (a "more" link, a state that needs room).
  useEffect(() => {
    if (detent == null || peekH <= 0) return;
    const i = Math.max(0, Math.min(detent, stops.length - 1));
    idx.value = i;
    y.value = withSpring(stops[i], springs.emphasized);
    report(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent, peekH]);

  useAnimatedReaction(
    () => y.value,
    (top) => {
      metrics.top.value = top;
    },
    [metrics],
  );
  useEffect(() => {
    metrics.screenHeight.value = screenH;
  }, [metrics, screenH]);
  useEffect(() => {
    metrics.retired.value = false;
    return () => {
      metrics.retired.value = true;
      metrics.top.value = metrics.screenHeight.value;
    };
  }, [metrics]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });
  const nativeGesture = useMemo(() => Gesture.Native(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .simultaneousWithExternalGesture(nativeGesture)
        .activeOffsetY([-6, 6])
        .onStart(() => {
          startY.value = y.value;
        })
        .onUpdate((e) => {
          const s = stopsSV.value;
          const top = s[s.length - 1];
          // At full with the list scrolled, the list owns the drag; re-anchor
          // so a pull past its top hands over without a seam.
          if (idx.value === s.length - 1 && scrollY.value > 1) {
            startY.value = top - e.translationY;
            y.value = top;
            return;
          }
          const raw = startY.value + e.translationY;
          const low = s[0];
          let next = raw;
          if (raw < top) next = top - (top - raw) * RUBBER;
          if (raw > low) next = low + (raw - low) * RUBBER;
          y.value = next;
        })
        .onEnd((e) => {
          const s = stopsSV.value;
          let i = idx.value;
          if (Math.abs(e.velocityY) > FLICK) {
            i = e.velocityY < 0 ? Math.min(s.length - 1, i + 1) : Math.max(0, i - 1);
            // A hard fling from peek goes all the way, like the platform sheets.
            if (Math.abs(e.velocityY) > FLICK * 2.2) i = e.velocityY < 0 ? s.length - 1 : 0;
          } else {
            const p = y.value + e.velocityY * PROJECT;
            let best = 0;
            for (let k = 1; k < s.length; k++) if (Math.abs(s[k] - p) < Math.abs(s[best] - p)) best = k;
            i = best;
          }
          if (i !== idx.value) runOnJS(tick)();
          idx.value = i;
          y.value = withSpring(s[i], { ...springs.emphasized, velocity: e.velocityY });
          runOnJS(report)(i);
        }),
    [nativeGesture, startY, y, stopsSV, idx, scrollY, report, tick],
  );

  // Tap on the grabber: step up; from the top, fold back to peek.
  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        const s = stopsSV.value;
        const i = idx.value >= s.length - 1 ? 0 : idx.value + 1;
        idx.value = i;
        y.value = withSpring(s[i], springs.emphasized);
        runOnJS(tick)();
        runOnJS(report)(i);
      }),
    [stopsSV, idx, y, report, tick],
  );

  const surfaceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const atFull = current >= stops.length - 1;
  const scrollMax = screenH - minTop - footH - tailPad - chrome + GLOW_CORRIDOR;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={testID}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.surface, { height: screenH }, surfaceStyle]} pointerEvents="box-none">
          <View
            style={[
              styles.body,
              { borderTopLeftRadius: radius, borderTopRightRadius: radius },
              backgroundColor ? { backgroundColor } : null,
              style,
            ]}
          >
            {background}
            {topEdge}
            <GestureDetector gesture={tap}>
              <View style={styles.grabZone} accessible accessibilityRole="button" accessibilityLabel={atFull ? 'Show less' : 'Show more'}>
                <View style={[styles.grabber, { backgroundColor: grabberColor }]} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={nativeGesture}>
              <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                scrollEnabled={atFull}
                bounces={false}
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: scrollMax }}
                // The gutter lives on the CONTENT, so the viewport spans the
                // whole sheet and a card's glow has a corridor on every side.
                contentContainerStyle={{
                  paddingHorizontal: gutter,
                  paddingTop: GLOW_CORRIDOR - 8,
                  paddingBottom: footH + tailPad + GLOW_CORRIDOR,
                  gap,
                }}
              >
                <View onLayout={measure(setPeekH)} style={{ gap }}>{peek}</View>
                {half ? <View onLayout={measure(setHalfH)} style={{ gap }}>{half}</View> : null}
                {children ? <View onLayout={measure(setRestH)} style={{ gap }}>{children}</View> : null}
              </Animated.ScrollView>
            </GestureDetector>
          </View>
          {/* Below the body, so an over-travelled spring never shows map. */}
          <View style={[styles.tail, backgroundColor ? { backgroundColor } : null]} />
        </Animated.View>
      </GestureDetector>

      {footer ? (
        <View
          onLayout={measure(setFootH)}
          style={[
            styles.footer,
            { paddingHorizontal: gutter, paddingBottom: Math.max(insets.bottom, 12) },
            backgroundColor ? { backgroundColor } : null,
          ]}
        >
          {background ? <View style={StyleSheet.absoluteFill} pointerEvents="none">{background}</View> : null}
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { position: 'absolute', left: 0, right: 0, top: 0 },
  body: { overflow: 'hidden' },
  grabZone: { height: GRAB_H, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  tail: { flex: 1, marginTop: -1 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, overflow: 'hidden' },
});
