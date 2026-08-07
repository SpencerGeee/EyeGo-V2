import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { driverColors } from '../../utils/useColors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: driverColors.backgroundDeep },
        animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
        gestureEnabled: true,
      }}
    />
  );
}
