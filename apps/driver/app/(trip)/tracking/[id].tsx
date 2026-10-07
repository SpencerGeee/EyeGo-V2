import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * THE TRACKING ROUTE IS A DOOR, NOT A ROOM.
 *
 * This was 1,200 lines with its own MapView, its own camera and a 42 % map
 * pane over a list. The live trip is the HOME surface now — one full-bleed map
 * for the whole shift, the trip as stages in the rider-style sheet (see
 * components/surface/driverStage.ts). The route survives because push taps,
 * deep links and older screens still name it; it lands the driver where the
 * trip actually is.
 */
export default function DriverTrackingScreen() {
  // No `setActiveTripId(id)` here: a link can name ANY trip, and a persisted
  // active id for a ride this driver does not own switched off every offer and
  // banner ("busy driver" guards). Home sets it from the server's own answer.
  useLocalSearchParams<{ id: string }>();
  return <Redirect href={'/(tabs)/home' as never} />;
}
