import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import { useAuthStore } from '../stores/auth.store';

/**
 * Keeps the auth store's cached `user` reconciled with the server.
 *
 * The store's copy is seeded by `login()`, whose payload is minted at OTP time
 * — before onboarding has collected a name, a date of birth or an avatar. It
 * was previously never refreshed, so those fields stayed blank on every screen
 * that renders `user` even though the database had them, and the profile
 * screen invited the rider to "save" a profile they had already saved.
 *
 * Mount this once, high in the logged-in tree. It shares the
 * `['user','profile']` query key with the profile screen, so this adds no
 * extra network traffic — it just stops the answer being thrown away.
 */
export function useProfileSync() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const mergeUser = useAuthStore((s) => s.mergeUser);

  const { data: freshProfile } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: () => userApi.getProfile(),
    select: (r: any) => r.data?.data ?? null,
    enabled: isLoggedIn,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (freshProfile) mergeUser(freshProfile);
  }, [freshProfile, mergeUser]);

  return freshProfile ?? null;
}
