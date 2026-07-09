import React from 'react';
import { SelectStage } from '../../components/trip/stages/SelectStage';

/**
 * Legacy route wrapper — ride selection now lives as the 'select' stage of
 * the persistent trip surface (app/trip.tsx). This route stays for old deep
 * links / notification payloads and renders the same component full-screen.
 */
export default function RideSelectScreen() {
  return <SelectStage mode="route" />;
}
