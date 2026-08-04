import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Legacy route stub.
 *
 * This file used to be 1754 lines: its own MapView, its own camera controller,
 * its own Mapbox Directions retry ladder, its own socket subscription and its
 * own copy of the trip status machine. Every entry point that showed a rider
 * their approaching car tore down whichever map was already on screen and
 * built another one — the single worst moment in the app to remount a map.
 *
 * All of that now lives on the persistent trip surface (`app/trip.tsx`) as the
 * `assigned` and `tracking` stages, over ONE map that never unmounts. The
 * surface rehydrates from the server's active trip, so it does not need the
 * `[id]` this route carries — which is just as well, because callers passed a
 * booking id here about as often as a trip id.
 *
 * Kept only so notification payloads and deep links already in the wild keep
 * working. Nothing inside the app should navigate here any more.
 */
export default function TrackingRedirect() {
  return <Redirect href={'/trip?stage=assigned' as any} />;
}
