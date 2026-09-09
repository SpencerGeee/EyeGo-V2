import React from 'react';
import type { Coord } from '@eyego/maps';
import { DriverTripMap } from '../trip/DriverTripMap';
import { DRIVER_SHEET_CHROME, type DriverStage } from './driverStage';

/**
 * THE ONE MAP THE DRIVER SEES ALL SHIFT.
 *
 * BUGFIX ("the morphing effect is super laggy… this is the 7th time"), and the
 * reason the driver's trip screens felt unlike the rider's.
 *
 * The driver app used to stand up a MapView per screen: home had one, the offer
 * screen mounted a second, `(trip)/active` a third, `(trip)/tracking` a fourth.
 * Every transition in the earning flow tore a GL surface down and built another,
 * which is expensive at the exact moments the driver is moving — accepting,
 * setting off, arriving.
 *
 * `DriverTripMap` already owned the camera state machine, the route geometry and
 * the puck for the two trip screens, and it already accepts `children` to render
 * inside its MapView. So it is simply hoisted: one instance, mounted by home for
 * the life of the tab, handed different props as the stage changes. Nothing here
 * mounts or unmounts a map — it only re-frames one.
 *
 * When there is no trip it is still the map: `tripId` is empty, the legs are
 * null, and the ambient overlays (demand heat, the driver's own marker) render
 * as children exactly as they did on the old home map.
 */
export interface DriverSurfaceMapProps {
  stage: DriverStage;
  /** The live trip, when there is one. Null on `idle` and `offer`. */
  trip?: { id: string; status?: string | null } | null;
  /**
   * The leg the current stage is about.
   *
   * On `offer` these are deliberately the DRIVER→PICKUP pair with no drop-off:
   * the offer frames the approach only, and the destination is gated until the
   * ride starts. See `revealDropoff` in DispatchLiveMap for the same rule.
   */
  pickup?: Coord | null;
  dropoff?: Coord | null;
  location?: { latitude: number; longitude: number; heading?: number | null; speed?: number | null } | null;
  puckColor?: string;
  onEta?: (eta: { leg: 'toPickup' | 'toDropoff'; minutes: number; distanceKm: number | null; rerouted: boolean }) => void;
  /**
   * Frame these coordinates instead of the trip's status-derived target.
   *
   * The offer stage has no trip and therefore no status, so the surface has to
   * say what the useful frame is: the driver and the pickup, as a pair.
   */
  fitOverride?: Coord[] | null;
  /** Honours the driver's light/dark preference on home. */
  styleURL?: any;
  /** Ambient overlays — demand heat, the idle driver marker. */
  children?: React.ReactNode;
}

export function DriverSurfaceMap({
  stage,
  trip,
  pickup,
  dropoff,
  location,
  puckColor,
  onEta,
  fitOverride = null,
  styleURL,
  children,
}: DriverSurfaceMapProps) {
  /**
   * The sheet's share of the screen, so the camera pads around it rather than
   * framing the ride into pixels the sheet covers. Read from the SAME chrome
   * table the sheet itself uses, so the two cannot drift — a hand-copied
   * fraction here is how a map ends up framing a pickup behind the panel.
   */
  const sheetFraction = DRIVER_SHEET_CHROME[stage]?.collapsed ?? 0.42;

  return (
    <DriverTripMap
      // Empty string while idle. The map reads this only to subscribe to a
      // trip's route/ETA frames, and it already guards `if (!tripId) return`.
      tripId={trip?.id ?? ''}
      status={trip?.status ?? null}
      pickup={pickup ?? null}
      dropoff={dropoff ?? null}
      location={location ?? null}
      puckColor={puckColor}
      sheetFraction={sheetFraction}
      /**
       * ALWAYS ACTIVE — this is the camera loop, not the trip subscription.
       *
       * Gating this on `trip?.id` looks like a saving and is a bug: with no
       * trip the loop stops, so an idle home would not follow the driver and
       * the offer stage's approach frame would never be applied. The map would
       * simply sit wherever it last was.
       *
       * The expensive part — joining the trip room, the route and ETA
       * subscriptions — is already guarded independently inside DriverTripMap
       * by `if (!tripId) return`, so an idle surface costs a camera loop that
       * the old hand-written follow-me effect was paying for anyway. The `&&
       * isFocused` inside the map still stops it dead on another tab.
       */
      active
      onEta={onEta}
      fitOverride={fitOverride}
      styleURL={styleURL}
    >
      {children}
    </DriverTripMap>
  );
}
