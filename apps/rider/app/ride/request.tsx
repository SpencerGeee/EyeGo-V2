import React from 'react';
import { RequestStage } from '../../components/trip/stages/RequestStage';

/**
 * Legacy route wrapper — the trip-request "looking for a driver" screen now
 * lives as the 'request' stage of the persistent trip surface (app/trip.tsx).
 * This route stays for old deep links / notification payloads.
 */
export default function TripRequestScreen() {
  return <RequestStage mode="route" />;
}
