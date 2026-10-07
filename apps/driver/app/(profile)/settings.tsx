import React, { useState, useEffect } from 'react';
import { Switch, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { Ionicons } from '@expo/vector-icons';
import { Screen, ListSection, ListRow, Text, goDeeper, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { getPreferredNavApp, setPreferredNavApp, type NavApp } from '../../utils/externalNav';

const NOTIF_KEY = 'eyego_driver_notifications_enabled';

// One vocabulary, one key: the value here is what `openExternalNavigation`
// reads on the trip page.
const NAV_OPTIONS: { key: NavApp; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'google', label: 'Google Maps', icon: 'navigate-outline' },
  { key: 'waze', label: 'Waze', icon: 'car-outline' },
  ...(Platform.OS === 'ios' ? [{ key: 'apple' as const, label: 'Apple Maps', icon: 'map-outline' as const }] : []),
];
const SERVER_NAV: Record<NavApp, 'google_maps' | 'waze' | 'apple_maps'> = {
  google: 'google_maps', waze: 'waze', apple: 'apple_maps',
};

/**
 * SETTINGS — the driver's settings hub (rival spec §18).
 *
 * Holds what Uber keeps under Settings: navigation app, request alerts,
 * appearance, legal, and Delete account last. Log out stays on the Account tab.
 *
 * BUGFIXES carried in this rewrite:
 *  - the saved notification + maps-app choice never came back after a
 *    reinstall: getMe answers `{ driver }`, this read `data.notificationsEnabled`.
 *  - Legal showed two placeholder paragraphs while the real Driver Agreement
 *    and Privacy Policy screens sat one route away.
 */
export default function SettingsScreen() {
  const colors = useColors();
  const { theme, setTheme, offerAlertsEnabled, setOfferAlertsEnabled } = useDriverStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [navApp, setNavApp] = useState<NavApp | null>(null);

  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const data = (r.data as any)?.data;
      return data?.driver ?? data;
    },
  });

  // Local cache first for an instant paint...
  useEffect(() => {
    AsyncStorage.getItem(NOTIF_KEY).then((val) => {
      if (val !== null) setNotificationsEnabled(val === 'true');
    });
    getPreferredNavApp().then((val) => { if (val) setNavApp(val); });
  }, []);

  // ...then the account's saved values win, so they follow the driver across
  // reinstalls and devices.
  useEffect(() => {
    const remote = me.data?.notificationsEnabled;
    if (typeof remote === 'boolean') {
      setNotificationsEnabled(remote);
      AsyncStorage.setItem(NOTIF_KEY, String(remote)).catch(() => {});
    }
    const local = (Object.keys(SERVER_NAV) as NavApp[]).find((k) => SERVER_NAV[k] === me.data?.navigationApp);
    if (local) getPreferredNavApp().then((cur) => { if (!cur) { setNavApp(local); void setPreferredNavApp(local); } });
  }, [me.data?.notificationsEnabled, me.data?.navigationApp]);

  const toggleNotifications = (val: boolean) => {
    setNotificationsEnabled(val);
    AsyncStorage.setItem(NOTIF_KEY, String(val));
    driverApi.updatePreferences({ notificationsEnabled: val }).catch(() => {
      notify(null, 'Couldn’t save that on your account — it will apply on this phone.');
    });
  };

  const updateNavPref = useMutation({
    mutationFn: (app: NavApp) => driverApi.updatePreferences({ navigationApp: SERVER_NAV[app] }),
    onError: () => notify(null, 'Failed to save navigation preference.'),
  });

  const handleSelectNav = (app: NavApp) => {
    setNavApp(app);
    void setPreferredNavApp(app);
    updateNavPref.mutate(app);
  };

  const switchProps = {
    trackColor: { false: colors.outline, true: colors.primary },
    thumbColor: colors.onPrimary,
  };

  return (
    <Screen title="Settings">
      <ListSection title="Navigation app" footer="Opens when you tap Navigate on a trip.">
        {NAV_OPTIONS.map((opt) => (
          <ListRow
            key={opt.key}
            icon={opt.icon}
            title={opt.label}
            onPress={() => handleSelectNav(opt.key)}
            chevron={false}
            right={navApp === opt.key ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : undefined}
            accessibilityLabel={`${opt.label}${navApp === opt.key ? ', selected' : ''}`}
          />
        ))}
      </ListSection>

      {/*
        THE ONE ALERT THAT COSTS MONEY TO MISS. "New ride alert" is separate
        from push on purpose: it is the in-app alarm while a ride is offered. A
        driver who mutes marketing pushes must not also silence the offer that
        pays them. See utils/dispatchAlert.ts.
      */}
      <ListSection title="Alerts">
        <ListRow
          icon="volume-high-outline"
          title="New ride alert"
          subtitle="Chime and vibrate while a ride is offered to you, until you answer."
          right={<Switch value={offerAlertsEnabled} onValueChange={setOfferAlertsEnabled} {...switchProps} />}
        />
        <ListRow
          icon="notifications-outline"
          title="Push notifications"
          subtitle="Trip updates, payouts and account notices."
          right={<Switch value={notificationsEnabled} onValueChange={toggleNotifications} {...switchProps} />}
        />
      </ListSection>

      {/* Dark is the design — a driver reads this in a cradle, often at night. */}
      <ListSection title="Appearance" footer="EyeGo is designed for dark mode: easier to read at night and in a cradle.">
        <ListRow
          icon={theme === 'dark' ? 'moon-outline' : 'sunny-outline'}
          title="Dark mode"
          right={<Switch value={theme === 'dark'} onValueChange={(v) => setTheme(v ? 'dark' : 'light')} {...switchProps} />}
        />
      </ListSection>

      <ListSection title="Legal">
        <ListRow icon="document-text-outline" title="Driver agreement" onPress={() => goDeeper('/(profile)/terms')} />
        <ListRow icon="lock-closed-outline" title="Privacy policy" onPress={() => goDeeper('/(profile)/privacy')} />
      </ListSection>

      <ListSection>
        <ListRow icon="trash-outline" title="Delete account" destructive onPress={() => goDeeper('/(profile)/account-deletion')} />
      </ListSection>

      <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: 28 }}>
        EyeGo Driver · Version 1.0.0
      </Text>
    </Screen>
  );
}
