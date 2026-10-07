import React, { useEffect, useState } from 'react';
import { Linking, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen, ListSection, ListRow, goDeeper } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { CRASH_REPORTS_KEY, setCrashReporting } from '../../lib/sentry';

/**
 * PRIVACY (rival spec §7) — only controls that do something.
 *
 * This page had three switches the server stored and nothing ever read
 * ("Share location with driver" changed nothing; marketing had its real switch
 * in Notification preferences; crash reports went out regardless), the whole
 * policy inline, and a second delete-account flow. Now: location is the phone's
 * setting, marketing links to the real switch, crash reports is wired, and
 * delete goes to the one delete flow.
 */
export default function PrivacyScreen() {
  const colors = useColors();
  const [crashReports, setCrashReports] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(CRASH_REPORTS_KEY)
      .then((v) => setCrashReports(v !== 'false'))
      .catch(() => {});
  }, []);

  return (
    <Screen title="Privacy">
      <ListSection title="Your data" footer="Location is used while the app is open, to find trips near you and track your ride. It’s controlled by your phone.">
        <ListRow icon="location-outline" title="Location access" subtitle="Change in your phone’s settings" onPress={() => Linking.openSettings()} />
        <ListRow icon="megaphone-outline" title="Marketing messages" subtitle="Promotions and offers" onPress={() => goDeeper('/profile/notification-preferences')} />
        <ListRow
          icon="bug-outline"
          title="Crash reports"
          subtitle="Send anonymous crash details so we can fix them"
          right={
            <Switch
              value={crashReports}
              onValueChange={(v) => {
                setCrashReports(v);
                setCrashReporting(v);
              }}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#fff"
              ios_backgroundColor={colors.surfaceContainerHighest}
              accessibilityLabel="Crash reports"
            />
          }
        />
      </ListSection>

      <ListSection title="Policies">
        <ListRow icon="lock-closed-outline" title="Privacy policy" onPress={() => goDeeper('/profile/privacy-policy')} />
        <ListRow icon="document-text-outline" title="Terms of service" onPress={() => goDeeper('/profile/terms')} />
      </ListSection>

      <ListSection footer="Deleting removes your name, phone and photo. Records the law requires, like payments, are kept as long as it requires.">
        <ListRow icon="trash-outline" title="Delete account" destructive onPress={() => goDeeper('/profile/account-deletion')} />
      </ListSection>
    </Screen>
  );
}
