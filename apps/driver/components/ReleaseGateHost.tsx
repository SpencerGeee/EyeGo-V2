import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReleaseGate, ConsentGate } from '@eyego/ui';
import { driverApi } from '@eyego/api';

import { useReleaseGate } from '../hooks/useReleaseGate';
import { usePlatformConfig } from '../hooks/usePlatformConfig';
import { useDriverStore } from '../stores/driver.store';
import { useColors } from '../utils/useColors';

/** Mirror of the rider's host — see apps/rider/components/ReleaseGateHost.tsx. */
const DRIVER_ME_KEY = ['driver', 'me'] as const;

/**
 * The two things that can stop the app, mounted next to `NoticeHost` inside the
 * query provider. Both draw nothing in the normal case.
 *
 * The release gate sits above the consent gate (z 9999 vs 9000): a build the
 * operator has retired must be told to update, not asked to agree to a policy
 * it may render incorrectly.
 *
 * Stranding a driver is more expensive than stranding a rider — they cannot
 * earn while either gate is up — which is a reason to be careful with the
 * settings behind these, not a reason to make the gates weaker.
 */
export function ReleaseGateHost() {
  const { gate, loading } = useReleaseGate();
  const config = usePlatformConfig();
  const colors = useColors();
  const queryClient = useQueryClient();
  const isAuthenticated = useDriverStore((s) => !!s.accessToken);

  /**
   * SAME KEY, SAME SHAPE AS EVERY OTHER READER.
   *
   * This used to run its own queryFn — `(await getMe()).data.data` — under the
   * key `['driver','me']` that home.tsx, profile.tsx, earnings.tsx and
   * vehicle.tsx already fill with the whole axios response. One key cannot
   * hold two shapes: whichever query mounted first won, and since the tabs
   * mount first this component read an AxiosResponse as if it were a driver.
   *
   * Every field below then came back undefined, so `consentRequired` was
   * `undefined !== TERMS_VERSION` — permanently true. The gate could not be
   * dismissed by accepting, because accepting was never what it was waiting
   * for. Unwrap the way the rest of the app does, in `select`.
   */
  const { data: me } = useQuery({
    queryKey: DRIVER_ME_KEY,
    queryFn: () => driverApi.getMe(),
    // Backend answers `ok(res, { driver })`, so the row is one level down.
    select: (r) => {
      const body = (r.data as any)?.data;
      return body?.driver ?? body;
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  /**
   * Consent is recorded against the DRIVER row, not a User behind it.
   *
   * This called `userApi.acceptTerms()` — /user/me/accept-terms — whose
   * middleware accepts a PASSENGER token only. Every driver tap came back
   * 401 'Invalid token role', the mutation had no onError, and the gate
   * simply stayed up: the button did nothing at all.
   */
  const accept = useMutation({
    mutationFn: () => driverApi.acceptTerms(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DRIVER_ME_KEY }),
  });

  const driver = me as
    | {
        acceptedTermsVersion?: string | null;
        acceptedPrivacyVersion?: string | null;
      }
    | undefined;

  /**
   * Flat, because a Driver is its own identity row — there is no User behind
   * it to nest these under. The nested `driver.user.*` fallback this used to
   * carry described a shape the endpoint never returns.
   */
  const acceptedTerms = driver?.acceptedTermsVersion;
  const acceptedPrivacy = driver?.acceptedPrivacyVersion;

  /**
   * No driver-side exemption: `isReviewer` is a column on User, and getMe()
   * selects nothing of the sort, so this was always undefined anyway. A review
   * account therefore sees this gate — survivable now that accepting clears
   * it, which is exactly why the two defects above mattered. A real exemption
   * needs an `isReviewer` column on Driver, and a migration with it.
   */
  const isReviewer = false;

  const consentRequired =
    !!driver &&
    !isReviewer &&
    !!config.termsVersion &&
    !!config.privacyVersion &&
    (acceptedTerms !== config.termsVersion || acceptedPrivacy !== config.privacyVersion);

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
