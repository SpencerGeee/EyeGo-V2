import { useCallback } from 'react';
import { contactApi } from '@eyego/api';
import { callNumber, notify } from '@eyego/ui';
import { usePlatformConfig } from './usePlatformConfig';

/**
 * Call a passenger. With masked calling on (server `maskedCalling`, Africa's
 * Talking voice) EyeGo rings the driver and bridges them to THAT passenger —
 * neither sees the other's number. Off, the dialler opens on their number.
 * See eyego-api contact.service.
 */
export function useTripCall() {
  const { maskedCalling } = usePlatformConfig();
  return useCallback(
    async ({ tripId, bookingId, phone, name }: { tripId?: string | null; bookingId?: string | null; phone?: string | null; name?: string }) => {
      if (maskedCalling && tripId) {
        try {
          const res = await contactApi.initiateCall({ tripId, calleeRole: 'PASSENGER', calleeBookingId: bookingId ?? undefined });
          const d = (res.data as any)?.data;
          if (d?.mode === 'CALLBACK') {
            notify('Calling you now', d.message ?? 'Answer to be connected.', { tone: 'success' });
            return;
          }
          if (d?.phone) phone = d.phone;
        } catch (err: any) {
          notify('Couldn’t start the call', err?.response?.data?.message ?? 'Use the chat instead.');
          return;
        }
      }
      void callNumber(phone, { label: name ?? 'the passenger' });
    },
    [maskedCalling],
  );
}
