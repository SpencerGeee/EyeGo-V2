import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, BackHandler } from 'react-native';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { withOpacity } from '@eyego/config';
import { useColors } from '../utils/useColors';
import { useTripFlow, CLIENT_OWNED_STAGES, type TripStage } from '../stores/tripFlow.store';
import { useTripStore, stageForStatus, isTerminal } from '../stores/trip.store';
import { consumeTripSurfaceReturn } from '../utils/tripSurfaceReturn';
import { TripMap } from '../components/trip/TripMap';
import { SearchStage } from '../components/trip/stages/SearchStage';
import { SelectStage } from '../components/trip/stages/SelectStage';
import { RequestStage } from '../components/trip/stages/RequestStage';
import { AssignedStage } from '../components/trip/stages/AssignedStage';
import { TrackingStage } from '../components/trip/stages/TrackingStage';

// Yango-style slow ease: 700ms with a gentle ease-out so the crossfade
// spans as a continuous, perceptible morph rather than a quick snap.
const STAGE_TRANSITION_CFG = { duration: 700, easing: Easing.out(Easing.cubic) };


/**
 * The persistent trip surface — ONE route hosting the whole booking flow as
 * stages (search → select → request → assigned → tracking) so the map and
 * panel stay mounted while only stage content changes. Route config mirrors
 * the old where-to screen: animation 'none' + transparentModal, because the
 * MorphProvider clone owns the entrance/exit choreography.
 *
 * Stage swaps crossfade through one shared progress value: the outgoing
 * stage fades/lifts away while the incoming one fades/rises in, both mounted
 * for the duration — no unmount jump-cuts, exactly the Yango morph feel.
 *
 * ALL FIVE stages now live here. `assigned` and `tracking` used to bridge out
 * to `/ride/[id]/tracking`, a 1754-line screen with its own MapView, its own
 * camera and its own Directions retry ladder — so the one moment the rider
 * cares most about (a car approaching) was the one moment the map was torn
 * down and rebuilt. That route is no longer reachable from the flow.
 */
function renderStage(stage: TripStage) {
  switch (stage) {
    case 'search': return <SearchStage />;
    case 'select': return <SelectStage />;
    case 'request': return <RequestStage />;
    case 'assigned': return <AssignedStage />;
    case 'tracking': return <TrackingStage />;
    default: return null;
  }
}

export default function TripScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{
    stage?: string; tier?: string; type?: string; morphId?: string; bookingId?: string;
    /**
     * The pending on-demand request this surface was opened to show.
     *
     * Home's "looking for a driver" card passes it. It was NOT declared here,
     * so the reset guard below could not see it, and tapping that card rendered
     * the request stage for a frame and then threw the rider onto the Where-To
     * sheet — "it takes me to the looking for a driver page then redirects to
     * the where to page". Same class of bug as `bookingId`, same fix.
     */
    resumeRequestId?: string;
  }>();
  const stage = useTripFlow((s) => s.stage);
  const seed = useTripFlow((s) => s.seed);
  const popStage = useTripFlow((s) => s.popStage);
  const syncFromServer = useTripFlow((s) => s.syncFromServer);
  const tripStatus = useTripStore((s) => s.snapshot?.status ?? null);
  const hydrate = useTripStore((s) => s.hydrate);
  const router = useRouter();

  // Seed the stage machine once per surface open, from route params.
  useEffect(() => {
    const seeded = (params.stage as TripStage) ?? 'search';
    seed({
      stage: seeded,
      tier: params.tier,
      type: params.type,
      morphId: params.morphId,
      bookingId: params.bookingId,
    });
    // ONE-CALL REHYDRATION. If a ride is already live — cold start, app killed
    // mid-trip, deep link — this is what makes the surface open on the right
    // stage instead of dropping the rider back on 'search' as though nothing
    // were happening. Neither app had an equivalent before.
    //
    // The fallback matters as much as the hydration: every entry point that
    // used to push `/ride/[id]/tracking` now seeds a live stage (`assigned`)
    // so the surface opens on the panel instead of flashing the search sheet.
    // If that ride has since ended, there is no snapshot for the stage to
    // render and `stageForStatus` returns null for terminal statuses — so
    // without this the rider would sit on an empty tracking panel forever.
    void hydrate().then(({ trip, ok }) => {
      // BUGFIX (three reports, one line): "after paying I land on Where To",
      // "the live tracking card takes me to Where To", "book + send invite
      // sends me to Where To".
      //
      // `hydrate()` resolves the rider's active SOLO ride via `rides/active`.
      // A seat on a driver-created GROUP trip is not one, so `trip` is
      // legitimately null for every group flow — and this fallback then threw
      // the rider onto the search sheet from a perfectly live booking. The
      // same happened whenever the call merely FAILED, because the old
      // `catch { return null }` made offline look identical to no-trip.
      //
      // So: never reset on a failed lookup, and never reset a stage that was
      // seeded for a specific booking — that booking is the thing being shown.
      if (!ok) return;
      if (trip) return;
      if (params.bookingId) return;
      // Same reasoning as `bookingId`: the surface was opened to show ONE
      // specific pending request, and `rides/active` legitimately returns null
      // for it, so a null lookup is not evidence that there is nothing to show.
      if (params.resumeRequestId) return;
      if (CLIENT_OWNED_STAGES.includes(seeded)) return;
      syncFromServer('search');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * THE PROJECTION. Once a trip exists its status decides the stage, full
   * stop. The client no longer navigates itself forward and then has to
   * defend that decision against contradicting pushes — which is what made
   * the request flow feel inconsistent.
   */
  useEffect(() => {
    const derived = stageForStatus(tripStatus);
    if (derived) syncFromServer(derived);
  }, [tripStatus, syncFromServer]);

  /**
   * THE TERMINAL HAND-OFF. `stageForStatus` deliberately returns null for
   * COMPLETED/CANCELLED/etc, so without this the surface would sit on the last
   * live stage forever. The legacy tracking screen owned this exit; now the
   * surface does, which is why that route can retire.
   *
   * Guarded by a ref rather than by the status alone: the same terminal
   * snapshot arrives again on every reconnect replay, and `router.replace`
   * fired twice stacks two receipts.
   */
  const handedOff = useRef(false);
  const snapshot = useTripStore((s) => s.snapshot);
  const unwatch = useTripStore((s) => s.unwatch);
  useEffect(() => {
    if (!isTerminal(tripStatus) || handedOff.current || !snapshot) return;
    handedOff.current = true;
    // Stop the channel BEFORE navigating: a socket still applying events to a
    // dead trip is what kept the old flow's "reconnecting" chip alive on the
    // receipt screen.
    unwatch();
    if (tripStatus === 'COMPLETED') {
      const bid = snapshot.booking?.id;
      router.replace(
        `/ride/${snapshot.tripId}/complete${bid ? `?bookingId=${bid}` : ''}` as Href,
      );
    } else {
      // Cancelled, expired, no-show, no drivers found: nothing to receipt.
      // TripStatusListener owns the explanatory banner, so this only navigates.
      router.replace('/(tabs)/home' as Href);
    }
  }, [tripStatus, snapshot, unwatch, router]);

  /**
   * WHERE-TO IS AN ENTRANCE, NOT A DESTINATION.
   *
   * "if i click the back button on any page it shouldnt take me to the where to
   * page even if its in the stack. going back from another page should take me
   * to the homepage."
   *
   * The trip surface is a single route. Everything downstream of it — payment,
   * invite, guest selection — pushes ON TOP of it, so every `router.back()`
   * from those screens necessarily lands back here, and here re-seeds from
   * `params.stage`, which for a normal booking was never set and therefore
   * defaulted to 'search'. Backing out of payment dropped the rider on the
   * Where-To sheet with the booking they had just made invisible behind it.
   *
   * Patching each caller would need every screen that can ever sit above this
   * one to know what it is sitting above. Instead the rule lives in the one
   * place that can enforce it: a client-owned stage is only ever valid on the
   * focus that CREATED it. Regain focus on 'search' or 'select' and the rider
   * got here by backing into it, so send them home. A deliberate tap on the
   * Where-To pill is a fresh push, which is a first focus, which is untouched.
   */
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      // ...EXCEPT when the surface opened that screen itself. The Where-To
      // sheet pushes its own children — the place picker, saved places, the
      // schedule screen — and coming back from one of those is the sheet's own
      // round trip, not a rider backing in from downstream. The stage looks
      // identical either way, so the screen that navigated declares the intent
      // and this consumes it once. Without it, choosing a destination (or
      // merely opening the picker and pressing back) threw the rider onto the
      // home screen and lost the search they were part-way through.
      if (consumeTripSurfaceReturn()) return;
      if (CLIENT_OWNED_STAGES.includes(useTripFlow.getState().stage)) {
        router.dismissTo('/(tabs)/home' as Href);
      }
    }, [router]),
  );

  // Hardware back for stages past the root — the search stage registers its
  // own handler (morph-back to the home pill). Registered per-stage so the
  // search handler wins whenever search is the active stage.
  useEffect(() => {
    if (stage === 'search') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      popStage();
      return true;
    });
    return () => sub.remove();
  }, [stage, popStage]);

  // ── Stage crossfade: outgoing fades/lifts, incoming fades/rises ──
  const progress = useSharedValue(1);
  const [rendered, setRendered] = useState<{ current: TripStage; previous: TripStage | null }>(
    { current: stage, previous: null },
  );
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;

  useEffect(() => {
    if (stage === renderedRef.current.current) return;
    setRendered({ current: stage, previous: renderedRef.current.current });
    progress.value = 0;
    progress.value = withTiming(1, STAGE_TRANSITION_CFG, (finished) => {
      if (finished) runOnJS(setRendered)({ current: stage, previous: null });
    });
  }, [stage, progress]);

  const incomingStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: progress.value * -12 }],
  }));

  /**
   * The scrim behind the top chips.
   *
   * It was named `mapGradient` and was not one: a flat 220 pt rectangle filled
   * at 55 % opacity. A constant-alpha fill has to STOP somewhere, and where it
   * stopped there was a hard horizontal seam across the map — reported as "a
   * visible border that's a bit transparent at the top of the tracking page,
   * it's not as fullscreen as the driver app".
   *
   * A real vertical fade has no edge to see. It also starts weaker (0.45) and
   * reaches zero well before the bottom, so the map is genuinely full-bleed the
   * way the driver's is; the scrim still does its one job, which is keeping the
   * connection chip legible when the map underneath is a pale road.
   */
  const scrimColors = useMemo(
    () =>
      [
        withOpacity(colors.backgroundDeep, 0.45),
        withOpacity(colors.backgroundDeep, 0.18),
        withOpacity(colors.backgroundDeep, 0),
      ] as const,
    [colors],
  );

  return (
    // The 250ms fade used to be the loudest thing on screen: it faded the map,
    // the header AND the card in together, well before the morph clone had
    // finished travelling, so the whole transition registered as "a quick fade"
    // rather than a card growing. Stretched to roughly the morph's own travel
    // time so it reads as the background settling in behind the morph instead
    // of racing it. The card itself is no longer part of this story — its
    // reveal is driven by morph progress in MorphTarget.
    <Animated.View style={styles.root} entering={FadeIn.duration(420)}>
      {/* One persistent map for every stage */}
      <TripMap />
      <LinearGradient
        colors={scrimColors as unknown as readonly [string, string, ...string[]]}
        // Weighted toward the top so the fade is imperceptible rather than a
        // linear ramp you can still pick out the end of.
        locations={[0, 0.55, 1]}
        style={styles.topScrim}
        pointerEvents="none"
      />

      {rendered.previous && (
        <Animated.View style={[StyleSheet.absoluteFill, outgoingStyle]} pointerEvents="none">
          {renderStage(rendered.previous)}
        </Animated.View>
      )}
      {/*
        BUGFIX ("on the rider tracking page i can't move the map, it's like it's
        frozen, but the card underneath is completely movable").
        This layer is `absoluteFill` and sits directly on top of `<TripMap />`.
        Without `box-none` it is a screen-sized invisible touch target: every
        pan, pinch and rotate landed on it and stopped there, so the map never
        received a single gesture while the panel inside this very layer stayed
        perfectly interactive — which is exactly the split the report describes.
        `box-none` lets the view itself decline touches while its real children
        (the stage panel) keep receiving them normally.
      */}
      <Animated.View style={[StyleSheet.absoluteFill, incomingStyle]} pointerEvents="box-none">
        {renderStage(rendered.current)}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
});
