import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, Text as RNText, BackHandler, InteractionManager, useWindowDimensions } from 'react-native';
import Animated, {
  FadeIn,
  interpolate,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { bookingsApi } from '@eyego/api';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withOpacity, springs, fonts, fontSizes, spacing, radii } from '@eyego/config';
import { SheetMetricsProvider, useCreateSheetMetrics, AppBackground } from '@eyego/ui';
import { useColors } from '../utils/useColors';
import { useThemeStore } from '../stores/theme.store';
import { useTripFlow, CLIENT_OWNED_STAGES, type TripStage } from '../stores/tripFlow.store';
import { useTripStore, stageForStatus, isTerminal } from '../stores/trip.store';
import { useRideStore } from '../stores/ride.store';
import { consumeTripSurfaceReturn } from '../utils/tripSurfaceReturn';
import { TripMap } from '../components/trip/TripMap';
import { SearchStage } from '../components/trip/stages/SearchStage';
import { ConfigureStage } from '../components/trip/stages/ConfigureStage';
import { SelectStage } from '../components/trip/stages/SelectStage';
import { RequestStage } from '../components/trip/stages/RequestStage';
import { AssignedStage } from '../components/trip/stages/AssignedStage';
import { TrackingStage } from '../components/trip/stages/TrackingStage';
import { TripSheetHost } from '../components/trip/TripSheetHost';

/**
 * ONE SPRING, NOT A DURATION.
 *
 * This was `withTiming(700ms, Easing.out(Easing.cubic))`. A fixed duration is
 * the wrong instrument for a surface that is physically changing shape: the
 * outgoing stage, the incoming stage and the panel geometry underneath them all
 * have to arrive together, and a duration cannot adapt to a swap that starts
 * while the previous one is still settling.
 *
 * Note what this does NOT buy, because an earlier version of this comment
 * claimed it: `progress` is reset to 0 on every swap (see the effect below), so
 * there is no velocity handoff. There cannot be — the two layers are re-pointed
 * at a different pair of stages at that moment, so the value's OLD meaning does
 * not survive into the new one, and carrying its velocity across would be
 * carrying a number about the previous pair. What the spring gives here is a
 * settle whose shape matches the sheet's own height spring underneath it, so
 * the contents and the container stop moving together rather than one landing
 * first and waiting.
 *
 * `springs.morph` is the established container-transform token — the same spring
 * MorphTarget uses to grow the Where-To card into this surface — so a stage swap
 * reads as the one panel continuing to deform rather than as a second, unrelated
 * animation. (`MOTION_PROFILES.FLUID_MORPH` is the role-named alias for this
 * same spring, ζ ≈ 1.0 at response ≈ 0.46 s; the token is used directly here to
 * keep every surface in the flow reading from one name.) Critically damped, so
 * `progress` never leaves [0, 1] and the opacity it drives cannot overshoot into
 * a flash.
 */
const STAGE_TRANSITION_CFG = springs.morph;

/**
 * WHICH STAGE SWAPS ARE THE SAME PANEL, AND WHICH ARE DIFFERENT PAGES.
 *
 * Every swap used to be one uniform cross-dissolve: both stages at ~50 %
 * opacity through the middle of the spring, each sliding ±12–16 pt. That is
 * the right gesture for `search → configure → select`, which really is a paged
 * flow — three separate screens of the Where-To questionnaire, and the small
 * slide is what tells the rider they moved forward through it.
 *
 * It is the wrong gesture for the three swaps below. `select → request →
 * assigned → tracking` is not paging; it is ONE panel whose contents change as
 * the trip progresses — pick a tier, we're finding you a driver, here is your
 * driver, here is the ride. The panel never leaves, and the sheet underneath is
 * already animating its own height continuously across these swaps. Dissolving
 * the contents against that moving container is what made these three read as
 * cheap: mid-flight you see two half-transparent panels stacked on a third
 * shape that is still resizing, and the eye reads three surfaces where there
 * is one.
 *
 * So these three get a container transform instead — a fade-THROUGH, not a
 * cross-fade. The outgoing content is gone before the incoming appears, so the
 * two never overlap and there is no double-exposure; the incoming grows the
 * last few per cent into place, which reads as the container's contents
 * re-forming. No translation at all: translation is precisely the signal that
 * says "a different page arrived", and here nothing arrived.
 *
 * Keyed by destination stage, because the flow only reaches each of these from
 * one place; a swap into a stage not listed here keeps the paged dissolve.
 */
const CONTAINER_TRANSFORM_INTO: Partial<Record<TripStage, readonly TripStage[]>> = {
  request: ['select'],
  assigned: ['request'],
  tracking: ['assigned'],
};

/**
 * The crossover point of the fade-through, as a fraction of the spring.
 *
 * Below it the outgoing content finishes leaving; above it the incoming starts
 * arriving. They must not overlap — an overlap is a cross-fade, which is the
 * thing being replaced. 0.35 rather than 0.5 because `springs.morph` is
 * critically damped and spends its back half decelerating: splitting at the
 * midpoint of PROGRESS would give the incoming content most of the wall-clock
 * time and make the exit feel clipped.
 */
const FADE_THROUGH_PIVOT = 0.35;

/**
 * WHY THERE IS NO SCALE HERE, WHICH A CONTAINER TRANSFORM NORMALLY HAS.
 *
 * The textbook fade-through grows the incoming content the last few per cent
 * into place. That needs a transform origin at the container's own anchor, and
 * these two layers are `StyleSheet.absoluteFill` — full-screen — so a `scale`
 * on them resolves about the SCREEN's centre. For content that sits low on the
 * display, scaling about the screen centre translates it: starting at 0.94
 * would lift the panel roughly a dozen points and drop it into place, which
 * reads as a slide — the exact signal this transition is trying not to send.
 * (This codebase has been caught by "RN scales about the centre" before.)
 *
 * `transformOrigin: 'bottom center'` is available on RN 0.81 and is used
 * elsewhere in the UI package, so this is fixable — but only once the panel's
 * real anchor is established, and the panel is hosted by `TripSheetHost`, a
 * SIBLING of these layers, not by the layers themselves. Getting that wrong is
 * worse than omitting it: a mis-anchored scale is a slide with extra steps.
 *
 * The fade-through alone is the part that carries the change, because it is the
 * overlap that was making these three swaps look cheap — two half-transparent
 * panels over a sheet that is itself still resizing. Removing the overlap
 * leaves one surface changing its contents, and the sheet's own height spring
 * supplies the container continuity. The scale is an enhancement on top of
 * that, and it is left for a pass that can watch it on a device.
 */



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
/**
 * ── THE ONE BACKGROUND, AND THE MAP THAT IS NOT ALWAYS THERE ────────────────
 *
 * WHAT WAS WRONG. Four of the six stages mounted their OWN `<AppBackground />`
 * — a full-screen Skia canvas — on top of the root one this route already sits
 * over. `/trip` is a `transparentModal` with a transparent `contentStyle` (see
 * app/_layout.tsx), which means the app's ambient shader has been visible
 * through this surface the whole time; every per-stage background was a second
 * canvas painted over a first, opaquely, to hide it.
 *
 * The cost lands exactly where it hurts most. During a stage swap BOTH stages
 * are mounted, so tapping "Order Ride" (search → configure) meant, in one
 * frame: the root shader, a live MapLibre view underneath, the outgoing
 * stage's static Skia canvas, and the incoming stage's ANIMATED one — four
 * full-screen surfaces plus two React trees, competing for the frame the morph
 * spring needed. That is the reported "very jumpy and laggy".
 *
 * WHAT IT IS NOW. Stages are transparent. The root `AppBackground` is the
 * background for all of them, so a stage change composites two content trees
 * and nothing else, and the shader is never torn down and rebuilt — which also
 * means the ambient light does not visibly restart every time the flow moves
 * forward.
 *
 * THE MAP. `search` does not draw one — it covered it with an opaque backdrop,
 * so MapLibre was rendering every frame to be looked at by nobody, through the
 * transition the rider complained about most. From `configure` onward the map
 * IS the route preview and must be there: `configure` opens on "Choose your
 * ride", where the whole point of the screen is comparing prices for a journey,
 * and a journey you cannot see is a number with nothing attached to it.
 *
 * So it is mounted lazily — and once mounted it stays, because the one thing
 * worse than a map you cannot see is a map torn down and rebuilt while a rider
 * watches a car approach.
 */
const MAP_STAGES: readonly TripStage[] = ['configure', 'select', 'request', 'assigned', 'tracking'];

/**
 * Where the map starts WARMING.
 *
 * `search` is now the last stage before the map is needed. It is a long-dwell
 * stage — the rider is typing a destination and confirming a pickup — so
 * MapLibre's initialisation lands in a quiet frame instead of on top of the
 * search→configure transition. The mount is additionally deferred through
 * `runAfterInteractions` below, so it cannot land on the home→search morph
 * either. By the time `configure` renders the map is already alive and the
 * crossfade is pure compositing.
 */
const MAP_WARM_STAGE: TripStage = 'search';

function renderStage(stage: TripStage) {
  switch (stage) {
    case 'search': return <SearchStage />;
    // Steps 3-5 of the paged Where-to flow; SearchStage owns 1-2.
    case 'configure': return <ConfigureStage />;
    case 'select': return <SelectStage />;
    case 'request': return <RequestStage />;
    case 'assigned': return <AssignedStage />;
    case 'tracking': return <TrackingStage />;
    default: return null;
  }
}

export default function TripScreen() {
  const colors = useColors();
  // Drives this screen's own copy of the ambient background — see the note on
  // `opaqueFloor` in the render for why it has one.
  const isDark = useThemeStore((s) => s.isDark);
  const { height: screenHeight } = useWindowDimensions();
  /**
   * The channel the sheet publishes its top edge on and the map reads its
   * camera padding from. Scoped to this surface rather than global: a module
   * singleton would be shared with any other map in the process, and the
   * rider's sheet would silently pad someone else's camera.
   */
  const sheetMetrics = useCreateSheetMetrics(screenHeight);
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
  const insets = useSafeAreaInsets();

  // Seed the stage machine once per surface open, from route params.
  useEffect(() => {
    const seeded = (params.stage as TripStage) ?? 'search';
    /**
     * THE TIER THE RIDER PICKED HAS TO SURVIVE THE TRIP TO THE PICKER.
     *
     * BUGFIX ("I chose Premium on Services, set my trip, and Choose Your Ride
     * came up on Economy"). Exactly right: `seed()` stored the tier on the FLOW
     * store, and `ConfigureStage` reads `rideTier` off the RIDE store, which
     * nothing ever wrote — so it kept its `'ECO'` initial value and the rider's
     * choice was silently discarded one screen before the screen that shows it.
     *
     * The two stores also disagree on spelling: Services links out with the
     * card's own id (`economy`/`comfort`/`premium`) while the wire values are
     * `ECO`/`COMFORT`/`PREMIUM`, so this normalises rather than upper-casing —
     * `'ECONOMY'` is not a tier the quote endpoint knows.
     */
    const tierParam = params.tier?.toUpperCase();
    const seededTier =
      tierParam === 'PREMIUM'
        ? 'PREMIUM'
        : tierParam === 'COMFORT'
        ? 'COMFORT'
        : tierParam === 'ECONOMY' || tierParam === 'ECO'
        ? 'ECO'
        : null;
    if (seededTier) useRideStore.getState().setRideOptions({ rideTier: seededTier });
    /**
     * A GROUP RIDE STARTS AT TWO.
     *
     * BUGFIX, the last mile of "when I tap on the group ride thing it just takes
     * me to the normal flow". Even with a group-specific picker, a flow that
     * opens on one seat is the solo flow wearing a different heading — the rider
     * has to do work before it becomes the thing they asked for. Two is the
     * smallest number that is a group; the picker goes to eight from there.
     */
    if (params.type === 'group') {
      const ride = useRideStore.getState();
      if (ride.requestSeatCount < 2) ride.setRequestSeats(2, ride.requestCoverAll);
    }
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

    /**
     * THE RIDER ASKED FOR THE SEARCH SHEET. LET THEM HAVE IT.
     *
     * BUGFIX — "if you go to the Where To page it just takes you to the live
     * ride."
     *
     * `/where-to` redirects here with `stage=search`, and the projection effect
     * below then reads the live trip's status and overwrites that stage on the
     * very next frame. Correct for a RESUME; wrong for a deliberate tap, which
     * is why the search sheet was unreachable for the whole of a ride.
     *
     * `params.stage` is the discriminator, and it is a reliable one: a resume
     * seeds a LIVE stage ('assigned'/'tracking') or nothing at all, while every
     * deliberate route into the sheet names a client-owned one. So a
     * client-owned seed pins the surface, and — because a person can only be in
     * one car — flips the booking to a guest booking.
     */
    if (CLIENT_OWNED_STAGES.includes(seeded)) {
      void bookingsApi
        .getActive()
        .then((res: any) => {
          const live = res?.data?.data ?? null;
          useTripFlow.getState().pinToSearch(!!live?.id);
        })
        // A lookup that failed is not evidence of no ride — but it IS evidence
        // the rider asked to be here, so pin without the guest switch and let
        // the server refuse a second self-booking if there is one.
        .catch(() => useTripFlow.getState().pinToSearch(false));
    }
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
  /**
   * Mirrors `handedOff` as state, purely so the map can be torn down.
   *
   * BUGFIX ("i finished the trip but the homepage shown afterwards is under the
   * map — the background is the opaque map instead of the skia background").
   *
   * `router.replace` swaps THIS route's entry, but the rider reached the trip
   * surface through the invite/booking flow, so the surface was not the only
   * thing on the stack and the replace did not take the map with it. The tab
   * scenes are deliberately transparent — that is what lets the root
   * AppBackground show through every tab — so a still-mounted MapLibre view
   * anywhere below them is what the rider sees as their home background.
   *
   * Unmounting the map on the terminal transition fixes it for every stack
   * shape, rather than for the one navigation path that happened to be tested.
   * There is nothing left to render on it at this point either: the trip is
   * over and the channel has already been stopped.
   */
  const [surfaceRetired, setSurfaceRetired] = useState(false);
  const snapshot = useTripStore((s) => s.snapshot);
  const unwatch = useTripStore((s) => s.unwatch);
  useEffect(() => {
    if (!isTerminal(tripStatus) || handedOff.current || !snapshot) return;
    handedOff.current = true;
    setSurfaceRetired(true);
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
  /**
   * Leave the surface without ending the ride.
   *
   * `dismissTo` rather than `push`: the trip surface is a transparentModal over
   * the tab navigator, so pushing home would stack a second home screen behind
   * a modal that is still mounted. Dismissing unwinds to the real one, and the
   * live-ride card there is what brings the rider back.
   */
  const goHomeKeepingRide = useCallback(() => {
    router.dismissTo('/(tabs)/home' as Href);
  }, [router]);

  useEffect(() => {
    if (stage === 'search') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // `popStage` answers null on a server-owned stage — the ride cannot go
      // backwards. That is not a reason to trap the rider on the screen; see
      // the Home pill for the full reasoning.
      if (popStage() == null) goHomeKeepingRide();
      return true;
    });
    return () => sub.remove();
  }, [stage, popStage, goHomeKeepingRide]);

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
    progress.value = withSpring(1, STAGE_TRANSITION_CFG, (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(setRendered)({ current: stage, previous: null });
    });
  }, [stage, progress]);

  /**
   * Lazy, one-way map mount — see MAP_STAGES above.
   *
   * `runAfterInteractions` rather than a bare effect: the flag flips during the
   * same commit that starts a stage spring, and mounting a MapLibre view is
   * native work on the main thread, which is the one thread the spring cannot
   * afford to share. Deferring it until the animation queue drains costs the
   * map a few frames of head start and costs the transition nothing.
   */
  const mapNeededNow =
    MAP_STAGES.includes(rendered.current) ||
    (rendered.previous != null && MAP_STAGES.includes(rendered.previous)) ||
    rendered.current === MAP_WARM_STAGE;
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => {
    if (!mapNeededNow || mapMounted) return;
    const task = InteractionManager.runAfterInteractions(() => setMapMounted(true));
    return () => task.cancel();
  }, [mapNeededNow, mapMounted]);

  /**
   * The map's visibility, crossfaded on the SAME spring as the stage swap.
   *
   * Driven off `rendered` rather than `stage` so it moves with the outgoing and
   * incoming panels instead of snapping a frame ahead of them. When the previous
   * stage also drew no map the fade has nothing to do and both ends are 0.
   */
  const currentStageDrawsMap = MAP_STAGES.includes(rendered.current);
  const previousStageDrawsMap =
    rendered.previous == null ? currentStageDrawsMap : MAP_STAGES.includes(rendered.previous);
  const mapVeilStyle = useAnimatedStyle(() => {
    const from = previousStageDrawsMap ? 1 : 0;
    const to = currentStageDrawsMap ? 1 : 0;
    return { opacity: from + (to - from) * progress.value };
  }, [currentStageDrawsMap, previousStageDrawsMap]);

  /**
   * Is THIS swap the same panel changing its contents, or a new page?
   *
   * Read off `rendered`, not `stage`, for the same reason the map veil is: the
   * styles have to describe the pair currently on screen. `previous == null`
   * means the spring has settled and only one stage is mounted, in which case
   * the answer does not matter — the incoming style is already at rest.
   */
  const isContainerTransform =
    rendered.previous != null &&
    (CONTAINER_TRANSFORM_INTO[rendered.current]?.includes(rendered.previous) ?? false);

  const incomingStyle = useAnimatedStyle(() => {
    if (!isContainerTransform) {
      // Paged: rises the last 16 pt as it fades in.
      return {
        opacity: progress.value,
        transform: [{ translateY: (1 - progress.value) * 16 }],
      };
    }
    // Container transform: nothing until the outgoing content has gone, then
    // fade in on the spot. No translation — see the note on scale above.
    return {
      opacity: interpolate(progress.value, [FADE_THROUGH_PIVOT, 1], [0, 1], 'clamp'),
      transform: [{ translateY: 0 }],
    };
  }, [isContainerTransform]);

  const outgoingStyle = useAnimatedStyle(() => {
    if (!isContainerTransform) {
      return {
        opacity: 1 - progress.value,
        transform: [{ translateY: progress.value * -12 }],
      };
    }
    /**
     * Leaves early and stays put. Holding position is the whole point: a
     * container's contents do not slide away from their container, and the
     * sheet underneath is resizing at the same time — any movement here would
     * be read as belonging to that resize.
     */
    return {
      opacity: interpolate(progress.value, [0, FADE_THROUGH_PIVOT], [1, 0], 'clamp'),
      transform: [{ translateY: 0 }, { scale: 1 }],
    };
  }, [isContainerTransform]);

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
        // Lighter as well as shorter. 0.45 was dark enough to read as a panel
        // over the map rather than as shading behind a chip.
        withOpacity(colors.backgroundDeep, 0.34),
        withOpacity(colors.backgroundDeep, 0.12),
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
      <SheetMetricsProvider value={sheetMetrics}>
      {/*
        THE FLOOR OF THIS SCREEN — AND WHY IT IS NOT SIMPLY TRANSPARENT.

        BUGFIX ("on the set your trip page the background is transparent so the
        homepage elements are bleeding into the page"). Exactly right, and the
        layering explains it: `/trip` is a `transparentModal` over `(tabs)`, and
        `(tabs)` is ITSELF transparent so the root `AppBackground` can show
        through it. So the stack was, bottom to top, shader → the home screen's
        real content → this screen. Being transparent did not reveal the shader,
        it revealed the where-to card, the tab bar and the trip cards sitting in
        between.

        The brief was "these pages share the Skia background and nothing else",
        so that is what this pair does: an opaque fill that ends the home screen,
        and the same `AppBackground` painted back on top of it. The result is
        pixel-identical to the ambient background the rest of the app shows,
        with none of home's furniture in it.

        The morph is unaffected — clones fly in the `MorphProvider` overlay,
        which is mounted above the whole navigator, not between these layers.
      */}
      <View
        style={[styles.opaqueFloor, { backgroundColor: colors.backgroundDeep }]}
        pointerEvents="none"
      />
      <AppBackground isDark={isDark} />

      {/* The map, from the first stage that draws one until the trip ends. See
          MAP_STAGES for why it is not mounted before that, and `surfaceRetired`
          for why it must go at the end: past that point this view is not a map
          any more, it is the home screen's background. */}
      {/*
        THE MAP IS HIDDEN ON THE STAGES THAT ARE NOT ABOUT THE MAP.

        BUGFIX ("the search stage has the map as its background and it's
        confusing — the content isn't legible; replace it with the Skia
        background like the driver's create-trip flow").

        `MAP_STAGES` says `search` draws no map, and the mount is deliberately
        ONE-WAY (see the note there: a map torn down and rebuilt mid-ride is
        worse than an idle one). Those two facts contradict each other the moment
        a rider steps BACKWARD — configure → search to change the destination, or
        any bounce through search, which is also the map's warm-up stage. From
        then on the map is mounted, the stages above it are transparent by
        design, and the search card would be floating over live satellite-bright
        map tiles with no backdrop of its own. Fading it back out is what puts
        `search` back on the Skia background that belongs to it, in both
        directions.

        Fading the map's own layer, rather than painting an opaque veil over it,
        is what keeps this cheap: the `AppBackground` shader is ALREADY mounted
        directly underneath, so hiding the map reveals it. A veil would need a
        second full-screen Skia canvas to look the same, and stacked canvases are
        the documented way this app cooks a phone.
      */}
      {!surfaceRetired && mapMounted && (
        <Animated.View
          style={[StyleSheet.absoluteFill, mapVeilStyle]}
          // An invisible map must not eat the pan that belongs to the card
          // sitting on it.
          pointerEvents={currentStageDrawsMap ? 'auto' : 'none'}
        >
          <TripMap />
        </Animated.View>
      )}
      <LinearGradient
        colors={scrimColors as unknown as readonly [string, string, ...string[]]}
        // Weighted toward the top so the fade is imperceptible rather than a
        // linear ramp you can still pick out the end of.
        locations={[0, 0.55, 1]}
        style={styles.topScrim}
        pointerEvents="none"
      />

      {/*
        THE WAY OUT OF A LIVE RIDE.

        BUGFIX — "the rider tracking page needs a button that would allow the
        user to go to the homepage. At the moment, when on the tracking page,
        it's impossible to go back."

        Exactly right, and it was structural rather than an oversight. Hardware
        back calls `popStage()`, which returns null on any server-owned stage —
        deliberately, because the ride cannot go backwards — so back did
        nothing, and no stage drew a header of its own. The rider was sealed
        into the tracking surface for the whole ride.

        The mistake was treating "the stage cannot go back" as "the rider cannot
        leave". They are different questions: the ride stays exactly as live
        when the rider is looking at their wallet, and the home screen already
        carries a live-ride card to bring them back. So this MINIMISES rather
        than closing — the wording matters, which is why it says Home and not a
        back chevron that would imply undoing something.

        Only on server-owned stages. On search/configure/select the panel has
        its own back affordance and this would be a second, contradictory one.
      */}
      {!surfaceRetired && !CLIENT_OWNED_STAGES.includes(stage) && (
        <Animated.View
          entering={FadeIn.duration(260)}
          style={[styles.homePillWrap, { top: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={goHomeKeepingRide}
            accessibilityRole="button"
            accessibilityLabel="Back to home. Your ride stays live."
            hitSlop={8}
            style={({ pressed }) => [
              styles.homePill,
              {
                backgroundColor: withOpacity(colors.backgroundDeep, 0.82),
                borderColor: withOpacity(colors.onSurface, 0.14),
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-down" size={15} color={colors.onSurface} />
            <RNText style={[styles.homePillText, { color: colors.onSurface }]}>Home</RNText>
          </Pressable>
        </Animated.View>
      )}

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

      {/*
        THE ONE SHEET, hosted above every stage.

        It takes stage NAMES, never nodes: names are strings, so this component
        re-rendering when a panel's content changes cannot re-render the trip
        surface, and therefore cannot re-render the stages that publish into it.
        The stages hand their panel bodies to `SheetContent`, which routes them
        here through the slot store.

        It is rendered last so it sits above the stage chrome — the sheet is the
        foreground object in this scene, and the headers and chips float on the
        map behind it.
      */}
      <TripSheetHost
        current={rendered.current}
        previous={rendered.previous}
        retired={surfaceRetired}
      />
      </SheetMetricsProvider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  /**
   * Ends the home screen. `/trip` sits over `(tabs)` as a transparentModal and
   * `(tabs)` is itself transparent, so without this the layer directly behind
   * this screen is home's furniture rather than the shader. The colour is
   * applied at the call site because this sheet is theme-less. See the render.
   */
  opaqueFloor: StyleSheet.absoluteFillObject,
  homePillWrap: { position: 'absolute', left: spacing.lg, zIndex: 20 },
  homePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  homePillText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall, letterSpacing: 0.1 },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // 200 pt covered a third of the screen. With the stage panel occupying the
    // bottom, that left only a band across the middle of the map actually
    // clear — and the scrim was still plainly visible, which was the whole
    // complaint. It only has to reach far enough to sit behind the status bar
    // and the connection chip; past that it is darkening map for no reason.
    height: 118,
  },
});
