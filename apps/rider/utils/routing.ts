/**
 * Road routing + ETA, via our own `/v1/geo/route` proxy.
 *
 * WHY NOT OSRM DIRECTLY: every screen used to call
 * `router.project-osrm.org/route/v1/driving/...` itself. That public demo server
 * answers with FREE-FLOW duration — the time the drive would take on an empty
 * road — so an 8.3 km Accra trip came back as ~12 minutes (≈41 km/h, motorway
 * pace through city traffic). It is also unauthenticated, rate-limited and has
 * no uptime guarantee.
 *
 * The proxy uses Mapbox's `driving-traffic` profile, which folds in live and
 * historical congestion, and degrades to OSRM and then to a distance/speed
 * estimate on its own — so callers here get one shape and never a blank ETA.
 */
import { apiClient } from '@eyego/api';

export type RouteResult = {
  /** Road distance, kilometres. */
  distanceKm: number;
  /** Traffic-aware duration, minutes. */
  durationMin: number;
  /** GeoJSON LineString coordinates, [lng, lat] pairs — ready for a polyline. */
  coordinates: [number, number][];
  /** Which provider answered: 'driving-traffic' | 'osrm' | 'estimate'. */
  source: string;
};

const ROUTE_TIMEOUT_MS = 10000;

function isFinitePair(c: [number, number] | null | undefined): c is [number, number] {
  return !!c && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

/**
 * Fetch a road route between two [lng, lat] points.
 * Returns null when the inputs are unusable or the request fails — callers keep
 * whatever they were already showing rather than rendering a fabricated route.
 */
export async function fetchRoute(
  origin: [number, number] | null | undefined,
  target: [number, number] | null | undefined,
): Promise<RouteResult | null> {
  if (!isFinitePair(origin) || !isFinitePair(target)) return null;

  try {
    const { data } = await apiClient.get('/geo/route', {
      params: {
        originLng: origin[0],
        originLat: origin[1],
        destLng: target[0],
        destLat: target[1],
      },
      timeout: ROUTE_TIMEOUT_MS,
    });
    const r = data?.data;
    if (!r || !Number.isFinite(r.durationMin) || !Number.isFinite(r.distanceKm)) return null;

    const coords = Array.isArray(r.geometry?.coordinates) ? r.geometry.coordinates : [];
    return {
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      coordinates: coords.filter(
        (c: any) => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]),
      ),
      source: String(r.source ?? 'unknown'),
    };
  } catch {
    return null;
  }
}

/** Traffic-aware ETA in whole minutes, or null. */
export async function fetchEtaMinutes(
  origin: [number, number] | null | undefined,
  target: [number, number] | null | undefined,
): Promise<number | null> {
  const route = await fetchRoute(origin, target);
  return route ? Math.max(1, Math.round(route.durationMin)) : null;
}
