import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReleaseGate, ConsentGate } from '@eyego/ui';
import { userApi, queryKeys } from '@eyego/api';

import { useReleaseGate } from '../hooks/useReleaseGate';
import { usePlatformConfig } from '../hooks/usePlatformConfig';
import { useAuthStore } from '../stores/auth.store';
import { useColors } from '../utils/useColors';

/**
 * The two things that can stop the app, mounted next to `NoticeHost` inside the
 * query provider. Both draw nothing at all in the normal case.
 *
 * ORDER MATTERS. The release gate sits above the consent gate (z 9999 vs 9000)
 * because a build the operator has retired must be told to update, not asked to
 * agree to a policy it may render incorrectly. Only one is ever visible.
 */
export function ReleaseGateHost() {
  const { gate, loading } = useReleaseGate();
  const config = usePlatformConfig();
  const colors = useColors();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => !!s.accessToken);

  // Only asked of a signed-in user: there is nobody to record consent against
  // otherwise, and the signup flow shows the same links inline.
  /**
   * ONE KEY CANNOT HOLD TWO SHAPES.
   *
   * BUGFIX ("I cancelled a trip I requested and it brought me back to the
   * agree-terms page — it should only show once").
   *
   * This ran `(await getProfile()).data.data` while `profile/safety.tsx`
   * fills the SAME key with the whole axios response and unwraps in its own
   * `select`. Whichever query fetched last decided what the cache held, so
   * after any visit to Safety — or any invalidation of this key — the host
   * was reading `acceptedTermsVersion` off an AxiosResponse. It came back
   * undefined, `consentRequired` became `undefined !== TERMS_VERSION`, and
   * a rider who had already consented was walled again.
   *
   * Cache the response, unwrap in `select`, exactly as the other reader does.
   */
  const { data: me } = useQuery({
    queryKey: queryKeys.user.profile,
    queryFn: () => userApi.getProfile(),
    select: (r: any) => r?.data?.data ?? r?.data ?? null,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const accept = useMutation({
    mutationFn: () => userApi.acceptTerms(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.profile }),
  });

  const user = me as
    | { acceptedTermsVersion?: string | null; acceptedPrivacyVersion?: string | null; isReviewer?: boolean }
    | undefined;

  /**
   * Behind on either document, including never having accepted at all.
   *
   * Held back until BOTH the user and the published versions are known — a
   * momentary "undefined !== '2026-09-01'" during the first render would flash
   * a consent wall at somebody who has already consented.
   *
   * App-review accounts are exempt. A reviewer who cannot get past a consent
   * screen files a rejection, and their consent means nothing anyway.
   */
  const consentRequired =
    !!user &&
    !user.isReviewer &&
    !!config.termsVersion &&
    !!config.privacyVersion &&
    (user.acceptedTermsVersion !== config.termsVersion ||
      user.acceptedPrivacyVersion !== config.privacyVersion);

  return (
    <>
      <ReleaseGate
        loading={loading}
        upgradeRequired={gate.upgradeRequired}
        maintenance={gate.maintenance}
        maintenanceMessage={gate.maintenanceMessage}
        storeUrl={gate.storeUrl}
        backgroundColor={colors.background}
      />
      <ConsentGate
        required={consentRequired && !gate.upgradeRequired && !gate.maintenance}
        termsUrl={config.termsUrl}
        privacyUrl={config.privacyUrl}
        submitting={accept.isPending}
        onAccept={() => accept.mutate()}
        backgroundColor={colors.background}
        accentColor={colors.primary}
        onSurfaceColor={colors.onSurface}
        // A gate with no way out must be able to say why it will not open.
        errorText={accept.isError ? acceptErrorText(accept.error) : null}
      />
    </>
  );
}

/** The server’s own words where it gave any, a plain sentence otherwise. */
function acceptErrorText(err: unknown): string {
  const fromServer = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  const fromClient = (err as { message?: string })?.message;
  return fromServer || fromClient || 'Please check your connection and try again.';
}
