import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { navigationUrls, hasCoords, type GeoPlace, type NavApp } from '@eyego/utils';

/**
 * Hand turn-by-turn navigation off to the driver's own map app.
 *
 * Every serious driver app does this: EyeGo's in-app map is for the trip (who is
 * aboard, where the stops are, what the fare is), but a driver who knows Accra
 * through Google Maps' live traffic should not be forced to navigate with ours.
 * Uber and Bolt both ship exactly this — a per-driver preference plus a one-tap
 * hand-off — so this mirrors it rather than inventing a flow.
 *
 * The preference is remembered on the device, because being asked "which app?"
 * on every leg of every trip is worse than not having the feature.
 */
const PREF_KEY = '@eyego_driver_nav_app';

/**
 * The URL shapes live in `@eyego/utils/geo-links`, not here.
 *
 * They used to live in this file, and three of the four builders quietly
 * dropped the `label` they were handed because their scheme had nowhere to put
 * a coordinate pair AND a name. That is what put "5.628876, -0.170849" in the
 * driver's destination field instead of a place they could read. The shared
 * module sends the ADDRESS as the destination and keeps coordinates only as the
 * fallback — see the rule written down at the top of that file.
 *
 * Everything below is unchanged: which app, remembering the choice, the chooser.
 */
export type { NavApp } from '@eyego/utils';
type NavTarget = GeoPlace;

function urlsFor(app: NavApp, target: NavTarget, origin?: NavTarget | null): { primary: string; fallback: string } {
  return navigationUrls(app, target, Platform.OS, origin ?? null);
}

async function launch(app: NavApp, target: NavTarget, origin?: NavTarget | null): Promise<boolean> {
  const { primary, fallback } = urlsFor(app, target, origin);
  try {
    await Linking.openURL(primary);
    return true;
  } catch {
    try {
      // Universal/https links always resolve — worst case the browser opens the
      // web map, which is still a usable route.
      await Linking.openURL(fallback);
      return true;
    } catch {
      return false;
    }
  }
}

async function installedApps(): Promise<NavApp[]> {
  const candidates: NavApp[] = Platform.OS === 'ios'
    ? ['apple', 'google', 'waze']
    : ['google', 'waze'];
  const found: NavApp[] = [];
  for (const app of candidates) {
    // Apple Maps is guaranteed present on iOS and `maps://` is always allowed.
    if (app === 'apple') { found.push(app); continue; }
    try {
      if (await Linking.canOpenURL(urlsFor(app, { latitude: 0, longitude: 0 }).primary)) found.push(app);
    } catch {
      // canOpenURL throws when the scheme isn't declared in
      // LSApplicationQueriesSchemes/queries — treat as "not installed" rather
      // than failing the whole hand-off.
    }
  }
  // Google Maps' https form works even when the app isn't installed, so it is
  // always offered as a last resort rather than leaving the driver with nothing.
  if (!found.includes('google')) found.push('google');
  return found;
}

const LABELS: Record<NavApp, string> = {
  google: 'Google Maps',
  apple: 'Apple Maps',
  waze: 'Waze',
};

export async function getPreferredNavApp(): Promise<NavApp | null> {
  try {
    const v = await AsyncStorage.getItem(PREF_KEY);
    return v === 'google' || v === 'apple' || v === 'waze' ? v : null;
  } catch {
    return null;
  }
}

export async function setPreferredNavApp(app: NavApp | null): Promise<void> {
  try {
    if (app) await AsyncStorage.setItem(PREF_KEY, app);
    else await AsyncStorage.removeItem(PREF_KEY);
  } catch {
    // A device that can't persist the choice just gets asked again next time.
  }
}

/**
 * Open external navigation to `target`.
 *
 * First call asks which app to use and remembers the answer; later calls go
 * straight there. Pass `forceChooser` (the Navigate button's long-press) to
 * re-ask, which is also how a driver switches away from a choice they regret.
 */
export async function openExternalNavigation(
  target: NavTarget,
  /**
   * `origin` describes the WHOLE LEG rather than only its end. Passed once the
   * passenger is aboard, so the driver's map app opens on the trip's real
   * pickup → drop-off route instead of "from wherever I am to the kerb I am
   * already standing on". Omitted before that, where navigating from the
   * driver's current position is the correct thing.
   */
  opts?: { forceChooser?: boolean; origin?: NavTarget | null },
): Promise<void> {
  if (!hasCoords(target)) {
    Alert.alert('No coordinates', 'This stop has no location to navigate to yet.');
    return;
  }
  const origin = opts?.origin && hasCoords(opts.origin) ? opts.origin : null;

  if (!opts?.forceChooser) {
    const pref = await getPreferredNavApp();
    if (pref) {
      const ok = await launch(pref, target, origin);
      if (!ok) Alert.alert('Could not open', `${LABELS[pref]} could not be opened on this device.`);
      return;
    }
  }

  const apps = await installedApps();
  if (apps.length === 1) {
    await setPreferredNavApp(apps[0]);
    await launch(apps[0], target, origin);
    return;
  }

  Alert.alert(
    'Navigate with',
    'EyeGo will remember your choice. Long-press Navigate to change it.',
    [
      ...apps.map((app) => ({
        text: LABELS[app],
        onPress: () => {
          void setPreferredNavApp(app);
          void launch(app, target, origin);
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ],
    { cancelable: true },
  );
}
