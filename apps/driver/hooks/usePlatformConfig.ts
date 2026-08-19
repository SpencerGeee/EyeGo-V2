import { useQuery } from '@tanstack/react-query';
import { configApi, PLATFORM_CONFIG_FALLBACK } from '@eyego/api';
import type { PlatformConfig } from '@eyego/api';

/**
 * The operator's live settings, as the phone sees them. Mirror of the rider
 * app's hook of the same name — see apps/rider/hooks/usePlatformConfig.ts.
 *
 * Driver-side this carries the wallet minimums the earnings screen enforces and
 * the `driverOnlineEnabled` kill switch. Read them from here rather than from a
 * constant in a screen: `MIN_WITHDRAWAL_PESEWAS = 2000` lived in earnings.tsx
 * and disagreed with the server the moment the operator changed it in the
 * console, which shows a driver one minimum and rejects them against another.
 *
 * NEVER returns undefined — falls back to `PLATFORM_CONFIG_FALLBACK`, which
 * mirrors the server defaults and leaves both kill switches ON.
 */
export function usePlatformConfig(): PlatformConfig {
  const { data } = useQuery({
    queryKey: ['platform', 'config'],
    queryFn: async () => (await configApi.getPublic()).data.data,
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  return data ?? PLATFORM_CONFIG_FALLBACK;
}
