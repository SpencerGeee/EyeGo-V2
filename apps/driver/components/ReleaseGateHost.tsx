import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReleaseGate, ConsentGate } from '@eyego/ui';
import { driverApi, userApi } from '@eyego/api';

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

  const { data: me } = useQuery({
    queryKey: DRIVER_ME_KEY,
    queryFn: async () => (await driverApi.getMe()).data.data,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  // Consent is recorded against the User row behind the driver, so this is the
  // same endpoint the rider app calls.
  const accept = useMutation({
    mutationFn: () => userApi.acceptTerms(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DRIVER_ME_KEY }),
  });

  const driver = me as
    | {
        user?: { acceptedTermsVersion?: string | null; acceptedPrivacyVersion?: string | null; isReviewer?: boolean };
        acceptedTermsVersion?: string | null;
        acceptedPrivacyVersion?: string | null;
        isReviewer?: boolean;
      }
    | undefined;

  // The driver payload may carry the user fields nested or flattened depending
  // on the endpoint's shape; read either rather than guessing wrong and
  // prompting a driver who has already consented.
  const acceptedTerms = driver?.user?.acceptedTermsVersion ?? driver?.acceptedTermsVersion;
  const acceptedPrivacy = driver?.user?.acceptedPrivacyVersion ?? driver?.acceptedPrivacyVersion;
  const isReviewer = driver?.user?.isReviewer ?? driver?.isReviewer ?? false;

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
      />
    </>
  );
}
