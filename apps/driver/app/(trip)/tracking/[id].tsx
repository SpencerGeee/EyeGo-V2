import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * THE TRACKING ROUTE IS A DOOR, NOT A ROOM.
 *
 * This was 1,200 lines with its own MapView, its own camera and a 42 % map
 * pane over a list. The live trip is ONE screen now — (trip)/active/[id]: its
 * own map, the stage sheet, manage folded into it, the swipe pinned. The route
 * survives because push taps, deep links and older screens still name it; it
 * lands the driver on that screen, or home when the link names no trip.
 */
export default function DriverTrackingScreen() {
  // No `setActiveTripId(id)` here: a link can name ANY trip, and a persisted
  // active id for a ride this driver does not own switched off every offer and
  // banner ("busy driver" guards). Home sets it from the server's own answer.
  const { id } = useLocalSearchParams<{ id: string }>();
  return id
    ? <Redirect href={{ pathname: '/(trip)/active/[id]', params: { id } } as never} />
    : <Redirect href={'/(tabs)/home' as never} />;
}
