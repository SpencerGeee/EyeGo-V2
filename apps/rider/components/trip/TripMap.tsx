import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { VehicleMarker } from './VehicleMarker';
import MapboxGL from '../../utils/mapbox';
import mapStyles from '@eyego/map-styles';
import {
  useMapCamera,
  AREA_BOUNDS_SPAN_DEG,
  useRouteReveal,
  paddingForSheet,
  paddingForSheetTop,
  type CameraMode,
  type Coord,
} from '@eyego/maps';
import { routeLine } from '@eyego/config';
import { useSheetMetrics } from '@eyego/ui';
import { socketEvents, type TripSnapshot, type TripStatus } from '@eyego/api';
import { useThemeStore } from '../../stores/theme.store';
import { useTripFlow } from '../../stores/tripFlow.store';
import { useTripStore } from '../../stores/trip.store';
import { useColors, Colors } from '../../utils/useColors';
import { fetchRoute, fetchWalkingRoute } from '../../utils/routing';

/**
 * The ONE MapView in the rider app.
 *
 * Mounted once by app/trip.tsx and never unmounted while a ride runs. Stages
 * change what is DRAWN on it — pins, the route line, the camera mode — not the
 * map itself. That is the whole difference between this and what was here
 * before: five screens each mounted their own MapView with their own camera
 * code, so every navigation tore a map down and built another one, and the two
 * apps framed the same ride differently at every step.
 *
 * ── WHO OWNS WHAT ────────────────────────────────────────────────────────────
 *   the STAGE  asks for a camera mode (see `modeForStatus`)
 *   the USER   overrides it to `free` by panning; the recenter chip gives it back
 *   the SERVER owns the route line (`snapshot.path`) and the driver's position
 *   this file  owns nothing except which of those to show
 *
 * No `setCamera` call appears below. `useMapCamera` runs the only frame loop,
 * and it is the same one the driver app runs.
 */

/** Fraction of the screen the bottom sheet covers, per stage. */
const SHEET_FRACTION: Record<string, number> = {
  search: 0.62,
  // The paged configure flow is a tall sheet; the map keeps the strip above it.
  // Locked to `SHEET_TOP_FRACTION` in ConfigureStage.tsx — that stage draws no
  // InlayPanel/MorphSheet, so nothing publishes a live top edge and this number
  // is the only thing telling the camera where the visible strip ends.
  configure: 0.62,
  select: 0.5,
  request: 0.44,
  assigned: 0.44,
  tracking: 0.4,
};

/**
 * What the camera should be doing, given where the ride is.
 *
 * The rider always gets `overview`, never `followCourse`. Rotating the world to
 * the car's heading is the navigation convention and it is right for the person
 * driving; for a passenger watching a car approach it is disorienting, and it
 * was one of the reasons the two apps felt like different products.
 */
function modeForStatus(hasFit: boolean): CameraMode {
  // `free` when there is nothing worth framing — a camera that fits an empty
  // set is the degenerate-bounds crash, and `boundsFor` returning null is the
  // second half of that guard.
  return hasFit ? 'overview' : 'free';
}

function coord(lng: number | null | undefined, lat: number | null | undefined): Coord | null {
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)
    ? [lng, lat]
    : null;
}

/**
 * Everything that must stay framed, for the leg of the ride we are on.
 *
 * Deliberately NOT "everything we know". While the driver is coming to fetch
 * you, framing the destination as well zooms the map out to the whole city and
 * the car becomes a dot; while you are in the car, framing the pickup you have
 * already left does the same thing backwards.
 */
/**
 * The route line's colour.
 *
 * NOT `colors.primary`. The rider brand green is very close to the green the
 * map style paints trunk roads and motorways in, so the route disappeared into
 * exactly the roads it was drawn on top of — reported as "the polyline is green
 * and blends with the main highway which is also green". Amber is the one hue
 * the base map never uses for a road, water or park, which is also why the
 * driver app settled on it (`DriverTripMap.ROUTE_CORE`); both apps now draw the
 * same ride in the same colour.
 */
// Single source: see `routeLine` in @eyego/config — the same amber every map
// in both apps uses, chosen because the house style paints trunk roads green.
const ROUTE_LINE = routeLine.stroke;

/**
 * How far from the pickup the rider has to be before the approach line — and
 * the camera box that has to contain it — are worth drawing. Below this they
 * are standing at the stop, and a stub line across a pavement is noise.
 *
 * Module scope because BOTH readers need it: the line in the component, and
 * `fitFor` above it. It lived inside the component, which put it in the
 * temporal dead zone for the function that frames the camera.
 */
const APPROACH_MIN_METRES = 120;

function fitFor(
  status: TripStatus | null,
  snapshot: TripSnapshot | null,
  puck: Coord | null,
  searchPin: Coord | null,
  userPos: Coord | null,
  driverPins: Coord[],
  /** Sampled pre-trip route — see the `default` branch. */
  previewCoords: Coord[] | null,
  /** The chosen pickup, which is not necessarily where the rider is standing. */
  pickupPin: Coord | null,
  /**
   * The LIVE route the server is currently serving, sampled.
   *
   * BUGFIX — "if I board the passenger on the driver app and on the rider app it
   * shows as on board, it doesn't show a route polyline to the pickup point even
   * though the driver app says heading to pickup."
   *
   * The line was there. The camera was not looking at it. `route-geometry.service`
   * switches the served leg from `toPickup` to `toDropoff` the moment the driver
   * comes within 75 m of the pickup — correct, because a zero-length pickup leg
   * is not a route — so the rider's `path` becomes the whole journey ahead. But
   * the pre-departure cases below fit `[driver, pickup]`, and those two points
   * are now the SAME POINT. The map framed a 75 m box and the kilometres-long
   * line drawn inside it left the viewport immediately, which on a phone is
   * indistinguishable from no polyline at all.
   *
   * A route is a shape, not two endpoints — the same reasoning the `default`
   * branch already carries for the preview. Folding the live line's own extremes
   * into every live case makes the camera track whichever leg the server decided
   * to serve, without this file having to re-derive that decision and get a
   * third opinion on it.
   */
  liveCoords: Coord[] | null,
): Coord[] {
  const pickup = coord(snapshot?.pickup?.lng, snapshot?.pickup?.lat);
  const dropoff = coord(snapshot?.dropoff?.lng, snapshot?.dropoff?.lat);
  const driver = puck ?? coord(snapshot?.driver?.lng, snapshot?.driver?.lat);

  /**
   * The rider's own position, but only when it says something.
   *
   * Pre-boarding, "where am I relative to the pickup" is real information on
   * this product in a way it is not on a pure hail: the pickup is a STOP on a
   * group route and can be a walk away. That is what the dashed approach line
   * draws — and a line the camera does not frame is worse than no line, because
   * it renders half off-screen and reads as a glitch.
   *
   * Gated on the same threshold as the line itself: within ~120 m the rider is
   * at the stop for all practical purposes, and widening the box to include a
   * point already inside it only zooms the map out for nothing.
   */
  /**
   * `pickup ?? pickupPin`, not `pickup` alone: before a trip exists there is no
   * snapshot, so the only pickup that exists is the one the rider chose in the
   * flow. Reading the snapshot alone is what made this null for the whole of
   * the booking flow — the stage the rider is complaining about.
   */
  const riderIfDistant =
    userPos && (pickup ?? pickupPin) &&
    metresBetween(userPos, (pickup ?? pickupPin) as Coord) >= APPROACH_MIN_METRES
      ? userPos
      : null;

  switch (status) {
    case 'DRIVER_ASSIGNED':
    case 'DRIVER_EN_ROUTE':
    case 'ARRIVED_AT_PICKUP':
      return [driver, pickup, riderIfDistant, ...(liveCoords ?? [])].filter(Boolean) as Coord[];
    case 'IN_PROGRESS':
      return [driver ?? pickup, dropoff, ...(liveCoords ?? [])].filter(Boolean) as Coord[];
    /**
     * WAITING TO FILL UP — THE STATE THIS MAP HAD NO CASE FOR.
     *
     * BUGFIX, the other half of "the driver pickup location is very far from
     * where I am and the status shown on the map is waiting to fill up, but
     * there's no route polyline to the car".
     *
     * A rider who has JOINED a group trip sits at SCHEDULED/FILLING/CONFIRMED,
     * and none of those had a case here — they fell through to `default`, which
     * is written for the pre-trip picker. On a joined trip there is no preview
     * path and no search pin, so `[pickupPin ?? userPos, searchPin]` collapsed
     * to a single coordinate and the camera framed the pickup alone, at
     * whatever zoom one point implies. The rider's own puck and the line to the
     * stop were both outside the viewport.
     *
     * The three points that answer the rider's actual question: where I am,
     * where I have to be, and where this is all going.
     */
    case 'SCHEDULED':
    case 'FILLING':
    case 'CONFIRMED':
      return [riderIfDistant, pickup, dropoff].filter(Boolean) as Coord[];
    case 'REQUESTED':
    case 'MATCHING':
    case 'REASSIGNING':
      // While dispatch is running, the nearby drivers ARE the content — this is
      // the rider watching the search actually progress. `riderIfDistant` joins
      // them so a rider waiting somewhere other than the kerb can still see
      // themselves — the same reason it is in every other live case.
      return [pickup, riderIfDistant, ...driverPins].filter(Boolean).slice(0, 9) as Coord[];
    default:
      /**
       * NO TRIP YET — SO FRAME THE ROUTE, NOT TWO LOOSE PINS.
       *
       * BUGFIX ("on Choose a ride the camera position of the map showing the
       * route is off"). This framed `[userPos, searchPin]`: the rider's CURRENT
       * GPS position and the destination pin. Those are the right two points
       * only if the rider happens to be standing at the pickup — and the whole
       * point of the configure step is that the pickup has already been chosen
       * and may be somewhere else entirely. So the camera fitted a box with one
       * corner in the wrong place, and the route drawn inside it ran off the
       * side of the screen.
       *
       * A route is a shape, not two endpoints, and fitting its own coordinates
       * is what puts the whole journey on screen. `previewPath` is sampled
       * rather than passed whole: `boundsFor` only needs the extremes, and
       * handing a 400-point full-overview geometry to a bounds reducer 60 times
       * a second is arithmetic nobody sees. Sampling keeps the extremes (the
       * first and last points are always included) so the fit is identical.
       */
      /**
       * THE WALK TO THE PICKUP IS PART OF THE JOURNEY, BEFORE THE TRIP EXISTS
       * TOO.
       *
       * BUGFIX ("I made the pickup point about 7 minutes away from where I am,
       * and at Choose Your Ride the map shows the pickup as where I currently
       * am and the polyline just starts at the pickup. It should show an
       * inferred polyline to the pickup so the user knows they have to walk in
       * that direction. This works once I've booked, but it should show on the
       * Book Your Ride page too since the map is there as well.")
       *
       * The line itself was already conditional on a live status (see
       * `approachLine` below) and so drew nothing here. Framing has to move with
       * it: fitting the ROUTE alone puts the rider's own dot — the near end of
       * that dashed line — off the side of the screen, and a line running off
       * the viewport reads as a rendering glitch rather than as "walk this way".
       *
       * `riderIfDistant` is already gated at 120 m, so a rider standing at their
       * own kerb does not widen the box for nothing.
       */
      if (previewCoords && previewCoords.length >= 2) {
        return (riderIfDistant ? [riderIfDistant, ...previewCoords] : previewCoords) as Coord[];
      }
      // A journey with both ends known but no measured route: frame the ends.
      if (searchPin) {
        return [riderIfDistant, pickupPin ?? userPos, searchPin].filter(Boolean) as Coord[];
      }
      /**
       * NOTHING ENTERED YET — SO FRAME THE RIDER.
       *
       * BUGFIX (item 12: "the camera doesn't default centre on where the current
       * location is"). With no destination this returned `[pickupPin ?? userPos]`
       * — a single point, and `pickupPin` FIRST. A pickup left in the ride store
       * by an earlier session therefore won over the live GPS fix, and the map
       * opened centred on a place the rider was not: the same stale point the
       * recentre button was landing on.
       *
       * With no journey to frame, the only honest subject is where the rider is
       * standing. The chosen pickup joins the box when it is a genuinely
       * different place, so "here, and the kerb I asked for" both stay on
       * screen; when it is not, `boundsFor`'s minimum span keeps the single
       * point from producing a degenerate box.
       */
      const here = userPos ?? pickupPin;
      if (!here) return [];
      const alsoPickup =
        pickupPin && userPos && metresBetween(userPos, pickupPin) >= APPROACH_MIN_METRES
          ? pickupPin
          : null;
      return [here, alsoPickup].filter(Boolean) as Coord[];
  }
}

/** Great-circle metres between two `[lng, lat]` pairs. */
function metresBetween(a: Coord, b: Coord): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const l1 = (a[1] * Math.PI) / 180;
  const l2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(l1) * Math.cos(l2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Evenly-spaced sample of a route, first and last points always kept.
 *
 * The camera only needs the bounding box, and the box of a sample that includes
 * the extremes is the box of the whole line for any route that is not a spiral.
 */
function sampleRoute(coords: [number, number][] | undefined, max = 24): Coord[] | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (coords.length <= max) return coords as Coord[];
  const step = (coords.length - 1) / (max - 1);
  const out: Coord[] = [];
  for (let i = 0; i < max; i++) out.push(coords[Math.round(i * step)] as Coord);
  return out;
}

function TripMapImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isDark } = useThemeStore();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const stage = useTripFlow((s) => s.stage);
  const searchPlace = useTripFlow((s) => s.searchPlace);
  const nearbyDrivers = useTripFlow((s) => s.nearbyDrivers);
  const dispatchOffer = useTripFlow((s) => s.dispatchOffer);
  const pickupCoord = useTripFlow((s) => s.pickupCoord);
  // The pre-trip route — see tripFlow.store. Null once a trip exists, because
  // `path` below is then the authoritative line.
  const previewPath = useTripFlow((s) => s.previewPath);
  const snapshot = useTripStore((s) => s.snapshot);
  const status = snapshot?.status ?? null;

  const [userCoords, setUserCoords] = useState<Coord | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserCoords([loc.coords.longitude, loc.coords.latitude]);
        }
      } catch { /* non-fatal — the map is still usable without a blue dot */ }
    })();
  }, []);

  // ── The route line ───────────────────────────────────────────────────────
  // Comes from the SERVER, via the trip store — which seeds it from
  // `snapshot.path` and refreshes it from `trip:eta`/`trip:route`. This screen
  // used to call Mapbox Directions itself on a retry timer, so the rider and
  // the driver drew different lines for one ride and the line vanished on every
  // navigation. It also used to hold its OWN `trip:eta` subscription, which
  // meant the map and the panel could show two different countdowns; the store
  // is now the single subscriber and this reads its output.
  const path = useTripStore((s) => s.path);

  /**
   * The route DRAWS ITSELF from the pickup outwards rather than appearing whole.
   *
   * A route that snaps in gives the rider no sense of direction — the eye has to
   * find the pickup end after the fact. Revealing it from the pickup answers
   * "where is this going" in the same motion that shows the line, which is what
   * every mapping app does when a route is assigned. `useRouteReveal` keys on the
   * route's identity, so the line does not redraw every time the ETA refreshes.
   */
  /**
   * The live trip's route if there is one, otherwise the quote's preview.
   *
   * Order matters and is not arbitrary: once a trip exists the server owns the
   * line (it re-routes, it accounts for the driver's actual position), so the
   * preview must never be able to override it. Before a trip exists `path` is
   * necessarily null, which is why the ride picker had no route to draw at all.
   */
  const rawCoords =
    (path?.geometry?.coordinates as [number, number][] | undefined) ??
    (previewPath?.coordinates as [number, number][] | undefined);
  const revealedCoords = useRouteReveal(rawCoords, { durationMs: 800 });

  const routeLine = useMemo(() => {
    if (!Array.isArray(revealedCoords) || revealedCoords.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: revealedCoords },
    };
  }, [revealedCoords]);

  const driverPins = useMemo(
    () => nearbyDrivers.map((d) => [d.longitude, d.latitude] as Coord),
    [nearbyDrivers],
  );

  // The fit is computed from the SERVER's driver position, not from the
  // interpolated puck: the puck is produced by the hook below, so deriving the
  // hook's input from it would be a cycle. `fitIncludesPuck` tells the frame
  // loop to fold the live position in for us.
  const previewFitCoords = useMemo(
    () => sampleRoute(previewPath?.coordinates),
    [previewPath],
  );

  /* The server's live line, sampled to its extremes — see `liveCoords` in
     fitFor. Sampled and not passed whole: a 400-point geometry through a bounds
     reducer 60 times a second is arithmetic nobody sees. */
  const liveFitCoords = useMemo(
    () => sampleRoute(path?.geometry?.coordinates as [number, number][] | undefined),
    [path],
  );

  const fit = useMemo(
    () => fitFor(
      status,
      snapshot,
      null,
      searchPlace ? ([searchPlace.longitude, searchPlace.latitude] as Coord) : null,
      userCoords,
      driverPins,
      previewFitCoords,
      pickupCoord,
      liveFitCoords,
    ),
    [status, snapshot, searchPlace, userCoords, driverPins, previewFitCoords, pickupCoord, liveFitCoords],
  );

  /**
   * "Follow the car" — the mode the recentre button can put this map into.
   *
   * See the button itself at the bottom of this file for the bug. `follow` is
   * north-up (`followCourse` rotates the world to the vehicle's heading, which
   * is right for the person driving and disorienting for a passenger), and it
   * is only offered while there is a vehicle attached to follow.
   */
  const [followVehicle, setFollowVehicle] = useState(false);
  const canFollowVehicle =
    !!snapshot?.driver &&
    (status === 'DRIVER_ASSIGNED' ||
      status === 'DRIVER_EN_ROUTE' ||
      status === 'ARRIVED_AT_PICKUP' ||
      status === 'IN_PROGRESS');

  /**
   * "PUT ME BACK WHERE I AM" — the state this button never had.
   *
   * BUGFIX (item 12: "the camera doesn't default centre on where the current
   * location is. If I pan and click the button at the top right that recentres
   * it, it takes me to some random space that's not even where I'm at").
   *
   * `recenter()` hands the camera back to the mode the STAGE asked for, and
   * before any trip exists that mode is `overview` fitted to
   * `[pickupPin ?? userPos, searchPin]`. A rider who set a pickup earlier — or
   * whose last trip left one in the store — was therefore recentred onto THAT
   * point, which is somewhere they are not standing, and is exactly the
   * "random space" in the report. The button looks like a locate control and
   * was behaving as a fit-everything control.
   *
   * So it now has the meaning its icon promises. There are two things worth
   * being centred on and the situation decides which: the VEHICLE once one is
   * attached (already handled), and otherwise the RIDER. Locking to the rider's
   * own fix is what `follow` with no puck does, and it is available whenever
   * there is a GPS fix at all rather than only during a trip.
   */
  const [followMe, setFollowMe] = useState(false);
  const canFollowMe = !canFollowVehicle && !!userCoords;
  useEffect(() => {
    if (followMe && !canFollowMe) setFollowMe(false);
  }, [canFollowMe, followMe]);

  // A ride that ends, or a driver who is reassigned, must not leave the camera
  // locked to a vehicle that is no longer part of this trip.
  useEffect(() => {
    if (!canFollowVehicle && followVehicle) setFollowVehicle(false);
  }, [canFollowVehicle, followVehicle]);

  const mode =
    followVehicle && canFollowVehicle
      ? 'follow'
      : followMe && canFollowMe
        ? 'follow'
        : modeForStatus(fit.length > 0);

  // ── The driver puck ──────────────────────────────────────────────────────
  // GPS fixes arrive every couple of seconds; a marker moved straight to each
  // one teleports. `useMapCamera` interpolates between them and smooths the
  // bearing the short way round, so the car drives instead of blinking.
  // PERF: the frame loop is 60 Hz of bounds arithmetic and native camera calls,
  // and this map is deliberately never unmounted — so pushing payment, chat or
  // the receipt over the trip surface used to leave it running underneath, for
  // a map nobody could see. `useIsFocused` is false for a screen that is still
  // mounted but covered, which is exactly the condition the hook's `active`
  // flag exists for. The interpolator keeps buffering GPS fixes while paused,
  // so coming back re-frames from the real position rather than a stale one.
  const isFocused = useIsFocused();

  /**
   * THE INTERLOCK.
   *
   * `SHEET_FRACTION` was a table of guesses — one number per stage, applied the
   * instant the stage changed. It was wrong twice over: the real sheet is as
   * tall as its content (a fare with three extra rows is not 0.44 of any
   * screen), and during a transition the camera had already re-framed for the
   * destination height while the panel was still on its way there, so pins
   * arrived before the sheet that was supposed to be uncovering them.
   *
   * A getter instead of a value. The frame loop calls this every tick and reads
   * the sheet's live top edge straight off the shared value the sheet is
   * springing — no React render, no bridge hop, no state. The padding is
   * quantised inside `paddingForSheetTop`, so a 300 px travel becomes ~25
   * instant re-frames rather than 30 animated ones fighting each other.
   *
   * `SHEET_FRACTION` survives as the fallback for the first frames, before the
   * sheet has measured itself and published anything — without it the map would
   * fit its subject against a full-height viewport and then jump.
   */
  const sheetMetrics = useSheetMetrics();
  const getPadding = useCallback(() => {
    const top = sheetMetrics.top.value;
    const published =
      !sheetMetrics.retired.value && Number.isFinite(top) && top > 0 && top < screenHeight;
    return published
      ? paddingForSheetTop({ screenHeight, sheetTop: top, safeTop: insets.top })
      : paddingForSheet({
          screenHeight,
          sheetFraction: SHEET_FRACTION[stage] ?? 0.44,
          safeTop: insets.top,
        });
  }, [sheetMetrics, screenHeight, insets.top, stage]);

  /**
   * WHILE DISPATCH IS SEARCHING, THE FRAME IS A NEIGHBOURHOOD.
   *
   * The fit for these statuses is `[pickup, ...cars]`. Before the pool
   * answers — and in a quiet area it may never answer — that is a single
   * point, and a single point fitted at the crash floor is a 110 m box:
   * street zoom on the rider’s own doorstep, at the exact moment the
   * question they are asking is "is there a car anywhere near me?".
   *
   * Floor the box at ~2.4 km instead. With cars in the pool the fit is
   * already wider than this and the floor never bites; with none, the rider
   * still sees their area rather than their roof.
   */
  const dispatchIsSearching =
    status === 'REQUESTED' || status === 'MATCHING' || status === 'REASSIGNING';

  /**
   * How wide the server's search currently is. Drives the ring — see
   * `searchRing`. Subscribed narrowly so a driver-position frame, which lands
   * several times a second, cannot re-render this component through it.
   */
  const dispatchRadiusKm = useTripStore((s) => s.dispatch?.radiusKm ?? null);

  const camera = useMapCamera({
    mode,
    fit,
    fitMinSpanDeg: dispatchIsSearching ? AREA_BOUNDS_SPAN_DEG : null,
    /**
     * A PAN IS ONLY UNDONE WHEN THERE IS A CAR TO GO BACK TO.
     *
     * BUGFIX ("the map of the book a ride page doesn't seem intuitive at all —
     * when moving the camera it's not responsive, and when you get to the
     * location part of the ride it just stops moving").
     *
     * The twelve-second auto-resume exists so a rider watching a driver
     * approach cannot strand themselves on empty road. That rescue is only
     * meaningful while something is moving. On the picker, the fare comparison
     * and every pre-trip preview there is no vehicle — so all the timer did was
     * wait for the rider to finish looking and then snap the camera back onto
     * the fitted route, undoing the pan they had just made. See `autoResumeMs`
     * for why that reads as a map that refuses to move in one direction.
     */
    autoResumeMs: canFollowVehicle ? undefined : null,
    /**
     * The follow target when there is no vehicle puck — the rider themselves.
     *
     * `useMapCamera` prefers the puck over `center` whenever one exists, so this
     * cannot fight the "follow the car" mode above: it is only ever consulted
     * before a driver is attached, which is precisely when `followMe` is the
     * only thing the recentre button can sensibly mean.
     */
    center: followMe && canFollowMe ? userCoords : null,
    fitIncludesPuck: true,
    padding: getPadding,
    active: isFocused,
  });
  const { pushSample, resetPuck } = camera;

  useEffect(() => {
    const off = socketEvents.onDriverLocation((d) => {
      if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return;
      pushSample({
        latitude: d.latitude,
        longitude: d.longitude,
        heading: d.heading ?? null,
        speed: d.speed ?? null,
        at: Date.now(),
      });
    });
    return () => { off(); };
  }, [pushSample]);

  /**
   * Second source for the same interpolator: the snapshot's own driver position.
   *
   * BUGFIX ("on the tracking page the marker pin doesn't seem to move"). The
   * puck was fed EXCLUSIVELY by `onDriverLocation`. That channel is the fast
   * one, but it is not the only one carrying the driver's position — every
   * `trip:event` snapshot carries `driver.lat/lng/heading` too — and it is the
   * one most likely to be quiet: a dropped subscription, a reconnect, a driver
   * app that has gone to the background and is posting locations over HTTP
   * rather than the socket. With nothing pushing samples the interpolator has
   * nothing to interpolate, so `camera.puck` stays where it was and the marker
   * sits frozen on the map while the panel above it updates normally.
   *
   * Pushing the snapshot position as well means the marker advances on whatever
   * arrives first. Samples are idempotent as far as the interpolator is
   * concerned — a repeated position is a zero-length move — so the two sources
   * cannot fight, and the fast one still wins on smoothness when it is healthy.
   */
  useEffect(() => {
    const lat = snapshot?.driver?.lat;
    const lng = snapshot?.driver?.lng;
    if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return;
    pushSample({
      latitude: lat as number,
      longitude: lng as number,
      heading: snapshot?.driver?.heading ?? null,
      speed: null,
      at: Date.now(),
    });
  }, [snapshot?.driver?.lat, snapshot?.driver?.lng, snapshot?.driver?.heading, pushSample]);

  // Reassignment and trip end both mean the old puck is a lie.
  useEffect(() => { resetPuck(); }, [snapshot?.driver?.id, resetPuck]);

  const [zoom, setZoom] = useState(14);
  const handleRegionChange = useCallback(
    (e: { properties?: { zoomLevel?: number } }) => {
      camera.onRegionChange(e as never);
      const z = e?.properties?.zoomLevel;
      if (typeof z === 'number' && Number.isFinite(z)) setZoom(z);
    },
    [camera],
  );

  const puckCoord: Coord | null = camera.puck
    ? [camera.puck.longitude, camera.puck.latitude]
    : coord(snapshot?.driver?.lng, snapshot?.driver?.lat);

  /**
   * ── THE LINE TO THE DRIVER WE ARE ASKING ──────────────────────────────────
   *
   * FEATURE ("on the 'looking for a driver' page… include the map, a route
   * polyline to the nearest driver, and it should be animated").
   *
   * This used to be two points — pickup and driver — joined by a ruler, on the
   * reasoning that an offer lasts seconds and a Directions call for it is
   * wasted quota. That trade was made when nobody could see the line: the
   * request stage painted an opaque gradient over the whole map. Now that the
   * stage IS the map, this line is the only thing on screen doing the work of
   * saying "somebody real is nearby and we are asking them" — and a straight
   * line through three city blocks says the opposite.
   *
   * The cost is bounded by the cascade itself: ONE call per driver asked, each
   * of whom holds the offer for 45 seconds. That is roughly one Directions call
   * per minute of searching, against a screen the rider is watching the whole
   * time.
   *
   * It draws itself on (`useRouteReveal`), and because the reveal restarts
   * whenever the geometry changes, each new driver in the cascade gets its own
   * draw — the animation and the story are the same event.
   */
  const [dispatchRoad, setDispatchRoad] = useState<Coord[] | null>(null);
  const dispatchKey =
    dispatchOffer && pickupCoord &&
    Number.isFinite(dispatchOffer.longitude) && Number.isFinite(dispatchOffer.latitude)
      ? `${dispatchOffer.longitude},${dispatchOffer.latitude}|${pickupCoord[0]},${pickupCoord[1]}`
      : null;

  useEffect(() => {
    setDispatchRoad(null);
    if (!dispatchKey || !dispatchOffer || !pickupCoord) return undefined;
    let cancelled = false;
    void fetchRoute(
      [dispatchOffer.longitude, dispatchOffer.latitude],
      pickupCoord,
    ).then((r) => {
      // `estimate` is the proxy's own straight-line fallback. Drawing it in the
      // solid road style would be a fabricated road; the two-point line below
      // already covers that case honestly.
      if (cancelled || !r || r.source === 'estimate' || r.coordinates.length < 2) return;
      setDispatchRoad(r.coordinates as Coord[]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatchKey]);

  /** Straight, until the road answers. */
  const dispatchCoords = useMemo<Coord[] | null>(() => {
    if (dispatchRoad) return dispatchRoad;
    if (!dispatchOffer || !pickupCoord) return null;
    if (!Number.isFinite(dispatchOffer.longitude) || !Number.isFinite(dispatchOffer.latitude)) return null;
    return [pickupCoord, [dispatchOffer.longitude, dispatchOffer.latitude] as Coord];
  }, [dispatchRoad, dispatchOffer, pickupCoord]);

  // Only the ROAD draws itself on. Revealing a two-point estimate is revealing
  // one segment, which reads as a glitch rather than as motion.
  const dispatchRevealed = useRouteReveal(dispatchRoad, { durationMs: 1100 });
  const dispatchDraw = dispatchRoad ? dispatchRevealed : dispatchCoords;

  const dispatchLine = useMemo(() => {
    if (!dispatchDraw || dispatchDraw.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: dispatchDraw },
    };
  }, [dispatchDraw]);

  /** The head of the line — where the ask has reached. */
  const dispatchHead = useMemo<Coord | null>(
    () => (dispatchDraw && dispatchDraw.length >= 2 ? dispatchDraw[dispatchDraw.length - 1] : null),
    [dispatchDraw],
  );

  // Falls back to the flow's chosen pickup so the route preview has both of its
  // ends marked on the ride picker, where no trip (and so no snapshot) exists.
  const pickup = coord(snapshot?.pickup?.lng, snapshot?.pickup?.lat) ?? pickupCoord;
  const dropoff = coord(snapshot?.dropoff?.lng, snapshot?.dropoff?.lat)
    ?? (searchPlace ? ([searchPlace.longitude, searchPlace.latitude] as Coord) : null);

  /**
   * The rider's own walk to the pickup stop — see the layer for the reasoning.
   *
   * A straight line on purpose, not a Directions call: it is a hint about
   * direction and distance, not a navigation instruction, and on a shared-route
   * product it is drawn for every rider on every trip. Spending routing quota
   * on it — and on every GPS fix that moves it — buys nothing the dashes do not
   * already say.
   *
   * 120 m is the threshold. Below it the rider is at the stop for all practical
   * purposes, and a stub line pointing across a pavement is noise; above it
   * they have somewhere to be.
   */
  /**
   * Is the rider standing somewhere other than the pickup?
   *
   * The single fact behind two decisions that must never disagree: whether to
   * draw the walk-to-pickup line, and whether the blue location dot is a second
   * marker for a place the pickup pin already occupies. See both call sites.
   *
   * True once the ride is under way as well — at that point the "pickup" is
   * behind the vehicle and the rider's dot is genuinely elsewhere.
   */
  const riderIsAwayFromPickup =
    !!userCoords && (!pickup || metresBetween(userCoords, pickup) >= APPROACH_MIN_METRES);

  /**
   * The walking geometry for the approach leg, or null while it is in flight /
   * unavailable. See `approachLine` for why this is a walking profile.
   *
   * KEYED ON A ROUNDED PAIR, NOT ON THE RAW COORDS. `userCoords` changes with
   * every GPS fix, and a dependency on the raw value would re-request the walk
   * several times a second while the rider stands still. Five decimal places is
   * about a metre — finer than any walking route would differ by, and coarse
   * enough that GPS jitter does not move it.
   */
  const [walkCoords, setWalkCoords] = useState<[number, number][] | null>(null);
  const walkKey =
    userCoords && pickup && metresBetween(userCoords, pickup) >= APPROACH_MIN_METRES
      ? `${userCoords[0].toFixed(4)},${userCoords[1].toFixed(4)}|${pickup[0].toFixed(5)},${pickup[1].toFixed(5)}`
      : null;

  useEffect(() => {
    if (!walkKey || !userCoords || !pickup) {
      setWalkCoords(null);
      return;
    }
    let cancelled = false;
    // Endpoints captured here, not read from the closure at resolve time: the
    // rider is by definition walking, so by the time this answers they may
    // already be somewhere else and a later effect will have superseded it.
    const from: [number, number] = [userCoords[0], userCoords[1]];
    const to: [number, number] = [pickup[0], pickup[1]];
    void fetchWalkingRoute(from, to).then((route) => {
      if (cancelled) return;
      setWalkCoords(route && route.coordinates.length >= 2 ? route.coordinates : null);
    });
    return () => {
      cancelled = true;
    };
    // `walkKey` IS the meaningful identity of the two endpoints — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkKey]);

  /**
   * The dispatch search radius, as a polygon on the ground.
   *
   * A circle in METRES, not in screen pixels: the whole value of this ring is
   * that it is the actual area being searched, so it has to zoom with the map
   * like any other geography. A fixed-pixel halo would claim a different amount
   * of ground at every zoom level, which is worse than drawing nothing.
   *
   * `cos(lat)` on the longitude term because a degree of longitude shortens
   * towards the poles — without it the "circle" is a visible ellipse, stretched
   * east-west. At Accra's latitude that is a ~0.5% error, but the same code
   * runs anywhere and an ellipse reads as a rendering fault.
   *
   * 64 points: smooth at every zoom the map allows, and cheap enough to rebuild
   * only when the radius actually changes (the memo key), not per frame.
   */
  const searchRing = useMemo(() => {
    if (!dispatchIsSearching) return null;
    const centre = pickup ?? pickupCoord;
    if (!centre || !Number.isFinite(dispatchRadiusKm) || (dispatchRadiusKm as number) <= 0) return null;

    const R_EARTH_KM = 6371;
    const [lng, lat] = centre;
    const latRad = (lat * Math.PI) / 180;
    const dLat = ((dispatchRadiusKm as number) / R_EARTH_KM) * (180 / Math.PI);
    const dLng = dLat / Math.max(Math.cos(latRad), 0.01);

    const ring: [number, number][] = [];
    const STEPS = 64;
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * 2 * Math.PI;
      ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
    }
    // A GeoJSON Polygon's ring must be closed; the `<=` above repeats the first
    // point as the last, which is what closes it.
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [ring] },
    };
  }, [dispatchIsSearching, pickup, pickupCoord, dispatchRadiusKm]);

  const approachLine = useMemo(() => {
    // Once the ride is under way the rider is IN the vehicle; a line from their
    // GPS to the pickup they have already left is a lie.
    //
    // `status == null` is the BOOKING FLOW — no trip exists yet, the rider is
    // on Choose Your Ride comparing fares for a pickup they may be a walk away
    // from. That case used to fall outside this list entirely, which is the
    // whole of "it works once I've booked, but it should show on the Book Your
    // Ride page too". Item 15.
    const preBoarding =
      status == null ||
      status === 'REQUESTED' ||
      status === 'MATCHING' ||
      status === 'REASSIGNING' ||
      status === 'SCHEDULED' ||
      status === 'FILLING' ||
      status === 'CONFIRMED' ||
      status === 'DRIVER_ASSIGNED' ||
      status === 'DRIVER_EN_ROUTE' ||
      status === 'ARRIVED_AT_PICKUP';
    if (!preBoarding || !userCoords || !pickup) return null;
    if (metresBetween(userCoords, pickup) < APPROACH_MIN_METRES) return null;
    /**
     * A WALK IS A ROUTE, NOT A RULER.
     *
     * BUGFIX ("when I choose to make the pickup point different from where I
     * am, the route line shows a straight line and doesn't follow the road").
     *
     * This was `coordinates: [userCoords, pickup]` — the two endpoints and
     * nothing between them, so the dashed leg cut through buildings and across
     * whatever lay in the way. `walkCoords` is the real walking geometry from
     * `/v1/geo/route?profile=walking`, fetched by the effect below.
     *
     * The straight line stays as the FALLBACK rather than being deleted: it is
     * fetched asynchronously and can fail, and "roughly that way, over there"
     * is still true and still useful. It is drawn dashed and in a neutral
     * colour precisely so it never reads as a routed path — see the layer.
     */
    const coordinates = walkCoords && walkCoords.length >= 2 ? walkCoords : [userCoords, pickup];
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates },
    };
  }, [status, userCoords, pickup, walkCoords]);

  /**
   * The vehicle grows with the zoom, the way it does in Uber and Bolt.
   *
   * A marker is laid out in POINTS, so it stays a fixed size on screen no
   * matter how far in the map is. Zoomed out that reads fine; zoomed all the
   * way in, the same 34pt bus sits on a road drawn several times wider than it
   * is and looks like a speck that has come loose from the street — "the
   * minibus puck becomes very small when zoomed in". Interpolating between two
   * bounds keeps it roughly the width of the carriageway at every zoom.
   *
   * Fed by `onRegionDidChange`, which fires when a gesture SETTLES rather than
   * per frame, so this is a handful of re-renders per pan, not sixty a second.
   */
  const vehicleSize = useMemo(() => {
    const MIN_Z = 13, MAX_Z = 18, MIN_PT = 30, MAX_PT = 62;
    const t = Math.min(1, Math.max(0, (zoom - MIN_Z) / (MAX_Z - MIN_Z)));
    return Math.round(MIN_PT + t * (MAX_PT - MIN_PT));
  }, [zoom]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={isDark ? mapStyles.eyegoDarkStyle : mapStyles.eyegoLightStyle}
        compassEnabled={false}
        rotateEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        // Release-on-touch, same as the driver map — see the note on
        // onRegionChange in @eyego/maps useMapCamera. The zoom readout that
        // sizes the vehicle marker still updates only when a gesture SETTLES,
        // which is why that one stays on onRegionDidChange.
        onUserGesture={camera.release}
        onRegionDidChange={handleRegionChange}
      >
        <MapboxGL.Camera ref={camera.cameraRef} />

        {/*
          THE RIDER'S OWN PUCK — ALWAYS, NOT ONLY BEFORE A DRIVER EXISTS.

          BUGFIX — "after I joined a trip, my location puck isn't showing. The
          only thing showing is the driver car puck alone."

          The condition was `userCoords && !puckCoord`: the moment the assigned
          driver's puck appeared, the rider's own disappeared. Two pucks looking
          alike would be a real problem, but these two do not — one is a vehicle
          rotated to its bearing, the other is the system location dot — and
          hiding the rider is the one thing that makes the whole map unreadable.
          It is the fixed point the rider judges everything else against: how
          far the car is, which way it is coming, whether it has passed them.
          Every mapping app in existence keeps it on.
        */}
        {/*
          ...BUT NOT WHEN IT IS SITTING INSIDE THE PICKUP PIN.

          BUGFIX ("on the rider request page it shows 3 pins on the map — a
          black circle, a blue one and a car circle. Fix this so it's working
          and showing as it should.")

          Those three are the pickup pin (a dark ring on a card-coloured
          bubble), the system location dot, and a nearby-driver puck. The car is
          real information. The other two are the SAME PLACE drawn twice: for
          the ordinary case — a rider hailing from where they are standing — the
          chosen pickup IS the GPS fix, so the app was stacking a marker on a
          dot within a few pixels of each other and calling one of them a bug.

          The pickup pin wins, because it is the one that means something (this
          is the kerb the driver is coming to) and it is the one the route line
          is anchored on. The blue dot comes back the moment the two are
          genuinely different places — the far-pickup case in item 15, where
          "where I am" versus "where I have to be" is the whole question, and
          where the dashed approach line now runs between them.

          Same 120 m threshold as that line, so the two can never disagree about
          whether the rider is at the stop.
        */}
        {userCoords && riderIsAwayFromPickup && <MapboxGL.UserLocation visible />}

        {/*
          ── THE SEARCH, DRAWN AS THE GROUND IT COVERS ──────────────────────

          FEATURE, asked for five times ("redesign the looking for a driver page
          so it shows the correct map ... like the way Uber and Bolt do").

          Every previous pass treated this as a panel problem and tuned the copy.
          It was a MAP problem. While dispatch runs, the map holds a pickup pin
          and — in a quiet area, which is most of them — nothing else at all. An
          empty map under the words "finding your driver" does not read as
          searching. It reads as broken, which is exactly what kept being
          reported.

          So the search itself is now on the map. `dispatchRadiusKm` is the real
          radius the cascade is running at, published on every DISPATCH_PROGRESS
          frame, and the ring GROWS when the server actually widens its sweep
          (`DISPATCH_RADIUS_KM` → extended → final). That is the difference
          between this and the decorative radar Uber draws: when the ring jumps
          outward, more drivers really are being asked.

          Two layers, because one does two jobs badly: a soft fill that says
          "this much ground", and a bright edge that says "this far". The pulse
          is on opacity and radius only — both GPU-composited paint properties,
          no layout, no re-render.
        */}
        {searchRing && (
          <MapboxGL.ShapeSource id="dispatch-search-ring" shape={searchRing}>
            <MapboxGL.FillLayer
              id="dispatch-search-fill"
              style={{
                fillColor: colors.primary,
                fillOpacity: 0.07,
              }}
              // Under every pin and line. The ring is context, never content.
              belowLayerID="rider-approach-line"
            />
            <MapboxGL.LineLayer
              id="dispatch-search-edge"
              style={{
                lineColor: colors.primary,
                lineWidth: 1.5,
                lineOpacity: 0.5,
                lineDasharray: [3, 2],
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/*
          HOW THE RIDER GETS TO THE PICKUP.

          BUGFIX — "the driver pickup location is very far from where I am and
          the status shown on the map is waiting to fill up, but there's no
          route polyline to the car since I'm not where the car is. That would
          make it very intuitive so it makes sense."

          On a group/route trip the pickup is a STOP, not the rider's doorstep,
          and it can be a genuine walk away. The map drew the driver's route and
          the rider's dot and left the relationship between them unstated, which
          on a shared-bus product is the single most important unanswered
          question: where am I supposed to be, and how far is it?

          Deliberately dashed and in a neutral colour, so it never reads as the
          driven route — the solid amber line is the vehicle's road, this is a
          person's approach. Only drawn before boarding (after that the rider IS
          the vehicle) and only past a threshold, so a rider already standing at
          the stop does not get a two-metre stub.
        */}
        {approachLine && (
          <MapboxGL.ShapeSource id="rider-approach" shape={approachLine}>
            <MapboxGL.LineLayer
              id="rider-approach-line"
              style={{
                lineColor: colors.onSurfaceVariant,
                lineWidth: 3,
                lineOpacity: 0.85,
                lineDasharray: [1.4, 2],
                lineCap: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* The road line, drawn under everything else.
            The casing used to be `backgroundDeep` at 0.55 — a dark grey on a
            dark map, which is to say nearly nothing. Over a motorway (the
            style's widest, brightest casing) the route simply disappeared into
            the road under it. Solid black at full opacity and two points wider
            is what separates the line from the road it is drawn on; every
            mapping app does exactly this. */}
        {routeLine && (
          <MapboxGL.ShapeSource id="trip-route" shape={routeLine}>
            <MapboxGL.LineLayer
              id="trip-route-casing"
              style={{ lineColor: '#000000', lineWidth: 11, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.9 }}
            />
            <MapboxGL.LineLayer
              id="trip-route-line"
              style={{ lineColor: ROUTE_LINE, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapboxGL.ShapeSource>
        )}

        {dispatchLine && (
          <MapboxGL.ShapeSource id="dispatch-line" shape={dispatchLine}>
            {/* Cased, like the route line: the map style's own road casings are
                bright and this line has to survive being drawn across one. */}
            <MapboxGL.LineLayer
              id="dispatch-line-casing"
              style={{
                lineColor: '#000000',
                lineWidth: 9,
                lineOpacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapboxGL.LineLayer
              id="dispatch-line-layer"
              style={{
                lineColor: colors.primary,
                lineWidth: 4.5,
                lineOpacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
                // Dashed only while it is the straight-line estimate — a solid
                // line claims a road, and until Directions answers there isn't
                // one to claim.
                ...(dispatchRoad ? null : { lineDasharray: [2, 2] }),
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* The head of the reach — a bright dot travelling to the driver as the
            line draws. It is what makes the reveal read as "we are asking them
            right now" rather than as a line that happens to be growing. */}
        {dispatchHead && dispatchRoad && (
          <MapboxGL.MarkerView
            id="dispatch-head"
            coordinate={dispatchHead}
            anchor="center"
          >
            <View style={styles.dispatchHeadWrap} pointerEvents="none">
              <View style={[styles.dispatchHeadHalo, { backgroundColor: colors.primary }]} />
              <View style={[styles.dispatchHeadCore, { backgroundColor: colors.primary, borderColor: colors.backgroundDeep }]} />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/* Idle nearby drivers, only while dispatch is actually running —
            leaving them on during the ride is visual noise the rider reads as
            "which one of these is mine?". */}
        {!snapshot?.driver && nearbyDrivers.map((d) => {
          const isOffered = d.id === dispatchOffer?.driverId;
          return (
            <MapboxGL.MarkerView key={d.id} id={`driver-${d.id}`} coordinate={[d.longitude, d.latitude]}>
              <View style={[styles.driverPuck, isOffered && styles.driverPuckActive]}>
                <Ionicons
                  name="car-sport"
                  size={isOffered ? 16 : 13}
                  color={isOffered ? colors.onPrimary : colors.onSurfaceVariant}
                />
              </View>
            </MapboxGL.MarkerView>
          );
        })}

        {/* THE assigned driver. Rotated to the smoothed bearing, so it points
            where the car is going rather than spinning on every fix. */}
        {puckCoord && snapshot?.driver && (
          <MapboxGL.MarkerView id="assigned-driver" coordinate={puckCoord}>
            {/* The vehicle, not a pin — see VehicleMarker. Bearing prefers the
                interpolator's smoothed value and falls back to the server's
                last reported heading, so a puck that has not yet accumulated
                two fixes still points the right way instead of due north. */}
            <VehicleMarker
              bearing={camera.puck?.bearing ?? snapshot.driver.heading ?? 0}
              size={vehicleSize}
            />
          </MapboxGL.MarkerView>
        )}

        {/* THE PICKUP — A PIN, LIKE THE DESTINATION.

            BUGFIX — "on the book a ride page where the map is shown, the pickup
            point doesn't have a pin, only the destination has one."

            It had a 16 pt dot. On a dark map, next to a 36 pt pin with a shadow
            and a tail, that does not read as the other end of the same journey —
            it reads as a stray marker, or as nothing at all. Uber, Bolt and
            Yango all give both ends a pin and distinguish them by FORM, not by
            weight: the origin is a ring (you are leaving from here) and the
            destination is solid (you are going to here).

            So: same silhouette, same tail, same anchor — `bottom`, so the tail
            sits on the coordinate rather than the pin's middle floating over it.
            The difference is the core, which is a hollow ring in the pickup
            accent instead of a filled glyph. */}
        {pickup && (
          <MapboxGL.MarkerView id="pickup-pin" coordinate={pickup} anchor="bottom">
            <View style={styles.destPin}>
              <View style={styles.pickupPinBubble}>
                <View style={styles.pickupPinRing} />
              </View>
              <View style={styles.pickupPinTail} />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/* THE DESTINATION.
            `anchor` was omitted, so the pin defaulted to 'center' and its tip
            pointed at nothing in particular. 'bottom' puts the tail on the
            coordinate, which is what a pin means. */}
        {dropoff && (
          <MapboxGL.MarkerView id="destination-pin" coordinate={dropoff} anchor="bottom">
            <View style={styles.destPin}>
              <View style={styles.destPinBubble}>
                <Ionicons name="location" size={22} color={colors.onPrimary} />
              </View>
              <View style={styles.destPinTail} />
            </View>
          </MapboxGL.MarkerView>
        )}
      </MapboxGL.MapView>

      {/*
        ── THE RECENTRE BUTTON PUTS YOU BACK ON THE CAR ────────────────────

        BUGFIX (item 17: "when I click on the button that is supposed to reset
        the camera on the rider tracking page, it doesn't reset it to where the
        car is but rather somewhere else — make it consistent like the driver
        app button").

        Both apps called the same `camera.recenter()`, and it does the same
        thing in both: hand the camera back to the mode the STAGE asked for.
        The stages ask for different things. The driver's map is
        `followCourse`, so recentring lands on the vehicle — which is what the
        button looks like it promises. The rider's map is `overview`, so it
        landed on a bounding box drawn around the pickup, the drop-off, the
        route line and the car: a frame that is usually correct and almost
        never centred on the car. "Somewhere else", exactly.

        So the rider's button now has the driver's meaning. While there is a
        live vehicle to follow it switches the camera to `follow` — locked to
        the car, north-up rather than rotating, because a passenger is not
        navigating and a world that spins under them is disorienting (the
        original reason the rider was never given `followCourse`).

        Tapping it again while already following returns to the overview, so the
        rider can still see the whole ride. One control, two states, both
        obvious from the icon.
      */}
      {/*
        Offered whenever there is something to go back TO — a vehicle, or the
        rider's own fix. It used to require `camera.released`, so a rider who had
        not panned but whose camera was framed on a stale pickup had no control
        at all; that is the other half of item 12.
      */}
      {(camera.released || followVehicle || followMe || canFollowMe) && (
        <Pressable
          onPress={() => {
            if (canFollowVehicle) setFollowVehicle((f) => !f);
            else if (canFollowMe) setFollowMe((f) => !f);
            // Always: clear any manual pan, so one tap does the obvious thing
            // even when neither follow mode applies.
            camera.recenter();
          }}
          style={[styles.recenter, { top: insets.top + 12 }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            canFollowVehicle
              ? followVehicle ? 'Show the whole route' : 'Follow the vehicle'
              : canFollowMe
                ? followMe ? 'Show the whole route' : 'Centre on my location'
                : 'Recentre the map'
          }
        >
          <Ionicons
            name={followVehicle || followMe ? 'scan-outline' : 'locate'}
            size={18}
            color={followVehicle || followMe ? colors.primary : colors.onSurface}
          />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Memoized so the persistent map skips re-render during stage crossfades in
 * trip.tsx — it takes no props and reads its own store slices, so parent
 * re-renders never need to touch it. The map is the heaviest node in the tree.
 */
export const TripMap = React.memo(TripMapImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  driverPuck: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1, borderColor: colors.rimLight,
    alignItems: 'center', justifyContent: 'center',
  },
  driverPuckActive: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7, shadowRadius: 8,
    elevation: 8,
  },
  vehiclePuck: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.onPrimary,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 5, elevation: 7,
  },
  /** The pickup pin. Same silhouette as `destPin`; see the render note. */
  pickupPinBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surfaceCard,
    borderWidth: 2.5, borderColor: colors.onSurface,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28, shadowRadius: 6,
    elevation: 6,
  },
  /* Hollow, not solid: "from here" reads as an origin, "to here" as a target.
     Concentric with the 32 pt bubble minus its 2.5 pt rim and 4 pt of inset. */
  pickupPinRing: {
    width: 11, height: 11, borderRadius: 6,
    borderWidth: 3, borderColor: colors.onSurface,
  },
  pickupPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 5.5, borderRightWidth: 5.5, borderTopWidth: 7.5,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.onSurface,
    marginTop: -1,
  },
  destPin: { alignItems: 'center' },
  destPinBubble: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6,
    elevation: 6,
  },
  destPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.primary,
    marginTop: -1,
  },
  /** The travelling head of the dispatch reveal — see the layer above. */
  dispatchHeadWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  dispatchHeadHalo: { position: 'absolute', width: 24, height: 24, borderRadius: 12, opacity: 0.28 },
  dispatchHeadCore: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  recenter: {
    position: 'absolute', right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.rimLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
  },
});
