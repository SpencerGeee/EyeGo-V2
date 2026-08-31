import { useQuery } from '@tanstack/react-query';
import { configApi, CLIENT_GATE_FALLBACK } from '@eyego/api';
import type { ClientGate } from '@eyego/api';

/**
 * Is this build still allowed to run, and is the platform up?
 *
 * Separate from `usePlatformConfig` on purpose, and the difference is the whole
 * reason this exists:
 *
 *   usePlatformConfig  -> GET /v1/config/public  -> needs a token
 *   useReleaseGate     -> GET /v1/config/client  -> needs nothing
 *
 * A build old enough to be refused may also be old enough that its token
 * refresh no longer works, so asking it to authenticate before it can learn it
 * must upgrade is circular. Likewise a maintenance screen only logged-in users
 * can see is not a maintenance screen.
 *
 * `retry: false` and a fallback of "everything is fine": a gate that fails
 * closed would take the app down on a network blip — the exact outcome it
 * exists to prevent, self-inflicted. Refetched on foreground so flipping
 * maintenance on reaches a phone sitting in someone's pocket within one
 * app-switch rather than at the next cold start.
 */
export function useReleaseGate(): { gate: ClientGate; loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'client-gate'],
    queryFn: async () => (await configApi.getClientGate()).data.data,
    staleTime: 30_000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  return { gate: data ?? CLIENT_GATE_FALLBACK, loading: isLoading && !data };
}
