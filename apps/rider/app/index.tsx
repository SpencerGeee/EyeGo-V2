import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Loader } from '@eyego/ui';
import { useAuthStore } from '../stores/auth.store';

export default function Index() {
  const { isLoggedIn, isLoading, user } = useAuthStore();
  /**
   * The intro carousel is for a first launch. `eyego_onboarded` was written
   * when it finished and never read, so every signed-out start replayed it —
   * and a returning rider saw it again after the code screen too.
   */
  const [seenIntro, setSeenIntro] = useState<boolean | null>(null);
  useEffect(() => {
    SecureStore.getItemAsync('eyego_onboarded')
      .then((v) => setSeenIntro(v === 'true'))
      .catch(() => setSeenIntro(false));
  }, []);

  if (isLoading || (!isLoggedIn && seenIntro === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <Loader label="Signing you in…" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href={seenIntro ? '/(auth)/phone' : '/(onboarding)'} />;
  }

  if (!user?.name) {
    return <Redirect href="/(auth)/register" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
