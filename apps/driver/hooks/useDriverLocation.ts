import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { driverSocketEvents, driverApi } from '@eyego/api';
import { useDriverStore } from '../stores/driver.store';

interface Coords {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
}

interface Options {
  enabled?: boolean;
  /** true during an active trip → BestForNavigation; false when idle/online → Balanced */
  isOnTrip?: boolean;
}

const MAX_PLAUSIBLE_SPEED_KMH = 180;
// How old a cached position can be and still be used as a seed (5 min)
const MAX_LAST_KNOWN_AGE_MS = 5 * 60 * 1000;

// ── Background location task ─────────────────────────────────────────────
// expo-location's `startLocationUpdatesAsync` only keeps reporting positions
// while the app is backgrounded if it's wired to an expo-task-manager task —
// `watchPositionAsync` (used below in `startWatch`) is foreground-only and is
// suspended by the OS a few seconds after backgrounding. `defineTask` MUST be
// called at module scope (before any component mounts) — Expo re-invokes the
// registered task by name from a headless JS instance when the OS wakes the
// app for a location update, so this can't live inside the hook body.
export const DRIVER_LOCATION_TASK = 'EYEGO_DRIVER_LOCATION_TASK';

if (!TaskManager.isTaskDefined(DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) {
      console.warn('[DriverLocation] Background task error:', error.message);
      return;
    }
    const locations = data?.locations as Location.LocationObject[] | undefined;
    const latest = locations?.[locations.length - 1];
    if (!latest) return;
    // Background execution: no React state/closures from the hook survive
    // here, so push straight to the same channel the foreground watch uses
    // (driverSocketEvents.emitLocation is a plain module export backed by a
    // lazily-created, already-connected socket — see useDriverSocket.ts and
    // app/(trip)/tracking/[id].tsx for the equivalent foreground emit).
    const fix = {
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      heading: latest.coords.heading ?? 0,
      speed: latest.coords.speed ?? 0,
    };
    lastReportedFix = fix;
    try {
      driverSocketEvents.emitLocation(fix);
    } catch (e) {
      console.warn('[DriverLocation] Background emitLocation failed:', e);
    }
  });
}

async function startBackgroundLocationTracking(isOnTrip: boolean) {
  try {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    if (alreadyStarted) return;
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: isOnTrip ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
      timeInterval: 5000,
      distanceInterval: 15,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        // This service now only runs during a trip (see the isOnTrip gate in the
        // hook), so the copy says so — "EyeGo Driver is online" was misleading
        // when it could appear with the app closed and no trip in progress.
        notificationTitle: 'Trip in progress',
        notificationBody: 'Sharing your location with your passengers until the trip ends.',
        notificationColor: '#3B82F6',
      },
      pausesUpdatesAutomatically: false,
    });
  } catch (err) {
    console.warn('[DriverLocation] Failed to start background location updates:', err);
  }
}

async function stopBackgroundLocationTracking() {
  try {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    if (alreadyStarted) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  } catch (err) {
    console.warn('[DriverLocation] Failed to stop background location updates:', err);
  }
}

// ── Ref-count background tracking ────────────────────────────────────────
// This hook mounts on home + active + tracking simultaneously. Without a
// refcount, unmounting ONE of those screens (e.g. leaving the active-trip
// screen while still online on home) would call stopBackgroundLocationTracking
// and tear down location for ALL consumers. Mirror the socket refcount pattern:
// only stop when the last consumer releases.
let bgTrackingRefs = 0;

function releaseBackgroundTracking() {
  bgTrackingRefs = Math.max(0, bgTrackingRefs - 1);
  if (bgTrackingRefs === 0) {
    // fire-and-forget: React cleanup can't be async
    stopBackgroundLocationTracking();
  }
}

// ── Presence heartbeat ───────────────────────────────────────────────────
//
// THE BUG THIS EXISTS FOR: a parked driver disappears from dispatch.
//
// The server's supply index keeps a presence key with a 90-second TTL, and the
// only thing that refreshes it is a location ping. But the watch below is
// configured `distanceInterval: 10` — it fires when the vehicle MOVES. A driver
// waiting at a rank, at the airport, or outside a mall produces no fixes at
// all, so after ninety motionless seconds they age out of the pool and stop
// being offered rides. That is the exact population most available to take one.
//
// So position is not the only thing being reported here; liveness is. Re-send
// the last known fix on a timer whether or not it has changed. 25s against a
// 90s TTL survives two dropped beats.
//
// One timer for the whole app: this hook mounts on home, active and tracking
// at once, and three heartbeats is three times the radio for no extra
// information. Refcounted like the background tracking above.
const HEARTBEAT_MS = 25_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatRefs = 0;
/** The most recent fix from any instance — what the heartbeat re-sends. */
let lastReportedFix: { lat: number; lng: number; heading: number; speed: number } | null = null;

/**
 * THE HTTP HALF OF THE HEARTBEAT.
 *
 * BUGFIX ("I request the trip on the rider app, switch back to the driver app
 * on the same phone, and nothing shows").
 *
 * One handset can only foreground one app. The moment the rider app comes
 * forward the OS suspends this one: the websocket dies, this timer stops, and
 * ninety seconds later the server's presence key expires and the driver drops
 * out of the Redis geo-set that dispatch searches. They come back to a home
 * screen that still says "Online" and a search that already gave up on them.
 *
 * `POST /driver/presence` has existed on the server since the "is there another
 * way to connect the driver apart from the socket?" pass and nothing ever
 * called it. It performs the SAME `supply.upsertDriver` write the socket ping
 * does — same pool, same TTL, same eligibility rule — over plain HTTP, which
 * works in every case a websocket does not: a captive portal, a carrier proxy,
 * a token rotation mid-flight, a socket that reports `connected` but is a
 * zombie after a foreground.
 *
 * Deliberately fired on EVERY beat rather than only when the socket looks
 * down: `socket.connected` is a client-side belief, and the case that keeps
 * costing rides is exactly the one where that belief is wrong. One small POST
 * every 25 s is nothing next to a driver missing the work.
 *
 * It also carries the answer back — the server's own verdict on whether this
 * driver is dispatchable and, if not, why — which is what turns "nothing shows
 * and I don't know why" into a sentence on the home screen.
 */
async function beatPresenceOverHttp(): Promise<void> {
  const fix = lastReportedFix;
  if (!fix) return;
  const store = useDriverStore.getState();
  // Offline is a decision, not a network condition — never put a driver who
  // deliberately went offline back into the pool.
  if (!store.isLoggedIn || !store.isOnline) return;
  try {
    const res = await driverApi.presence({
      lat: fix.lat,
      lng: fix.lng,
      heading: fix.heading,
      speed: fix.speed,
    });
    const data = (res?.data as any)?.data;
    if (data && typeof data.dispatchable === 'boolean') {
      useDriverStore.getState().setDispatchStatus({
        dispatchable: data.dispatchable,
        reason: data.reason ?? null,
      });
    }
  } catch {
    // A failed beat is not worth surfacing — the next one is 25 s away, and the
    // socket ping may well have kept the key alive in the meantime.
  }
}

/**
 * Beat presence RIGHT NOW. Called on foreground, which is the one moment the
 * 25-second cadence is too slow to matter: the driver has just switched back
 * from the rider app on the same phone and a search may be parked on them.
 */
export function beatPresenceNow(): void {
  void beatPresenceOverHttp();
  try {
    if (lastReportedFix) driverSocketEvents.emitLocation(lastReportedFix);
  } catch {
    // Socket not up yet; the HTTP beat above already did the important half.
  }
}

function acquireHeartbeat() {
  heartbeatRefs++;
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!lastReportedFix) return;
    try {
      driverSocketEvents.emitLocation(lastReportedFix);
    } catch {
      // Socket down. The next beat retries; there is nothing to queue, because
      // a stale position delivered late is worse than none at all.
    }
    // Independent of the socket, on purpose — see beatPresenceOverHttp.
    void beatPresenceOverHttp();
  }, HEARTBEAT_MS);
}

function releaseHeartbeat() {
  heartbeatRefs = Math.max(0, heartbeatRefs - 1);
  if (heartbeatRefs === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** The last fix this device reported, for the socket's reconnect re-emit. */
export function lastKnownReportedFix() {
  return lastReportedFix;
}

export function useDriverLocation({ enabled = true, isOnTrip = false }: Options = {}) {
  const [location, setLocation] = useState<Coords | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isMocked, setIsMocked] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const cancelledRef = useRef(false);
  const permissionGranted = useRef(false);
  // Whether THIS hook instance incremented the background-tracking refcount,
  // so cleanup only releases the ref it actually acquired.
  const bgAcquiredRef = useRef(false);
  // True when the OS reports a mock GPS provider is active — a persistent
  // condition that must NOT be cleared by a later plausible-speed fix.
  const osMockRef = useRef(false);

  // ── Reported heading ──────────────────────────────────────────────────────
  // What the RIDER's app draws the vehicle's rotation from, so it has to be the
  // best available answer rather than a raw sensor value.
  //
  // BUGFIX ("the car on the rider app doesn't move even when I turn the phone"):
  // this hook sent `pos.coords.heading ?? 0`. GPS `heading` is course over
  // GROUND — it is only meaningful while actually moving, and reads -1 or 0 when
  // stopped or crawling. So a stationary or slow-moving vehicle reported "due
  // north" forever and the rider's car marker sat frozen pointing up, no matter
  // which way the vehicle was really facing.
  //
  // Order of preference:
  //   1. GPS course while genuinely moving — the only source that reflects the
  //      direction of TRAVEL, and immune to a phone sitting askew in a cradle;
  //   2. the last good course, while briefly stopped (at a light, in traffic) —
  //      the vehicle is still pointing the way it was going;
  //   3. the compass, when there has never been a course to hold (just went on
  //      shift, parked at the pickup waiting for the rider). This is the case
  //      that was reported: the driver was stopped AT the pickup, so no course
  //      had ever existed.
  // The compass is deliberately LAST: a handset in a metal cradle reads the
  // cradle as much as the road, which is why it must never outrank real course
  // data (see @eyego/maps useVehicleHeading — the same model, receiving end).
  const MOVING_MPS = 1.4; // ~5 km/h — below this, GPS course is noise
  const compassRef = useRef<number | null>(null);
  const lastCourseRef = useRef<number | null>(null);

  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        sub = await Location.watchHeadingAsync((h) => {
          // trueHeading is -1 until the compass calibrates; magHeading covers it.
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (Number.isFinite(deg)) compassRef.current = deg;
        });
        if (cancelled) { sub?.remove(); sub = null; }
      } catch {
        // No compass / permission denied — headings fall back to GPS course only.
      }
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, []);

  const resolveHeading = useCallback((pos: Location.LocationObject): number => {
    const course = pos.coords.heading;
    const speed = pos.coords.speed ?? 0;
    if (typeof course === 'number' && course >= 0 && speed >= MOVING_MPS) {
      lastCourseRef.current = course;
      return course;
    }
    if (lastCourseRef.current != null) return lastCourseRef.current;
    if (compassRef.current != null) return compassRef.current;
    return typeof course === 'number' && course >= 0 ? course : 0;
  }, []);

  const applyPosition = useCallback((pos: Location.LocationObject) => {
    if (cancelledRef.current) return;
    const speedMs = pos.coords.speed ?? 0;
    const speedKmh = speedMs * 3.6;
    if (speedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
      console.warn(`[DriverLocation] Implausible speed: ${speedKmh.toFixed(1)} km/h`);
      setIsMocked(true);
    } else if (!osMockRef.current) {
      // A plausible fix arrived and the OS-level mock provider is not active —
      // clear the transient implausible-speed flag so the UI doesn't stay stuck.
      setIsMocked((prev) => (prev ? false : prev));
    }
    const reportedHeading = resolveHeading(pos);
    setLocation({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      heading: reportedHeading,
      speed: pos.coords.speed,
    });
    // This used to only update local state — the ONLY thing that ever
    // reported a driver's position to the server was the background
    // TaskManager task, which requires the "Always"/background location
    // permission. A driver who granted just "While Using" (common — many
    // decline "Always") never entered the `drivers:online` Redis geoset, so
    // rider trip requests never found them: no dispatch, no "nearby rider
    // requesting a trip" notification, ever, for that driver. Emitting here
    // too means foreground reporting no longer depends on background
    // permission at all — the backend's dispatch query already filters to
    // status:'ACTIVE', isOnline:true downstream, so emitting whenever this
    // (already app-open) foreground watch is running is safe.
    const fix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: reportedHeading,
      speed: pos.coords.speed ?? 0,
    };
    // Held for the heartbeat and the socket's reconnect re-emit — see above.
    lastReportedFix = fix;
    try {
      driverSocketEvents.emitLocation(fix);
    } catch (e) {
      console.warn('[DriverLocation] Foreground emitLocation failed:', e);
    }
  }, [resolveHeading]);

  const startWatch = useCallback(async () => {
    // Remove any existing watch before starting a new one
    watchRef.current?.remove();
    watchRef.current = null;

    // Use higher accuracy during active trips for reliable navigation;
    // use Balanced when idle to conserve battery.
    const watchAccuracy = isOnTrip
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.Balanced;

    try {
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: watchAccuracy,
          timeInterval: 3000,
          distanceInterval: 10,
        },
        applyPosition,
      );
    } catch (err) {
      console.warn('[DriverLocation] watchPositionAsync failed — retrying in 5s', err);
      setTimeout(() => {
        if (!cancelledRef.current && permissionGranted.current) startWatch();
      }, 5000);
    }
  }, [applyPosition]);

  useEffect(() => {
    if (!enabled) return;

    cancelledRef.current = false;
    // Start beating immediately — before the first fix, even. The timer no-ops
    // until there is something to report, and starting it here means the
    // acquire/release pairing is symmetric with the cleanup below regardless of
    // which branch of the async setup runs.
    acquireHeartbeat();

    (async () => {
      // ── 1. Permission ─────────────────────────────────────────────────
      // On Android, defer the permission dialog by 500ms so the UI has time to
      // render before the system dialog appears. Without this, the dialog can
      // appear before the screen is visible, causing a jarring UX.
      if (Platform.OS === 'android') {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      if (cancelledRef.current) return;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelledRef.current) return;
      if (status !== 'granted') {
        setHasPermission(false);
        return;
      }
      setHasPermission(true);
      permissionGranted.current = true;

      // ── Background ("Always") permission — ON-TRIP ONLY ───────────────
      //
      // BUGFIX (reported: "the driver app needs location set to Always before it
      // works, and I can see in the Dynamic Island that my location is being used
      // when the app isn't even open"): this used to request the Always
      // permission unconditionally, the moment the hook mounted, and then start
      // the background task for any `enabled` session — including a driver simply
      // sitting online and idle. So the app held a background location session
      // essentially all the time, and a driver who declined Always (many do, and
      // it is a reasonable thing to decline) got a degraded app.
      //
      // Uber/Bolt ask for While-Using up front and escalate to Always only when
      // there is a live trip to justify it. Foreground reporting already works
      // without it (see the emitLocation in applyPosition above), so being online
      // and idle needs nothing more than While-Using.
      let bgStatus: Location.PermissionStatus | 'skipped' = 'skipped';
      if (isOnTrip) {
        // Don't re-prompt on every trip: if it was already decided, respect that.
        const existing = await Location.getBackgroundPermissionsAsync();
        if (existing.status === 'granted') {
          bgStatus = existing.status;
        } else if (existing.canAskAgain) {
          bgStatus = (await Location.requestBackgroundPermissionsAsync()).status;
        } else {
          bgStatus = existing.status;
        }
        if (bgStatus !== 'granted') {
          // Not fatal: the trip still tracks while the app is open. The driver has
          // simply chosen not to be tracked with the app closed.
          console.warn('[DriverLocation] Background location not granted — on-trip tracking is foreground-only');
        }
      }

      // ── 2. Mock provider check ────────────────────────────────────────
      try {
        const { areMockProvidersEnabled } = await (Location as any).getMockProviderStatusAsync?.() ?? {};
        if (areMockProvidersEnabled) {
          osMockRef.current = true;
          setIsMocked(true);
          console.warn('[DriverLocation] Mock GPS provider detected');
        }
      } catch { /* not available on this platform */ }

      // ── 3. Seed with last-known position instantly ────────────────────
      // This gives us a non-null location immediately so the toggle never
      // blocks on a cold GPS fix.
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS });
        if (last && !cancelledRef.current) applyPosition(last);
      } catch { /* no cached position — that's fine */ }

      // ── 4. Start the continuous watch immediately ────────────────────
      // Don't block on getCurrentPositionAsync first — the watch will
      // deliver a fresh high-accuracy fix within its first update.
      if (!cancelledRef.current) await startWatch();

      // ── 4b. Start the background task — ONLY during a trip ────────────
      // watchPositionAsync above is foreground-only; the background task keeps
      // positions flowing while the app is backgrounded. Gated on `isOnTrip` so
      // an idle online driver never holds a background location session (which
      // is what put the location indicator in the Dynamic Island with the app
      // closed). When the trip ends this effect re-runs with isOnTrip false and
      // the cleanup below releases the tracking ref.
      if (!cancelledRef.current && isOnTrip && bgStatus === 'granted') {
        bgTrackingRefs++;
        bgAcquiredRef.current = true;
        await startBackgroundLocationTracking(isOnTrip);
      }

      // ── 5. Force a fresh one-shot fix concurrently ───────────────────
      // Runs in parallel with the watch; overwrites the stale seed if the
      // watch is slow to fire its first update.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then((pos) => { if (!cancelledRef.current) applyPosition(pos); })
        .catch(() => { /* watch will provide a fix soon */ });
    })();

    // ── 6. Re-start watch when app comes back to foreground ──────────
    //      Also re-check permissions — they may have been revoked mid-session.
    const handleAppState = async (next: AppStateStatus) => {
      if (next !== 'active' || cancelledRef.current) return;
      /**
       * BACK IN THE POOL BEFORE ANYTHING ELSE.
       *
       * The same-handset case: the driver has just come back from the rider app,
       * their presence key expired while they were away, and a dispatch search
       * may be parked waiting for supply RIGHT NOW. This beat re-adds them and,
       * server-side, re-runs any parked search on the absent→present edge — so
       * an offer can land in the second after the switch rather than after the
       * next 25-second tick, by which time the cascade has moved on.
       *
       * Fired before the permission re-check on purpose: it uses the LAST known
       * fix, needs no new GPS read, and must not queue behind an await.
       */
      beatPresenceNow();
      // Always re-check permission status; user may have revoked it in Settings
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setHasPermission(false);
        permissionGranted.current = false;
        watchRef.current?.remove();
        watchRef.current = null;
        return;
      }
      // Permission still granted — restart the watch if it was running
      if (permissionGranted.current) {
        startWatch();
      }
    };
    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      cancelledRef.current = true;
      permissionGranted.current = false;
      watchRef.current?.remove();
      watchRef.current = null;
      appStateSub.remove();
      releaseHeartbeat();
      // Release this instance's background-tracking ref. Tracking only actually
      // stops when the LAST consumer (home/active/tracking) releases — so
      // leaving one screen while still online elsewhere won't kill location.
      if (bgAcquiredRef.current) {
        bgAcquiredRef.current = false;
        releaseBackgroundTracking();
      }
    };
  }, [enabled, isOnTrip]);

  return { location, hasPermission, isMocked };
}
