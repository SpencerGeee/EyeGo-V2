import { Stack } from 'expo-router';
import { colors } from '@eyego/config';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.backgroundDeep },
        animation: 'fade',
      }}
    />
  );
}
