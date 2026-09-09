import React from 'react';
import { View, StyleSheet } from 'react-native';
import { EmptyState } from './EmptyState';

/**
 * ── FAILURE IS NOT EMPTINESS ────────────────────────────────────────────────
 *
 * THE BUG THIS EXISTS FOR: `(tabs)/trips.tsx` renders "No trips yet" when the
 * request to load trips FAILED. A rider whose network dropped is told, in plain
 * language, that they have never taken a ride. `pay/trip/[id]` and
 * `scheduled-rides` did the same thing.
 *
 * That is worse than a blank screen, because a blank screen looks broken and a
 * wrong answer looks authoritative. It is the same shape as the
 * "fallback that lied" defects already recorded in this project's history: a
 * failure path quietly substituting a plausible-looking success.
 *
 * Forty more screens had no failure surface at all and simply rendered nothing.
 * The point of this component is that neither has to be decided per screen
 * again — there are four states a query-backed surface can be in, and the
 * caller declares the two that are actually theirs (what empty means, what the
 * content is) while the other two are answered the same way everywhere.
 *
 *   loading  → the caller's skeleton, or nothing
 *   offline  → "You're offline", with Retry
 *   error    → "Couldn't load", with Retry
 *   empty    → the caller's EmptyState
 *   data     → children
 *
 * ── WHY OFFLINE IS ITS OWN STATE ────────────────────────────────────────────
 *
 * A failed request while the phone has no signal is not a fault the user can
 * act on by retrying harder, and telling them "something went wrong" sends them
 * to support for a problem that is solved by walking outside. The two look
 * identical to react-query, so the caller passes connectivity in and the copy
 * follows it.
 */
export interface QueryBoundaryProps {
  /** react-query's `isLoading` (or `isPending` for a v5 mutation-like read). */
  loading?: boolean;
  /** react-query's `isError`. */
  error?: boolean;
  /**
   * Phone has no connectivity. Pass `useNetworkStatus().isOffline`.
   *
   * Changes only the WORDS, never the structure — see the note above on why the
   * two failures must not read the same.
   */
  offline?: boolean;
  /**
   * Is the successful result empty?
   *
   * Deliberately the caller's judgement: "empty" means different things to a
   * list, a balance and a receipt, and only the caller knows which. It is
   * evaluated ONLY when there is no error, which is the whole point.
   */
  empty?: boolean;
  /** Re-run the query. Rendered as Retry on both failure states. */
  onRetry?: () => void;
  /** Shown while loading. A skeleton belongs here; a spinner is a last resort. */
  skeleton?: React.ReactNode;
  /** What to show when the query succeeded and returned nothing. */
  emptyState?: React.ReactNode;
  /** Overrides for the failure copy, where a screen has better words. */
  errorTitle?: string;
  errorSubtitle?: string;
  children: React.ReactNode;
}

export function QueryBoundary({
  loading = false,
  error = false,
  offline = false,
  empty = false,
  onRetry,
  skeleton = null,
  emptyState = null,
  errorTitle,
  errorSubtitle,
  children,
}: QueryBoundaryProps) {
  if (loading) return <>{skeleton}</>;

  /**
   * ERROR IS CHECKED BEFORE EMPTY, ALWAYS.
   *
   * This ordering IS the fix. A failed query returns no data, so `empty` is
   * true at the same time — evaluating it first is exactly how "no trips yet"
   * ended up on top of a network failure. Error wins, and a screen physically
   * cannot show its empty state over a failure.
   */
  if (error) {
    return (
      <View style={styles.fill}>
        <EmptyState
          icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          title={errorTitle ?? (offline ? "You're offline" : "Couldn't load this")}
          subtitle={
            errorSubtitle ??
            (offline
              ? 'Check your connection — this will load as soon as you have signal.'
              : 'Something went wrong on our side. Try again in a moment.')
          }
          action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined}
        />
      </View>
    );
  }

  if (empty) return <>{emptyState}</>;

  return <>{children}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center' },
});
