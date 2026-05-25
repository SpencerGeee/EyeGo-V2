import { Stack } from 'expo-router';
import { colors } from '@eyego/config';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.backgroundDeep },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="social" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack>
  );
}
