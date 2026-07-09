import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Legacy route stub — the where-to screen now lives as the 'search' stage of
 * the persistent trip surface (app/trip.tsx). Kept only so old deep links
 * and notification payloads that target /where-to keep working.
 */
export default function WhereToRedirect() {
  const { tier, type, morphId } = useLocalSearchParams<{ tier?: string; type?: string; morphId?: string }>();
  const qs = new URLSearchParams();
  qs.set('stage', 'search');
  if (tier) qs.set('tier', tier);
  if (type) qs.set('type', type);
  if (morphId) qs.set('morphId', morphId);
  return <Redirect href={`/trip?${qs.toString()}` as any} />;
}
