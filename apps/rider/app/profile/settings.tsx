import React from 'react';
import { Switch } from 'react-native';
import { Screen, ListSection, ListRow, goDeeper } from '@eyego/ui';
import { formatPhone } from '@eyego/utils';
import { useColors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';
import { useAuthStore } from '../../stores/auth.store';

/**
 * SETTINGS (rival spec §7) — one hub for everything about the account that
 * isn't money or rides. Privacy, safety, legal and delete used to be spread
 * over the Account tab, Settings and a second delete flow inside Privacy.
 */
export default function SettingsScreen() {
  const colors = useColors();
  const { isDark, setDark } = useThemeStore();
  const user = useAuthStore((s) => s.user);

  return (
    <Screen title="Settings">
      <ListSection title="Account">
        <ListRow
          icon="person-outline"
          title={user?.name || 'Your profile'}
          subtitle={[user?.phone ? formatPhone(user.phone) : null, (user as any)?.email].filter(Boolean).join(' · ') || 'Name, phone, email'}
          onPress={() => goDeeper('/profile/edit')}
        />
        <ListRow icon="bookmark-outline" title="Saved places" subtitle="Home, work and favourites" onPress={() => goDeeper('/profile/saved-places')} />
      </ListSection>

      <ListSection
        title="Appearance"
        footer="EyeGo is designed for dark mode — the map and motion are tuned for it. Light mode works fully."
      >
        <ListRow
          icon="moon-outline"
          title="Dark mode"
          right={
            <Switch
              value={isDark}
              onValueChange={setDark}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#fff"
              ios_backgroundColor={colors.surfaceContainerHighest}
              accessibilityLabel="Dark mode"
            />
          }
        />
      </ListSection>

      <ListSection title="Preferences">
        <ListRow icon="notifications-outline" title="Notifications" subtitle="Trips, messages, offers" onPress={() => goDeeper('/profile/notification-preferences')} />
        <ListRow icon="lock-closed-outline" title="Privacy" subtitle="Location, marketing, crash reports" onPress={() => goDeeper('/profile/privacy')} />
        <ListRow icon="shield-checkmark-outline" title="Safety" subtitle="Trusted contacts and safety tools" onPress={() => goDeeper('/profile/safety')} />
      </ListSection>

      <ListSection title="Legal">
        <ListRow icon="document-text-outline" title="Terms of service" onPress={() => goDeeper('/profile/terms')} />
        <ListRow icon="lock-closed-outline" title="Privacy policy" onPress={() => goDeeper('/profile/privacy-policy')} />
      </ListSection>

      <ListSection>
        <ListRow icon="trash-outline" title="Delete account" destructive onPress={() => goDeeper('/profile/account-deletion')} />
      </ListSection>
    </Screen>
  );
}
