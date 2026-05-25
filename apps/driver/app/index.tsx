import { Redirect } from 'expo-router';

// Root redirects into router — _layout.tsx handles the auth guard
export default function Index() {
  return <Redirect href="/(tabs)/home" />;
}
