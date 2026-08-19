import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  cancelAnimation,
  runOnJS,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import { springs, durations } from '@eyego/config';
import { useThemedColors } from '../ColorsContext';
import { usePerformanceTier } from '../effects/usePerformanceTier';

export interface MorphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a MorphSource registers so the provider can fly a clone of it. */
export interface MorphSourceEntry {
  measure: () => Promise<MorphRect | null>;
  /**
   * Best-effort synchronous re-measure, used by `morphBack` — the reverse flight
   * has to know where the source sits NOW (the screen underneath stayed live and
   * may have scrolled), and it cannot await a promise without dropping a frame
   * between the clone appearing and the spring starting. Returns null when no
   * fresh measurement is available, in which case the caller keeps the rect
   * captured on the way out.
   */
  measureSync?: () => MorphRect | null;
  getClone: () => React.ReactNode;
  borderRadius: number;
  backgroundColor?: string;
  hide: () => void;
  show: () => void;
}

type MorphPhase = 'idle' | 'forward' | 'settled' | 'reverse' | 'gesture';

interface MorphContextValue {
  registerSource: (id: string, entry: MorphSourceEntry) => () => void;
  morphTo: (id: string, navigate: () => void) => void;
  morphBack: (navigateBack: () => void) => void;
  targetReady: (id: string, rect: MorphRect, borderRadius: number) => void;
  /**
   * Yango-style gesture-interruptible reverse. Call from a PanGestureHandler's
   * onStart/onActive/onEnd to drive the morph progress. Exposed so target
   * screens can mount a MorphBackSwipeDetector or custom gesture handler.
   *
   * - onStart: cancel any running spring so the gesture takes over
   * - onActive(dy): set morphProgress based on drag Y (0 = fully reversed)
   * - onEnd(velocityY, commit): if past threshold, spring to 0 && call commit;
   *   else spring back to 1
   */
  startMorphBackGesture: (onCommit: () => void) => MorphBackGestureHandle;
  activeId: string | null;
  phase: MorphPhase;
  /**
   * 0 = clone sitting on the source, 1 = clone landed on the target. Exposed so
   * MorphTarget can reveal the real destination content DURING the flight
   * rather than after it — without this the destination only appeared once the
   * spring had already settled, which is what made every morph read as a fade.
   */
  morphProgress: SharedValue<number>;
}

export interface MorphBackGestureHandle {
  onStart: () => void;
  onActive: (translationY: number) => void;
  onEnd: (velocityY: number) => void;
}

const MorphContext = createContext<MorphContextValue | null>(null);

export function useMorph() {
  const ctx = useContext(MorphContext);
  if (!ctx) throw new Error('useMorph must be used inside <MorphProvider>');
  return ctx;
}

/** Non-throwing variant for components that may render outside the provider. */
export function useMorphOptional() {
  return useContext(MorphContext);
}

/**
 * If the destination never mounts a MorphTarget, dissolve the clone.
 *
 * WHY THIS CAME DOWN FROM 700 ms. Nothing moves until `targetReady` fires, so
 * for a destination with no MorphTarget at all — and there are several: a
 * service card whose route is an ordinary screen — this timeout WAS the
 * animation. The rider tapped, the clone froze on the source for the better
 * part of a second, and then faded. That is most of "some are super laggy", and
 * it is indistinguishable from the app having hung.
 *
 * The budget is only ever spent waiting for a target that is coming. Since
 * MorphTarget now reports SYNCHRONOUSLY on its first layout pass (see the note
 * on its `onLayout`), a screen that has one answers within a frame or two of
 * mounting, and 450 ms is still generous for a heavy destination. A screen that
 * does not have one now degrades in a quarter of the time.
 */
const TARGET_TIMEOUT_MS = 450;
/** Cross-fade window between the clone and the real target content — 200ms
 *  (up from 120ms) so the eye registers the real content before the clone
 *  disappears, avoiding the previous "flash" feel. */
const CROSSFADE_MS = 200;
/** Pixels of drag needed to fully reverse the morph (Yango: ~250–300). */
const GESTURE_FULL_REVERSE_DIST = 280;
/** Progress below this threshold commits the back-navigation on release. */
const GESTURE_COMMIT_THRESHOLD = 0.4;
/** Release velocity (px/s) that forces commit regardless of progress. */
const GESTURE_VELOCITY_THRESHOLD = 500;

/**
 * Fraction of the flight over which the cloned SOURCE content fades out, and
 * the window over which the real DESTINATION content fades in (MorphTarget
 * reads these too). They overlap deliberately — a hard handover at a single
 * point reads as a cut, and no overlap at all reads as two separate fades.
 */
export const CONTENT_FADE_OUT_END = 0.32;
export const CONTENT_FADE_IN_START = 0.28;
export const CONTENT_FADE_IN_END = 0.78;

/**
 * Container-transform ("morph") primitive — Yango-style.
 *
 * Architecture (progress-driven, gesture-interruptible):
 * ------------------------------------------------------------------------
 * The overlay position is derived from `morphProgress` (0→1 shared value),
 * interpolating between the source and target rects. This lets both spring
 * animations AND gesture input drive the same progress value, giving
 * interruptible, velocity-aware morphs with zero positional snap.
 *
 * Forward:  measure source → mount clone at source frame → navigate →
 *           target mounts → springs morphProgress 0→1 → crossfade
 * Reverse:  re-mount clone → springs morphProgress 1→0 → unmount
 * Gesture:  gesture handler cancels the spring → drives progress directly →
 *           on end, snaps to 0 (reverse) or 1 (forward) based on
 *           velocity + position threshold
 */
export function MorphProvider({ children }: { children: React.ReactNode }) {
  const colors = useThemedColors();
  const tier = usePerformanceTier();
  const reducedMotion = useReducedMotion();

  const sources = useRef(new Map<string, MorphSourceEntry>());

  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<MorphPhase>('idle');
  const [cloneNode, setCloneNode] = useState<React.ReactNode>(null);
  const [cloneBg, setCloneBg] = useState<string | undefined>(undefined);

  /**
   * The clone's FIXED layout frame, held in React state rather than re-derived
   * inside the animated style.
   *
   * SMOOTHNESS FIX: the animated style used to assign `left`, `top`, `width`
   * and `height` on every single frame. Those are layout properties — even when
   * the value written is identical frame to frame, Reanimated pushes the whole
   * style object through the native layout path, so each of the ~60 frames of a
   * morph dirtied the layout of a full-screen view and its subtree. That is a
   * measure/layout pass per frame on top of the transform, and it is what kept
   * the morph from ever feeling buttery no matter how the timing was tuned.
   *
   * These values only change twice per flight (when the clone mounts, and when
   * the target reports its frame), so they belong in state. The animated style
   * is now transform + opacity + borderRadius only — all compositor-side.
   */
  const [frame, setFrame] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  /**
   * The SOURCE element's size — the layout size the cloned content is rendered
   * at, which is a different thing from the container's `frame`.
   *
   * BUGFIX ("coming back from where-to the field goes blurry and messed up for
   * a second before snapping to the real field"): the clone content used to be
   * laid out at `frame` — i.e. at the TARGET's size once `targetReady` re-pinned
   * the container. The content's inverse scale exactly cancelled the container's
   * scale, so a where-to *pill* was being laid out at full-screen width for the
   * whole flight, then clipped down to pill size by the container. Forward that
   * is invisible, because the content fades out over the first 32% of the flight.
   * Reverse runs the same ramp backwards, so the content is at FULL opacity for
   * the last 32% — which is exactly when the user sees a full-screen-wide pill
   * squeezed into a pill-sized window: stretched text, wrong internal layout,
   * "blurry and messed up", then a pop to the real card.
   *
   * A container transform renders the source content at SOURCE size and holds it
   * there while the container grows around it. Laying the clone out at the source
   * rect (and centring it, so its scale origin agrees with the container's) makes
   * the last frame of the reverse pixel-identical to the real card underneath.
   */
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);

  // Source rect — set once when morphTo fires
  const sourceX = useSharedValue(0);
  const sourceY = useSharedValue(0);
  const sourceW = useSharedValue(0);
  const sourceH = useSharedValue(0);
  const sourceR = useSharedValue(0);

  // Target rect — set when target screen mounts and reports its frame
  const targetX = useSharedValue(0);
  const targetY = useSharedValue(0);
  const targetW = useSharedValue(0);
  const targetH = useSharedValue(0);
  const targetR = useSharedValue(0);

  // Progress: 0 = source position, 1 = target position
  const morphProgress = useSharedValue(0);
  // Clone crossfade opacity (1 while clone is visible, 0 after settling)
  const cloneOpacity = useSharedValue(1);

  // Ref for the gesture commit callback (set by startMorphBackGesture)
  const gestureCommitRef = useRef<(() => void) | null>(null);

  // Track flight data for cleanup
  const flightRef = useRef<{
    id: string;
    sourceRect: MorphRect;
    sourceRadius: number;
    targetRect: MorphRect | null;
    targetRadius: number;
    timeout: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  /**
   * The last flight that LANDED. `flightRef` means "a morph is in the air right
   * now"; once the clone has settled the flight moves here.
   *
   * BUGFIX: these used to be the same ref, and `settle()` never cleared it. So
   * after the first successful morph `flightRef.current` stayed populated
   * forever, and every later `morphTo` hit the `if (flightRef.current)` guard
   * below and silently degraded to a plain `navigate()` — no clone, no morph,
   * and a stale `activeId`/`phase` left behind for MorphTarget to interpret,
   * which is how the where-to card ended up hidden underneath a stranded clone.
   * Splitting them keeps reverse-morph data available (morphBack needs the
   * target rect) without making the provider look permanently busy.
   */
  const settledRef = useRef<typeof flightRef.current>(null);

  const skipMorph = tier === 'low' || reducedMotion;

  // ─── Cleanup ───────────────────────────────────────────────────────────

  const cleanup = useCallback((restoreSource: boolean) => {
    const f = flightRef.current ?? settledRef.current;
    if (flightRef.current?.timeout) clearTimeout(flightRef.current.timeout);
    if (restoreSource && f) sources.current.get(f.id)?.show();
    flightRef.current = null;
    settledRef.current = null;
    setCloneNode(null);
    setActiveId(null);
    setPhase('idle');
    setFrame(null);
    setContentSize(null);
  }, []);

  // ─── Settle (crossfade clone → real content) ───────────────────────────

  const settle = useCallback(() => {
    setPhase('settled');
    const f = flightRef.current;
    if (f?.timeout) {
      clearTimeout(f.timeout);
      f.timeout = null;
    }
    // The flight has landed: it is no longer "in the air" (so the next morphTo
    // is free to start) but its rects stay available for morphBack.
    settledRef.current = f;
    flightRef.current = null;
    cloneOpacity.value = withTiming(0, { duration: CROSSFADE_MS });
    setTimeout(() => setCloneNode(null), CROSSFADE_MS + 20);
  }, [cloneOpacity]);

  // ─── Forward morph ─────────────────────────────────────────────────────

  const morphTo = useCallback(
    (id: string, navigate: () => void) => {
      const entry = sources.current.get(id);
      if (!entry || skipMorph) {
        navigate();
        return;
      }
      // A flight still in the air means the previous morph never landed (its
      // target screen was torn down mid-flight, say). Retire it and start clean
      // rather than skipping this morph — skipping is what left `activeId`
      // pointing at a dead flight while MorphTarget kept its content hidden.
      if (flightRef.current) cleanup(true);
      // A landed flight for a DIFFERENT id would otherwise leave that source
      // hidden forever, since only its own morphBack un-hides it.
      if (settledRef.current && settledRef.current.id !== id) cleanup(true);

      /**
       * MEASURE THE SOURCE WITHOUT SPENDING A FRAME ON IT.
       *
       * `entry.measure()` is an asynchronous `measureInWindow`, so every morph
       * used to begin with a bridge round-trip during which absolutely nothing
       * happened — no clone, no navigation, no feedback for the tap. That delay
       * varies with how busy the thread is, which is part of why the same
       * animation reads as instant on one screen and sluggish on another.
       *
       * `measureSync` (Fabric's `unstable_getBoundingClientRect`) answers in
       * this tick. The async path is kept as the fallback for the old
       * architecture and for a node that has not laid out yet.
       */
      const begin = (rect: MorphRect | null) => {
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          navigate();
          return;
        }

        // Set source rects
        sourceX.value = rect.x;
        sourceY.value = rect.y;
        sourceW.value = rect.width;
        sourceH.value = rect.height;
        sourceR.value = entry.borderRadius;

        // Reset target rects to source (will update when target mounts)
        targetX.value = rect.x;
        targetY.value = rect.y;
        targetW.value = rect.width;
        targetH.value = rect.height;
        targetR.value = entry.borderRadius;

        // Reset progress to 0 (clone sits at source position)
        morphProgress.value = 0;
        cloneOpacity.value = 1;

        // Set up flight tracking
        flightRef.current = {
          id,
          sourceRect: rect,
          sourceRadius: entry.borderRadius,
          targetRect: null,
          targetRadius: entry.borderRadius,
          timeout: setTimeout(() => {
            cloneOpacity.value = withTiming(0, { duration: durations.fast });
            setTimeout(() => cleanup(true), durations.fast);
          }, TARGET_TIMEOUT_MS),
        };

        // Clone starts pinned to the source frame; targetReady re-pins it to
        // the target frame and the transform carries the delta from there.
        setFrame({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        setContentSize({ width: rect.width, height: rect.height });
        setCloneBg(entry.backgroundColor);
        setCloneNode(entry.getClone());
        setActiveId(id);
        setPhase('forward');
        entry.hide();
        navigate();
      };

      const sync = entry.measureSync?.();
      if (sync && sync.width > 0 && sync.height > 0) begin(sync);
      else void entry.measure().then(begin);
    },
    [skipMorph, cleanup, sourceX, sourceY, sourceW, sourceH, sourceR,
     targetX, targetY, targetW, targetH, targetR, morphProgress, cloneOpacity]
  );

  // ─── Target ready ──────────────────────────────────────────────────────

  const targetReady = useCallback(
    (id: string, rect: MorphRect, borderRadius: number) => {
      const f = flightRef.current;
      if (!f || f.id !== id) return;
      if (f.timeout) {
        clearTimeout(f.timeout);
        f.timeout = null;
      }

      // Set target rects
      targetX.value = rect.x;
      targetY.value = rect.y;
      targetW.value = rect.width;
      targetH.value = rect.height;
      targetR.value = borderRadius;
      /**
       * SAFE TO CALL MORE THAN ONCE — it is a correction, not just an
       * announcement.
       *
       * BUGFIX ("when it morphs, it doesn't go to the exact location of where
       * the picture shape is on the edit profile page").
       *
       * MorphTarget reports on its FIRST layout pass, deliberately, because
       * waiting costs dead frames at the start of every morph. But a first pass
       * is not always the final geometry: safe-area insets resolve a beat late
       * on a cold screen, and a parent that settles afterwards drags the target
       * with it. The clone then flew — accurately — to a position that had since
       * stopped existing, landing NEAR the avatar rather than on it. That is
       * exactly the "weird" in the report.
       *
       * A second call re-points the flight. `flightRef` is nulled by `settle`,
       * so the guard above already makes this inert once the morph has landed:
       * a late layout can never jerk a finished screen.
       */
      const isCorrection = f.targetRect != null;
      f.targetRect = rect;
      f.targetRadius = borderRadius;
      // Re-pin the clone's static frame to the target. Everything from here on
      // is pure transform, so the flight itself costs no layout work.
      setFrame({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });

      // Only ARM the spring once. A correction has to leave the running spring
      // alone: restarting it would reset its velocity mid-flight, which reads as
      // the clone stumbling — and the frame update above has already moved the
      // destination, so the spring in progress now travels to the right place.
      if (isCorrection) return;

      // Spring progress from 0 → 1 — the overlay flies from source to target
      morphProgress.value = withSpring(1, springs.morph, (finished) => {
        if (finished) runOnJS(settle)();
      });
    },
    [targetX, targetY, targetW, targetH, targetR, morphProgress, settle]
  );

  // ─── Gesture-interruptible reverse ─────────────────────────────────────

  // Stable JS-thread commit — invoked from a worklet via runOnJS. Inline
  // arrow closures passed to runOnJS don't serialize reliably in release
  // builds (a known crash source), so the callback is hoisted here.
  const runGestureCommit = useCallback(() => {
    const cb = gestureCommitRef.current;
    gestureCommitRef.current = null;
    cb?.();
  }, []);

  const startMorphBackGesture = useCallback(
    (onCommit: () => void): MorphBackGestureHandle => {
      gestureCommitRef.current = onCommit;

      const handle: MorphBackGestureHandle = {
        onStart: () => {
          // Interrupt any running spring — gesture takes over
          cancelAnimation(morphProgress);
          setPhase('gesture');
        },

        onActive: (translationY: number) => {
          // Map drag Y to progress decrease (Yango: ~280px = full reverse)
          const drag = translationY / GESTURE_FULL_REVERSE_DIST;
          morphProgress.value = Math.max(0, Math.min(1, 1 - drag));
        },

        onEnd: (velocityY: number) => {
          const p = morphProgress.value;
          const commit = p <= GESTURE_COMMIT_THRESHOLD || velocityY > GESTURE_VELOCITY_THRESHOLD;

          if (commit) {
            // Snap to 0 (fully reversed) then call the commit callback
            morphProgress.value = withSpring(0, springs.morph, (finished) => {
              if (finished) runOnJS(runGestureCommit)();
            });
          } else {
            // Snap back to 1 (cancel gesture, stay on target screen)
            morphProgress.value = withSpring(1, springs.morph);
            setPhase('settled');
          }
        },
      };

      return handle;
    },
    [morphProgress, runGestureCommit]
  );

  // ─── Reverse morph (programmatic back) ─────────────────────────────────

  const morphBack = useCallback(
    (navigateBack: () => void) => {
      // Normally the flight has already landed, so its data lives in
      // `settledRef`; `flightRef` only wins if the rider dismissed mid-flight.
      const f = flightRef.current ?? settledRef.current;
      const entry = f ? sources.current.get(f.id) : null;
      if (!f || !f.targetRect || !entry || skipMorph) {
        cleanup(true);
        navigateBack();
        return;
      }
      // Reverse takes ownership of the flight data; keep it in `flightRef` for
      // the duration so a second back-press can't start a competing reverse.
      flightRef.current = f;
      settledRef.current = null;

      // Re-mount the clone at the target frame.
      //
      // The source rect is RE-MEASURED here rather than reusing the one captured
      // on the way out: the screen underneath stays mounted and live while the
      // target is open, so the card can have moved (list scrolled, a banner
      // appeared, the card re-rendered at a new height). Flying back to the old
      // coordinates is what made the return trip land beside the card instead of
      // on it. `measureSync` falls back to the captured rect if the source has
      // since unmounted.
      const back = entry.measureSync?.() ?? f.sourceRect;
      sourceX.value = back.x;
      sourceY.value = back.y;
      sourceW.value = back.width;
      sourceH.value = back.height;
      sourceR.value = f.sourceRadius;
      // The clone content is a clone of the SOURCE, so it is laid out at the
      // freshly-measured source size — see the `contentSize` doc above.
      setContentSize({ width: back.width, height: back.height });

      targetX.value = f.targetRect.x;
      targetY.value = f.targetRect.y;
      targetW.value = f.targetRect.width;
      targetH.value = f.targetRect.height;
      targetR.value = f.targetRadius;

      morphProgress.value = 1;
      cloneOpacity.value = 1;
      setCloneNode(entry.getClone());
      setPhase('reverse');

      /**
       * THE RETURN TRIP USED TO SKIP ITS OWN FIRST HALF.
       *
       * BUGFIX ("the morph on the where-to is smooth but when you click back to
       * go to the homepage, it's laggy and jumpy — not smooth").
       *
       * Everything above is a React state update, so the clone does not exist
       * on screen until the next commit. The three lines that used to follow —
       * `navigateBack()` and then `withSpring(0)` — both ran in THIS tick, which
       * meant two things went wrong at once and reinforced each other:
       *
       *   1. The spring started against a clone that had not been rendered yet.
       *      By the time the overlay actually appeared, `morphProgress` had
       *      already travelled a chunk of its way to 0, so the flight began
       *      part-finished — visually, a jump.
       *   2. `navigateBack()` tears down the trip surface, and until this pass
       *      that included a live MapLibre view. Native view teardown happens on
       *      the main thread, which on the new architecture is the same thread
       *      Reanimated drives the spring on. So the first frames of the reverse
       *      were being dropped by the very navigation that started it.
       *
       * The forward morph never had either problem, because `targetReady` fires
       * from the destination's `onLayout` — by definition after a commit. This
       * gives the reverse the same guarantee: paint the clone, let the pop's
       * teardown take its frame, and only then hand the spring the screen.
       *
       * Two nested rAFs, not `setTimeout(0)` or `runAfterInteractions`: the
       * first resolves after the commit that mounts the clone, the second after
       * the frame the navigation dirties. `runAfterInteractions` would wait for
       * the whole animation queue, which on a busy screen is long enough to read
       * as an unresponsive back button.
       */
      requestAnimationFrame(() => {
        navigateBack();
        requestAnimationFrame(() => {
          // The gesture may have taken over (or another morph started) in the
          // two frames we waited. Only drive the flight we still own.
          if (flightRef.current !== f) return;
          morphProgress.value = withSpring(0, springs.morph, (finished) => {
            if (finished) runOnJS(finishReverse)();
          });
        });
      });
    },
    [skipMorph, cleanup, sourceX, sourceY, sourceW, sourceH, sourceR,
     targetX, targetY, targetW, targetH, targetR, morphProgress, cloneOpacity]
  );

  const finishReverse = useCallback(() => {
    /**
     * Un-hide the real card FIRST, then dissolve the clone on top of it.
     *
     * `cleanup(true)` is what calls `show()`, and it used to run only after this
     * 80ms fade had finished — so for those 80ms the clone was fading towards
     * nothing with an invisible card underneath, and the card then popped back to
     * opacity 1 in a single frame. That pop is the "snaps back" half of the
     * reported glitch. With the clone now landing pixel-identical to the card
     * (see `contentSize`), revealing the card underneath first makes the dissolve
     * literally invisible.
     */
    const f = flightRef.current ?? settledRef.current;
    if (f) sources.current.get(f.id)?.show();
    cloneOpacity.value = withTiming(0, { duration: 80 }, () => {
      runOnJS(cleanup)(false);
    });
  }, [cloneOpacity, cleanup]);

  // ─── Overlay style — progress-driven interpolation ─────────────────────

  // BUGFIX: this used to animate raw left/top/width/height every frame.
  // Even though the values are computed on the UI thread (Reanimated
  // worklet), *assigning* them to layout properties still forces a native
  // layout pass every frame — width/height changes ripple through the
  // native layout engine (and can cascade to children), which is far more
  // expensive than a GPU-composited transform. That's what "technically
  // smooth" morphs still look janky, especially for a card growing to
  // full-screen (a large width/height delta re-laid-out ~60x/sec).
  //
  // Fix: give the overlay a FIXED layout frame (pinned at the target rect)
  // and drive 100% of the position/size animation through `transform`
  // (translateX/Y + scaleX/Y) instead — pure GPU compositing, zero layout
  // recalculation per frame. The inner content gets the inverse scale so
  // the cloned content itself isn't visually stretched/squished by the
  // outer transform (standard "container transform" technique).
  // BUGFIX ("the live-ride card morphs wrong coming back from tracking", and the
  // where-to card landing visibly off its pill): scaleX/scaleY in React Native
  // scale about the view's CENTRE, but the translate above was computed from the
  // TOP-LEFT delta (`x - targetX`). Those two disagree by half of the size
  // difference, so the clone was offset by `(targetW - sourceW)/2` horizontally
  // and `(targetH - sourceH)/2` vertically at progress 0. For a card→card morph
  // that reads as a small jump; for a card→FULL-SCREEN target (the tracking
  // screen, `<MorphTarget style={{ flex: 1 }}>`) the offset is hundreds of
  // pixels, so the reverse morph flew the card to the middle of the screen
  // instead of back onto the home card — exactly the reported symptom.
  //
  // Correct mapping of the fixed frame (targetX/Y/W/H) onto the interpolated box
  // (x/y/w/h) is: scale by w/targetW, then translate CENTRE to CENTRE.
  const overlayStyle = useAnimatedStyle(() => {
    const w = interpolate(morphProgress.value, [0, 1], [sourceW.value, targetW.value]);
    const h = interpolate(morphProgress.value, [0, 1], [sourceH.value, targetH.value]);
    const x = interpolate(morphProgress.value, [0, 1], [sourceX.value, targetX.value]);
    const y = interpolate(morphProgress.value, [0, 1], [sourceY.value, targetY.value]);
    const baseW = targetW.value || 1;
    const baseH = targetH.value || 1;
    const sx = w / baseW;
    const sy = h / baseH;
    /**
     * THE CORNER RADIUS HAS TO BE WRITTEN IN THE FRAME'S SPACE, NOT THE
     * SCREEN'S.
     *
     * BUGFIX ("the morph effect when I hit the profile icon is really bad").
     *
     * The clone's layout box is pinned to the TARGET rect and then SCALED down
     * to whatever the flight's current box is. Everything written on that view
     * — including `borderRadius` — is therefore multiplied by the scale before
     * it reaches the screen. This line used to write the desired ON-SCREEN
     * radius directly, so what actually rendered was `radius × scale`.
     *
     * For the profile avatar that is not subtle: a 64 pt circle flying into a
     * 108 pt circle starts at scale 0.59, so a radius of 32 (a perfect circle)
     * rendered as 19 on a 64 pt box — a rounded SQUARE. The morph therefore
     * began as a square block, un-squared itself into a circle on the way in,
     * and re-squared on the way back. That is the whole of "really bad", and it
     * applied to every rounded morph in both apps.
     *
     * Dividing by the scale makes the rendered radius the one that was asked
     * for. Both ends of an avatar→avatar morph are square boxes, so `sx === sy`
     * throughout and the correction is exact; for a card→full-screen morph the
     * two axes differ, the horizontal one is chosen (it is what the eye reads on
     * a card's corners), and the clamp stops a large correction from producing
     * the pill shape React Native gives a radius greater than half the box.
     */
    const rScreen = interpolate(morphProgress.value, [0, 1], [sourceR.value, targetR.value]);
    const rFrame = Math.min(rScreen / Math.max(sx, 0.0001), Math.min(baseW, baseH) / 2);
    // Transform + opacity + borderRadius ONLY — see the `frame` state above for
    // why left/top/width/height must not be written from here.
    return {
      borderRadius: rFrame,
      opacity: cloneOpacity.value,
      transform: [
        { translateX: x + w / 2 - (targetX.value + baseW / 2) },
        { translateY: y + h / 2 - (targetY.value + baseH / 2) },
        { scaleX: sx },
        { scaleY: sy },
      ] as const,
    };
  });

  /** The non-animated half of the clone's style — written twice per flight, not 60 times a second. */
  const overlayFrameStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      left: frame?.x ?? 0,
      top: frame?.y ?? 0,
      width: frame?.width ?? 1,
      height: frame?.height ?? 1,
      overflow: 'hidden' as const,
      // The cloned content is laid out at the SOURCE size while the container is
      // pinned to the TARGET size, so the two boxes no longer coincide. React
      // Native scales about a view's centre, so the only placement that keeps the
      // container's scale and the content's inverse scale agreeing is centre-on-
      // centre; anchoring top-left would make the content drift across the flight.
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    }),
    [frame],
  );

  const contentFrameStyle = useMemo(
    () => ({ width: contentSize?.width ?? 1, height: contentSize?.height ?? 1 }),
    [contentSize],
  );

  // BUGFIX ("the where-to animation looks like a fast fade, not a morph"):
  // the inner inverse-scale exactly cancels the container's scale, so the
  // cloned content rendered at a constant size for the entire flight. Nothing
  // about the content grew, moved or changed — the only thing animating was
  // the clip rectangle, and since the destination content stayed hidden at
  // opacity 0 until `settle()` fired, what a user actually saw was a 200ms
  // crossfade bolted onto the end. That is why it read as a fade.
  //
  // The inverse scale is kept (it is what stops the source content from being
  // stretched by the container transform), but the clone content now fades out
  // over the first third of the flight while MorphTarget fades the real
  // destination content in over the middle — the two halves of a proper
  // container transform, overlapping the container's own growth instead of
  // queueing behind it.
  const contentStyle = useAnimatedStyle(() => {
    const w = interpolate(morphProgress.value, [0, 1], [sourceW.value, targetW.value]);
    const h = interpolate(morphProgress.value, [0, 1], [sourceH.value, targetH.value]);
    const baseW = targetW.value || 1;
    const baseH = targetH.value || 1;
    // width/height live in contentFrameStyle — same layout-thrash reason as the
    // overlay above.
    return {
      opacity: interpolate(
        morphProgress.value,
        [0, CONTENT_FADE_OUT_END],
        [1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        { scaleX: baseW / (w || 1) },
        { scaleY: baseH / (h || 1) },
      ] as const,
    };
  });

  // phaseRef for reading phase inside callbacks
  const phaseRef = useRef<MorphPhase>('idle');
  phaseRef.current = phase;

  // Teardown on unmount — cancel any in-flight spring and clear the flight
  // timeout so a settle/cleanup callback can't fire against a dead tree.
  React.useEffect(() => {
    return () => {
      cancelAnimation(morphProgress);
      cancelAnimation(cloneOpacity);
      const f = flightRef.current;
      if (f?.timeout) clearTimeout(f.timeout);
    };
  }, [morphProgress, cloneOpacity]);

  // ─── Context value ─────────────────────────────────────────────────────

  const value = useMemo<MorphContextValue>(
    () => ({
      registerSource: (id, entry) => {
        sources.current.set(id, entry);
        return () => {
          if (sources.current.get(id) === entry) sources.current.delete(id);
        };
      },
      morphTo,
      morphBack,
      targetReady,
      startMorphBackGesture,
      activeId,
      phase,
      morphProgress,
    }),
    [morphTo, morphBack, targetReady, startMorphBackGesture, activeId, phase, morphProgress]
  );

  return (
    <MorphContext.Provider value={value}>
      <View style={styles.host} pointerEvents="box-none">
        {children}
        {cloneNode != null && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Animated.View
              style={[
                overlayFrameStyle,
                { backgroundColor: cloneBg ?? colors.backgroundDeep },
                overlayStyle,
              ]}
            >
              <Animated.View style={[contentFrameStyle, contentStyle]}>{cloneNode}</Animated.View>
            </Animated.View>
          </View>
        )}
      </View>
    </MorphContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
});
