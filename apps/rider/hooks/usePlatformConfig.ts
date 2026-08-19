import { useQuery } from '@tanstack/react-query';
import { configApi, PLATFORM_CONFIG_FALLBACK } from '@eyego/api';
import type { PlatformConfig } from '@eyego/api';

/**
 * The operator's live settings, as the phone sees them.
 *
 * Everything here is a value the operator can change from the admin console
 * without shipping a build — fares, the seat-hold window, the support number,
 * an announcement banner, and the booking kill switch. Read it instead of
 * hardcoding any of them; a constant compiled into the app is a value the
 * console silently cannot change.
 *
 * NEVER returns undefined. On a cold start or a failed fetch the caller gets
 * `PLATFORM_CONFIG_FALLBACK`, whose values mirror the server defaults, so a
 * screen never has to render a loading state for a number it always has an
 * answer for. Both kill switches are ON in that fallback: a config request that
 * fails must not be able to take the platform down.
 */
export function usePlatformConfig(): PlatformConfig {
  const { data } = useQuery({
    queryKey: ['platform', 'config'],
    queryFn: async () => (await configApi.getPublic()).data.data,
    // Edge-cached for a minute server-side; matching that here keeps a
    // foreground poll from being a wasted round trip.
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  return data ?? PLATFORM_CONFIG_FALLBACK;
}
