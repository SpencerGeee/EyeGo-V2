import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { springs } from '@eyego/config';
import { usePanelMotion, type PanelState } from './usePanelMotion';
import { useSheetMetrics, type SheetMetrics } from './sheetMetrics';

/**
 * THE ONE SHEET.
 *
 * A single bottom surface that never unmounts and never swaps: content changes
 * inside it, and the sheet itself deforms to fit. This is the difference
 * between a flow that reads as one continuous object and a flow that reads as a
 * series of cards being dealt.
 *
 * ── WHY translateY AND NOT height ───────────────────────────────────────────
 *
 * The obvious implementation animates the sheet's `height`. It is also the
 * wrong one, and this codebase has already paid for finding that out: an
 * earlier morph wrote `left/top/width/height` from an animated style every
 * frame and forced a full layout pass per frame, which is what made it feel
 * heavy on mid-range Android. Reanimated can animate layout props, but every
 * frame it does costs a Yoga pass over the subtree — and the subtree here is an
 * entire booking stage.
 *
 * So the sheet is a screen-tall container translated down until only the part
 * it wants to show is above the fold. `translateY` is a transform: composited,
 * never re-laying-out a single child, and the visible result is identical — the
 * top edge moves and the corners move with it. The measured content decides
 * WHERE that edge goes; a spring decides how it gets there.
 *
 * ── WHY IT REUSES usePanelMotion ────────────────────────────────────────────
 *
 * A content-sized sheet still needs a gesture: the tracking panel shows a
 * summary at rest and its full detail when pulled up, and the arbitration
 * between that pull and the inner scroll view is genuinely difficult. That
 * engine already exists and is already correct, so the sheet drives its `y`
 * rather than growing a second, worse copy. The only thing added here is that
 * the resting stop is MEASURED instead of declared, and re-snapped whenever the
 * content changes size — which is what turns a fixed-detent panel into one that
 * morphs.
 *
 * ── THE GHOST ────────────────────────────────────────────────────────────────
 *
 * During a stage change two contents exist at once. Only the incoming one may
 * participate in layout — if both did, the measured height would be the union
 * of the two and the sheet would visibly bulge mid-transition. The outgoing one
 * is handed in as `ghost` and rendered absolutely over the same origin:
 * visible, fading, weightless.
 */

/**
 * The container-transform token — the same spring MorphTarget uses to grow a
 * card into a surface, and deliberately also the one handed to the gesture
 * engine below. ζ = 1.0 at response ≈ 0.45 s: critically damped, so the sheet
 * edge cannot overshoot its stop and bounce, which on a surface this large
 * reads as wobble rather than as life. Sharing one token across the morph, the
 * resize and the flick-release is what makes them read as one object behaving
 * consistently instead of three animations that happen to be adjacent.
 */
export const MORPH_SHEET_SPRING: WithSpringConfig = springs.morph;

export interface MorphSheetProps {
  children: React.ReactNode;
  /**
   * The outgoing content during a transition. Rendered over the same origin,
   * excluded from layout, non-interactive.
   */
  ghost?: React.ReactNode;
  /** Fill drawn behind the content — a glass surface, a gradient, a flat view. */
  background?: React.ReactNode;
  /** Fraction of the screen the sheet may never exceed. */
  maxHeightPct?: number;
  /**
   * Resting height as a fraction of the screen, for sheets that show a summary
   * and reveal the rest on a pull. Omit for a sheet that is simply as tall as
   * its content — which is the right default, and what makes the flow morph.
   */
  collapsedHeightPct?: number;
  /** Corner radius of the sheet's top edge. Animated, so stages may differ. */
  radius?: number;
  /** Show the drag affordance. */
  grabber?: boolean;
  grabberColor?: string;
  /** Wrap the content in an arbitrated scroll view. Defaults to on when a
   *  collapsed stop exists, since that is the case where content is clipped. */
  scrollable?: boolean;
  /** Styles the sheet body (padding, background when `background` is unused). */
  style?: StyleProp<ViewStyle>;
  /** Channel to publish the top edge on. Defaults to the nearest provider. */
  metrics?: SheetMetrics;
  /**
   * Slide up from off-screen on first mount. Set false when an outer morph
   * (MorphTarget) already owns the entrance, so the two do not both animate.
   */
  animateOnMount?: boolean;
  spring?: WithSpringConfig;
  /** Extra px kept clear above the sheet, on top of the status-bar inset. */
  topInset?: number;
  onStateChange?: (state: PanelState) => void;
  testID?: string;
}

export function MorphSheet({
  children,
  ghost,
  background,
  maxHeightPct = 0.86,
  collapsedHeightPct,
  radius = 28,
  grabber = true,
  grabberColor = 'rgba(255,255,255,0.18)',
  scrollable,
  style,
  metrics: metricsProp,
  animateOnMount = true,
  spring = MORPH_SHEET_SPRING,
  topInset = 0,
  onStateChange,
  testID,
}: MorphSheetProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contextMetrics = useSheetMetrics();
  const metrics = metricsProp ?? contextMetrics;

  /** Highest the sheet's top edge is ever allowed to go. */
  const minTop = Math.max(insets.top + topInset, Math.round(screenH * (1 - maxHeightPct)));

  const [contentH, setContentH] = useState(0);

  /**
   * Measurement is state, and state is a render — so it must not happen every
   * frame. It does not: `onLayout` fires when the content's own layout changes
   * (a stage swap, a list growing by a row), never during the translate. That
   * is the entire reason the edge is moved with a transform.
   */
  const onBodyLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    // Sub-pixel layout noise would otherwise re-render and restart the spring.
    setContentH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
  };

  /** Where the top edge sits when the sheet is showing everything it can. */
  const expandedTop = useMemo(
    () => (contentH <= 0 ? screenH : Math.max(minTop, screenH - contentH)),
    [contentH, screenH, minTop],
  );
  const collapsedTop = useMemo(() => {
    if (collapsedHeightPct == null) return undefined;
    const top = Math.round(screenH * (1 - collapsedHeightPct));
    // A collapsed stop below the expanded one is a contradiction — content
    // shorter than the declared summary height. Collapse to the content.
    return Math.max(top, expandedTop);
  }, [collapsedHeightPct, screenH, expandedTop]);

  const restingState: PanelState = collapsedTop != null ? 'collapsed' : 'expanded';

  const { y, panGesture, nativeGesture, scrollHandler, snapToState, panelState } = usePanelMotion({
    snapPoints: { hidden: screenH, collapsed: collapsedTop, expanded: expandedTop },
    initialState: animateOnMount ? 'hidden' : restingState,
    dismissible: false,
    spring,
    onStateChange,
  });

  /**
   * Publish the edge. A reaction rather than a write inside the spring, because
   * the edge is also moved by the finger — and a gesture-driven position has no
   * spring callback to hang a publish on. This runs on the UI thread every time
   * the value changes, from whichever source.
   */
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

  /**
   * The re-snap. This is what makes it a morph rather than a panel: whenever
   * the measured content changes — a new stage's body, a fare row arriving, an
   * ETA appearing — the stop moves and the sheet springs to it, keeping
   * whichever state the rider had it in.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (contentH <= 0) return;
    if (!settled.current) {
      settled.current = true;
      snapToState(restingState);
      return;
    }
    // A sheet the rider has pulled open stays open; one at rest re-fits.
    snapToState(panelState === 'expanded' ? 'expanded' : restingState);
    // `panelState` is deliberately not a dependency: re-snapping every time the
    // engine reports a state change would fight the gesture that caused it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTop, collapsedTop, restingState, snapToState, contentH]);

  // Unmount is a real event for the channel: a map still reading a stale top
  // edge pads for a sheet that is no longer there.
  useEffect(() => {
    metrics.retired.value = false;
    return () => {
      metrics.retired.value = true;
      metrics.top.value = metrics.screenHeight.value;
    };
  }, [metrics]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  const animatedRadius = useSharedValue(radius);
  useEffect(() => {
    animatedRadius.value = withSpring(radius, spring);
  }, [radius, animatedRadius, spring]);

  const bodyStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius: animatedRadius.value,
    borderTopRightRadius: animatedRadius.value,
  }));

  /**
   * PADDING BELONGS TO THE CONTENT, NOT TO THE SURFACE.
   *
   * BUGFIX ("on the rider tracking page there's things cut out on the left and
   * right sides of the card — it's clipping the glow-border card and all that").
   *
   * This is the same defect an earlier pass tried to fix by MOVING the aurora
   * from the stage into this component, and it did not work, because the cause
   * was never where the node lived. In React Native an absolutely positioned
   * child — `StyleSheet.absoluteFill`, which is what `background`, `GlassSurface`
   * and `CardAuroraGlow` all use — is laid out against its parent's PADDING box,
   * not its border box. The sheet body carries `paddingHorizontal: 32` from the
   * caller, so the glass and the glow painted into a rectangle inset 32 pt from
   * each side of a full-width sheet, and a gradient that stops dead at a rect
   * edge leaves exactly the two hard vertical seams reported.
   *
   * So the padding comes off the surface and goes onto a plain content wrapper
   * one level in. The body keeps its radius, its fill and its `overflow: hidden`
   * — it is the surface — and the background layers now reach its real edges,
   * clipped only by the rounded corners, which is what a card edge should be.
   * Everything else measures the same: the wrapper still contributes the padding
   * to the body's height, so `onBodyLayout` and the resting stop are unchanged.
   */
  const flattened = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const sheetBox: Record<string, unknown> = {};
  const contentPadding: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flattened)) {
    if (k.startsWith('padding')) contentPadding[k] = v;
    else sheetBox[k] = v;
  }

  const isScrollable = scrollable ?? collapsedTop != null;
  const contentMaxH = screenH - minTop;

  /**
   * THE GUTTER GOES INSIDE THE SCROLL VIEW, NOT AROUND IT.
   *
   * BUGFIX ("the card with the driver name and car has its glow border cut off
   * at the sides so it's not fully glowing" — the arrived-at-pickup card).
   *
   * An earlier pass moved the caller's padding off the sheet surface and onto a
   * content wrapper, which fixed the background layers. It did not fix this,
   * because a `ScrollView` CLIPS TO ITS OWN BOUNDS — `clipsToBounds` on iOS,
   * the content-view clip on Android — and the scroll view was the child of the
   * padded wrapper. Its viewport was therefore exactly the content width, a
   * full-bleed card inside it touched both edges, and the card's glow, which is
   * a shadow drawn OUTSIDE its own box, had nowhere to go sideways. Cut off at
   * the left and right, intact at the top and bottom, which is exactly the
   * shape of the report: vertically the scroll view has slack, horizontally it
   * has none.
   *
   * So the horizontal half of the gutter is handed to the scroll view's
   * CONTENT container: the viewport now spans the whole sheet, the content is
   * still inset by the same amount, nothing moves, and a 32 pt corridor opens
   * on each side of every card for its glow to bleed into. Vertical padding
   * stays on the wrapper so the measured height that decides the resting stop
   * is unchanged.
   */
  const horizontalPadding: Record<string, unknown> = {};
  const verticalPadding: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(contentPadding)) {
    if (/^padding(Horizontal|Left|Right|Start|End)$/.test(k)) horizontalPadding[k] = v;
    else verticalPadding[k] = v;
  }

  /**
   * THE SAME CORRIDOR, ON THE TOP EDGE.
   *
   * BUGFIX ("the Verify Your Ride card seems to be cut off at the top — I'm
   * talking about the glow border and all").
   *
   * The note above fixed the sides by handing the horizontal gutter to the
   * scroll view's CONTENT container. The top was left alone, and it has the
   * identical problem for the identical reason: a scroll view clips to its own
   * bounds, the first child sits at content offset 0, and a glow is a shadow
   * drawn OUTSIDE the child's box — so it has nowhere to go upward.
   *
   * It was invisible until now only because the first child of every other
   * stage is plain text, which has no glow to lose. The pin card is the first
   * card in the app to be both glowing AND first, so it is the first to be
   * clipped along its top edge.
   *
   * The corridor is a floor, not an override: a caller that already asks for
   * more top padding keeps it. Twenty points clears `maxGlowRadius: 16` with a
   * margin, and it is added to the CONTENT container so it scrolls with the
   * content rather than freezing a gap under the grabber.
   */
  const GLOW_CORRIDOR = 20;
  const topPadding = Math.max(
    GLOW_CORRIDOR,
    Number(verticalPadding.paddingTop ?? verticalPadding.paddingVertical ?? 0) || 0,
  );
  // Handed to `inner`, so it must not also be applied by the outer wrapper —
  // otherwise the gap doubles and the sheet's resting stop moves with it.
  const outerVerticalPadding = { ...verticalPadding };
  delete outerVerticalPadding.paddingTop;
  delete outerVerticalPadding.paddingVertical;
  if (verticalPadding.paddingVertical != null && verticalPadding.paddingBottom == null) {
    outerVerticalPadding.paddingBottom = verticalPadding.paddingVertical;
  }

  const inner = isScrollable ? (
    <GestureDetector gesture={nativeGesture}>
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: contentMaxH }}
        contentContainerStyle={{
          ...horizontalPadding,
          paddingTop: topPadding,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        {children}
      </Animated.ScrollView>
    </GestureDetector>
  ) : (
    /* The home-indicator inset is applied here rather than on the body, so a
       caller styling the body's padding cannot delete it and put a CTA under
       the gesture bar. */
    <View
      style={{
        ...horizontalPadding,
        paddingTop: topPadding,
        maxHeight: contentMaxH,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
      pointerEvents="box-none"
    >
      {children}
    </View>
  );


  return (
    /* `box-none` all the way down: this container is screen-tall and sits over
       the map, so without it every pan and pinch would land on empty sheet
       instead of on the map — the exact "the map is frozen but the card moves"
       failure the trip surface hit before. */
    <View style={styles.overlay} pointerEvents="box-none" testID={testID}>
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[styles.container, { height: screenH }, containerStyle]}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.body, bodyStyle, sheetBox]} onLayout={onBodyLayout}>
            {/* Unpadded, and that is the entire point — see `sheetBox`. */}
            {background}
            {grabber && <View style={[styles.grabber, { backgroundColor: grabberColor }]} />}
            {/* Vertical gutter only — the horizontal half lives inside `inner`
                so a scroll view cannot clip a card's glow. See above. */}
            <View style={outerVerticalPadding} pointerEvents="box-none">
              {inner}
              {/* Weightless: absolutely positioned, so it contributes nothing to
                  the measured height that decides where the top edge sits. */}
              {ghost != null && (
                <View style={styles.ghost} pointerEvents="none">
                  {ghost}
                </View>
              )}
            </View>
          </Animated.View>
          {/* Fills the screen below the body so an over-travelled spring or a
              device with a tall safe area never shows map through the bottom. */}
          <View style={[styles.tail, style, styles.tailReset]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  container: { position: 'absolute', left: 0, right: 0, top: 0 },
  // No padding here, by design — this view is the SURFACE, and an absolutely
  // positioned child (the background layers) is laid out against its padding
  // box. The grabber carries its own top gap instead of taking it from here.
  body: {
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 12,
  },
  ghost: { position: 'absolute', left: 0, right: 0, top: 0 },
  tail: { height: 120, marginTop: -1 },
  tailReset: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
    paddingBottom: 0,
    maxHeight: undefined,
  },
});
