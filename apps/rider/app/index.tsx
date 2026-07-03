import React from 'react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { Loader } from '@eyego/ui';
import { useAuthStore } from '../stores/auth.store';
import { darkColors as colors } from '../utils/useColors';

export default function Index() {
  const { isLoggedIn, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <Loader label="Signing you in…" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return <Redirect href="/(onboarding)" />;
  }

  if (isLoggedIn && (!user?.name || user.name === '')) {
    return <Redirect href="/(auth)/register" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
