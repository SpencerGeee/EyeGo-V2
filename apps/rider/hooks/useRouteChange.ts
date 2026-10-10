import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ridesApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { goDeeper, notify } from '@eyego/ui';
import { consumePickedPlace } from '../utils/placePickerResult';
import { expectTripSurfaceReturn } from '../utils/tripSurfaceReturn';

type Kind = 'destination' | 'stop';

/**
 * CHANGE THE DESTINATION OR ADD A STOP, MID-RIDE (hailed rides).
 *
 * Pick a place → see the new fare → confirm. The server prices it against the
 * trip's own card (rides.applyRouteChange) and tells the driver; the route
 * redraws on the next snapshot. If traffic moved the price between the quote
 * and the confirm, the server answers FARE_CHANGED with the new figure and the
 * rider is asked once more — never charged a number they did not see.
 */
export function useRouteChange(tripId: string | null | undefined) {
  const pending = useRef<Kind | null>(null);

  const start = useCallback((kind: Kind) => {
    pending.current = kind;
    expectTripSurfaceReturn();
    goDeeper({
      pathname: '/profile/place-picker',
      params: { title: kind === 'stop' ? 'Add a stop' : 'Change destination', focusSearch: '1' },
    } as any);
  }, []);

  const confirm = useCallback(
    (kind: Kind, place: { lat: number; lng: number; address: string }, farePesewas: number, deltaPesewas: number) =>
      new Promise<boolean>((resolve) => {
        const change = deltaPesewas === 0 ? 'no change to the fare' : `${deltaPesewas > 0 ? '+' : '−'}${formatGhs(Math.abs(deltaPesewas))}`;
        Alert.alert(
          kind === 'stop' ? `Add a stop at ${place.address}?` : `Go to ${place.address} instead?`,
          `New fare ${formatGhs(farePesewas)} (${change}). Your driver is told straight away.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: `Confirm ${formatGhs(farePesewas)}`, onPress: () => resolve(true) },
          ],
        );
      }),
    [],
  );

  const apply = useCallback(
    async (kind: Kind, place: { lat: number; lng: number; address: string }) => {
      if (!tripId) return;
      try {
        let quote = await ridesApi.quoteRouteChange(tripId, { kind, ...place });
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!(await confirm(kind, place, quote.farePesewas, quote.deltaPesewas))) return;
          try {
            await ridesApi.applyRouteChange(tripId, { kind, ...place, expectedFarePesewas: quote.farePesewas });
            notify(kind === 'stop' ? 'Stop added' : 'Destination changed', 'Your driver has the new route.', { tone: 'success' });
            return;
          } catch (err: any) {
            const fresh = err?.response?.data?.details?.farePesewas;
            if (err?.response?.data?.code !== 'FARE_CHANGED' || !Number.isFinite(fresh)) throw err;
            quote = { ...quote, deltaPesewas: quote.deltaPesewas + (fresh - quote.farePesewas), farePesewas: fresh };
          }
        }
      } catch (err: any) {
        notify(
          kind === 'stop' ? "Couldn't add the stop" : "Couldn't change the destination",
          err?.response?.data?.message ?? 'Please try again.',
        );
      }
    },
    [tripId, confirm],
  );

  // Back from the picker: price and confirm what was chosen.
  useFocusEffect(
    useCallback(() => {
      const kind = pending.current;
      if (!kind) return;
      pending.current = null;
      const p = consumePickedPlace();
      if (!p) return;
      void apply(kind, {
        lat: p.latitude,
        lng: p.longitude,
        address: p.name?.trim() || p.fullAddress?.trim() || 'Pinned location',
      });
    }, [apply]),
  );

  return { changeDestination: () => start('destination'), addStop: () => start('stop') };
}
