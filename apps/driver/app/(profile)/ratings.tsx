import { Redirect } from 'expo-router';

// Ratings and Performance are one page now (rival spec §17); old links land there.
export default function RatingsRedirect() {
  return <Redirect href="/(profile)/performance" />;
}
