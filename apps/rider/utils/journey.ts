import { placeLabel } from '@eyego/utils';
import { reverseGeocode } from './geocoding';
import { useRideStore } from '../stores/ride.store';
import { useTripFlow, type SearchPlace } from '../stores/tripFlow.store';

/**
 * The two ends of a journey, written the way Where-To writes them — so any
 * screen can open the ride options "as if the rider had searched it there".
 */

/**
 * Pickup at the rider's own position: "Current Location" at once, the street
 * when the geocoder answers. The street is what the driver is told, so the
 * literal words must not survive — but a pickup the rider chose in the
 * meantime is theirs and is never overwritten. Resolves to the street name.
 */
export async function seedPickupAt(latitude: number, longitude: number): Promise<string | null> {
  useRideStore.getState().setOrigin({ latitude, longitude, address: 'Current Location' });
  const hit = await reverseGeocode(latitude, longitude).catch(() => null);
  if (!hit) return null;
  const label = placeLabel(hit.name, hit.fullAddress) ?? hit.fullAddress ?? hit.name;
  useRideStore.setState((s) =>
    s.origin?.address === 'Current Location' && s.origin.latitude === latitude && s.origin.longitude === longitude
      ? { origin: { latitude, longitude, address: label } }
      : s,
  );
  return hit.name;
}

/** The destination, in both stores that read it (fields + map pin, and the fare). */
export function seedDestination(place: SearchPlace): void {
  useTripFlow.getState().setSearchPlace(place);
  useRideStore.getState().setDestination({
    // `placeLabel`, not `fullAddress` alone — this string is what the driver sees.
    address: placeLabel(place.name, place.fullAddress) ?? place.fullAddress,
    latitude: place.latitude,
    longitude: place.longitude,
  });
}
