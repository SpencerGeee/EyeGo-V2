import { useEffect, useRef } from 'react';
import { AppState, Alert } from 'react-native';
import * as Updates from 'expo-updates';

// How often we're willing to hit the update server. Checks run on cold start
// and whenever the app returns to the foreground, throttled to this interval.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Over-the-air updates via EAS Update. Downloads new JS bundles in the
 * background and offers a restart — it never force-reloads, because yanking
 * the app out from under someone mid-booking would lose their flow. If they
 * pick "Later", the downloaded update still applies automatically on the
 * next cold start (expo-updates default behavior).
 *
 * No-ops in dev and in builds without OTA configured (Updates.isEnabled),
 * so Expo Go / dev-client sessions are unaffected.
 */
export function useOtaUpdates() {
  const lastCheckAt = useRef(0);
  const prompting = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      const now = Date.now();
      if (now - lastCheckAt.current < CHECK_INTERVAL_MS) return;
      lastCheckAt.current = now;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (prompting.current) return;
        prompting.current = true;
        Alert.alert(
          'Update ready',
          'A new version of EyeGo has been downloaded. Restart now to apply it?',
          [
            { text: 'Later', style: 'cancel', onPress: () => { prompting.current = false; } },
            { text: 'Restart', onPress: () => { Updates.reloadAsync().catch(() => { prompting.current = false; }); } },
          ],
        );
      } catch (err) {
        // Network flakiness is normal here — never surface OTA errors to users.
        console.warn('[OTA] update check failed:', err instanceof Error ? err.message : String(err));
      }
    };

    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);
}
