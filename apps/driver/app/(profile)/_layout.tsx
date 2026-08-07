import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { driverColors } from '../../utils/useColors';

export default function ProfileGroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: driverColors.backgroundDeep },
        // `default` = UINavigationController's own push on iOS: parallax on the
        // outgoing screen and a real interactive pop. See `detailPush` in
        // app/_layout.tsx for why the re-implemented slide is not the same.
        animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
        gestureEnabled: true,
      }}
    />
  );
}
