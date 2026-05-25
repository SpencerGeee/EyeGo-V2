import React from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../stores/auth.store';
import { darkColors as colors } from '../utils/useColors';

export default function Index() {
  const { isLoggedIn, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.backgroundDeep, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
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
