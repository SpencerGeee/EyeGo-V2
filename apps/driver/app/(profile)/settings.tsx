import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Switch, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const NOTIF_KEY = 'eyego_driver_notifications_enabled';

type NavApp = 'google_maps' | 'waze' | 'apple_maps';
const NAV_OPTIONS: { key: NavApp; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'google_maps', label: 'Google Maps', icon: 'navigate-outline' },
  { key: 'waze', label: 'Waze', icon: 'car-outline' },
  { key: 'apple_maps', label: 'Apple Maps', icon: 'map-outline' },
];

const PRIVACY_TEXT = `EyeGo collects your location during active trips to provide real-time tracking for passengers and route optimisation. Your personal data is never sold to third parties. You may request deletion of your account data by contacting support@eyego.app.\n\nFor the full privacy policy, visit eyego.app/privacy.`;

const TERMS_TEXT = `By using the EyeGo Driver app you agree to our driver terms of service. You must maintain valid insurance and a clean driving record. EyeGo reserves the right to suspend accounts that violate community standards or engage in fraudulent activity.\n\nFor full terms, visit eyego.app/terms.`;

function ExpandSection({ title, body, colors }: { title: string; body: string; colors: DriverColors }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: `${colors.outline}88` }}>
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md }}
        onPress={() => setOpen((v) => !v)}
      >
        <Text style={{ flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
          {title}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.onSurfaceVariant} />
      </Pressable>
      {open && (
        <MotiView
          from={{ opacity: 0, translateY: -4 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ paddingBottom: spacing.base, lineHeight: 22 }}>
            {body}
          </Text>
        </MotiView>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { theme, setTheme, logout } = useDriverStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [navApp, setNavApp] = useState<NavApp>('google_maps');

  useEffect(() => {
    // Local cache first for instant paint...
    AsyncStorage.getItem(NOTIF_KEY).then((val) => {
      if (val !== null) setNotificationsEnabled(val === 'true');
    });
    AsyncStorage.getItem('eyego_driver_nav_app').then((val) => {
      if (val) setNavApp(val as NavApp);
    });
    // ...then the account's saved value wins, so this follows the driver
    // across reinstalls/devices instead of always defaulting to "on".
    // Previously toggling this only wrote to AsyncStorage — nothing was ever
    // sent to the backend, so the setting was invisible to anything else
    // (support, admin) and lost on reinstall.
    driverApi.getMe().then((res) => {
      const remote = (res.data as any)?.data?.notificationsEnabled;
      if (typeof remote === 'boolean') {
        setNotificationsEnabled(remote);
        AsyncStorage.setItem(NOTIF_KEY, String(remote)).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const handleDeleteAccount = () => {
    // Route to the dedicated deletion screen, which calls the real
    // DELETE /driver/me endpoint with proper error handling. The previous
    // inline flow PATCHed { isDeleted: true } — a field updateMe ignores —
    // then logged out regardless: the account was never actually deleted
    // and any failure was swallowed.
    router.push('/(profile)/account-deletion' as any);
  };

  const toggleNotifications = (val: boolean) => {
    setNotificationsEnabled(val);
    AsyncStorage.setItem(NOTIF_KEY, String(val));
    driverApi.updatePreferences({ notificationsEnabled: val }).catch((e) =>
      console.warn('[Settings] Failed to sync notification preference:', e)
    );
  };

  const updateNavPref = useMutation({
    mutationFn: (app: NavApp) => driverApi.updatePreferences({ navigationApp: app }),
    onError: () => Alert.alert('Error', 'Failed to save navigation preference.'),
  });

  const handleSelectNav = (app: NavApp) => {
    setNavApp(app);
    AsyncStorage.setItem('eyego_driver_nav_app', app);
    updateNavPref.mutate(app);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>Settings</Text>
        </MotiView>

        {/* Preferences */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 80 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>Preferences</Text>
          <View style={styles.card}>
            {/* Theme toggle */}
            <View style={[styles.settingsRow, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
              <View style={styles.iconBg}>
                <Ionicons name={theme === 'dark' ? 'moon-outline' : 'sunny-outline'} size={18} color={colors.primary} />
              </View>
              <Text style={styles.rowLabel}>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</Text>
              <Switch
                value={theme === 'dark'}
                onValueChange={(val) => setTheme(val ? 'dark' : 'light')}
                trackColor={{ false: colors.outline, true: colors.primary }}
                thumbColor={colors.onPrimary}
              />
            </View>
            {/* Notifications toggle */}
            <View style={[styles.settingsRow, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
              <View style={styles.iconBg}>
                <Ionicons name="notifications-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.rowLabel}>Push Notifications</Text>
              <Switch
                value={notificationsEnabled}
                onValueChange={toggleNotifications}
                trackColor={{ false: colors.outline, true: colors.primary }}
                thumbColor={colors.onPrimary}
              />
            </View>
          </View>
        </MotiView>

        {/* Navigation App */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 100 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>Navigation App</Text>
          <View style={styles.card}>
            {NAV_OPTIONS.map((opt, i) => (
              <Pressable
                key={opt.key}
                style={[styles.settingsRow, i < NAV_OPTIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}
                onPress={() => handleSelectNav(opt.key)}
              >
                <View style={styles.iconBg}>
                  <Ionicons name={opt.icon} size={18} color={navApp === opt.key ? colors.primary : colors.onSurfaceVariant} />
                </View>
                <Text style={[styles.rowLabel, navApp === opt.key && { color: colors.primary }]}>{opt.label}</Text>
                {navApp === opt.key && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </MotiView>

        {/* Legal */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>Legal</Text>
          <View style={styles.card}>
            <ExpandSection title="Privacy Policy" body={PRIVACY_TEXT} colors={colors} />
            <ExpandSection title="Terms of Service" body={TERMS_TEXT} colors={colors} />
          </View>
        </MotiView>

        {/* Account */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 140 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <Pressable
              style={[styles.settingsRow, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}
              onPress={() => { logout(); router.replace('/(auth)/phone' as any); }}
            >
              <View style={[styles.iconBg, { backgroundColor: `${colors.error}18` }]}>
                <Ionicons name="log-out-outline" size={18} color={colors.error} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.error }]}>Logout</Text>
            </Pressable>
            <Pressable
              style={[styles.settingsRow, { borderColor: `${colors.error}30` }]}
              onPress={handleDeleteAccount}
            >
              <View style={[styles.iconBg, { backgroundColor: `${colors.error}18` }]}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.error }]}>Delete Account</Text>
            </Pressable>
          </View>
        </MotiView>

        {/* App info */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 160 }}
          style={styles.appInfo}
        >
          <Text variant="caption" color={colors.onSurfaceVariant}>EyeGo Driver · Version 1.0.0</Text>
          <Text variant="caption" color={colors.onSurfaceVariant}>© 2025 EyeGo Technologies</Text>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    headline: { letterSpacing: -1, marginBottom: spacing['2xl'] },
    sectionLabel: { marginBottom: spacing.sm, marginLeft: spacing.xs },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.xl,
      marginBottom: spacing.xl,
    },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.base,
      gap: spacing.md,
    },
    iconBg: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: `${colors.primary}18`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    appInfo: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  });
