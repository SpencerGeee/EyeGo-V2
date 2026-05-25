import { Stack } from 'expo-router';
import { driverColors } from '../../utils/useColors';

export default function ProfileGroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: driverColors.backgroundDeep },
        animation: 'slide_from_right',
      }}
    />
  );
}
