import { useQuery } from '@tanstack/react-query';
import { walletApi, queryKeys } from '@eyego/api';

/**
 * THE RIDER'S BALANCE — one queryFn and one shape for its one cache key.
 *
 * BUGFIX ("the balance and top-up page show an empty state"). Four screens read
 * `['wallet','balance']` and did not agree on what was in it: `pay/trip/[id]`
 * cached the UNWRAPPED body, the other three expected the axios response, and
 * the profile card read a `balance` field the API has never sent — so it said
 * GH₵0.00 with a perfectly good balance on the account, and after a scan-to-pay
 * so did the wallet and send-money screens. A key has one writer now.
 *
 * Pesewas, or `null` when we do not know — never a fabricated 0. Callers show a
 * skeleton while `isPending` and a retry on `isError`, so "we could not ask" can
 * no longer read as "you have no money".
 */
export function useWalletBalance(opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.wallet.balance(),
    queryFn: () => walletApi.getBalance(),
    select: (r): number | null => {
      const v = (r.data as { data?: { balancePesewas?: unknown } } | undefined)?.data?.balancePesewas;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    },
    staleTime: 15_000,
    ...opts,
  });
}
