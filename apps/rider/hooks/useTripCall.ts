import { useCallback } from 'react';
import { contactApi } from '@eyego/api';
import { callNumber, notify } from '@eyego/ui';
import { usePlatformConfig } from './usePlatformConfig';

/**
 * Call the driver. With masked calling on (server `maskedCalling`, Africa's
 * Talking voice) EyeGo rings the rider and bridges them — neither sees the
 * other's number. Off, the rider's dialler opens on the driver's number, as
 * before. See eyego-api contact.service.
 */
export function useTripCall() {
  const { maskedCalling } = usePlatformConfig();
  return useCallback(
    async ({ tripId, phone, name }: { tripId?: string | null; phone?: string | null; name?: string }) => {
      if (maskedCalling && tripId) {
        try {
          const res = await contactApi.initiateCall({ tripId, calleeRole: 'DRIVER' });
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
      if (!phone) {
        notify('No number available', 'Use the in-app chat to reach your driver.');
        return;
      }
      void callNumber(phone, { label: name ?? 'your driver' });
    },
    [maskedCalling],
  );
}
