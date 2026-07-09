import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii, withOpacity } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { apiClient } from '@eyego/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'eyego_notif_prefs';

interface NotifPrefs {
  driverArriving: boolean;
  tripStarted: boolean;
  tripCompleted: boolean;
  chatMessages: boolean;
  paymentConfirmations: boolean;
  promotions: boolean;
  newFeatures: boolean;
  safetyAlerts: boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  driverArriving: true,
  tripStarted: true,
  tripCompleted: true,
  chatMessages: true,
  paymentConfirmations: true,
  promotions: true,
  newFeatures: true,
  safetyAlerts: true,
};

interface SectionItem {
  key: keyof NotifPrefs;
  label: string;
  locked?: boolean;
}

interface Section {
  title: string;
  items: SectionItem[];
}

const SECTIONS: Section[] = [
  {
    title: 'TRIPS',
    items: [
      { key: 'driverArriving', label: 'Driver Arriving' },
      { key: 'tripStarted', label: 'Trip Started' },
      { key: 'tripCompleted', label: 'Trip Completed' },
    ],
  },
  {
    title: 'MESSAGES',
    items: [
      { key: 'chatMessages', label: 'Chat Messages' },
      { key: 'paymentConfirmations', label: 'Payment Confirmations' },
    ],
  },
  {
    title: 'MARKETING',
    items: [
      { key: 'promotions', label: 'Promotions & Offers' },
      { key: 'newFeatures', label: 'New Features' },
    ],
  },
  {
    title: 'SAFETY',
    items: [{ key: 'safetyAlerts', label: 'Safety Alerts', locked: true }],
  },
];

export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [syncError, setSyncError] = useState(false);

  const loadPrefs = useCallback(async () => {
    // Local cache first for instant paint…
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      }
    } catch {
      // ignore
    }
    // …then the server copy wins so prefs follow the account across devices.
    try {
      const res = await apiClient.get<{ success: boolean; data?: { prefs?: Partial<NotifPrefs> } }>(
        '/user/me/notifications'
      );
      const serverPrefs = res.data?.data?.prefs;
      if (serverPrefs && Object.keys(serverPrefs).length > 0) {
        setPrefs((p) => {
          const merged = { ...p, ...serverPrefs };
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)).catch(() => {});
          return merged;
        });
      }
    } catch {
      setSyncError(true);
    }
  }, []);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const handleToggle = async (key: keyof NotifPrefs, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSyncError(false);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      apiClient.patch('/user/me/notifications', updated).catch(() => {
        setSyncError(true);
      });
    } catch {
      // ignore local storage errors
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Notification Preferences</Text>
        <View style={{ width: 44 }} />
      </View>

      {syncError && (
        <View style={styles.syncErrorBanner}>
          <Ionicons name="warning-outline" size={14} color={colors.statusWarning} style={{ marginRight: spacing.sm }} />
          <Text variant="caption" style={{ color: colors.statusWarning, flex: 1 }}>
            Preferences saved locally — sync failed. Will retry next time.
          </Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View
          >
          {SECTIONS.map((section) => (
            <View key={section.title} style={{ marginBottom: spacing['2xl'] }}>
              <Text variant="labelCaps" style={styles.sectionLabel}>{section.title}</Text>
              <View style={styles.card}>
                {section.items.map((item, index) => (
                  <React.Fragment key={item.key}>
                    {index > 0 && <View style={styles.divider} />}
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                          {item.label}
                        </Text>
                        {item.locked && (
                          <Ionicons
                            name="lock-closed"
                            size={14}
                            color={colors.onSurfaceVariant}
                            style={{ marginLeft: spacing.sm }}
                          />
                        )}
                      </View>
                      <Switch
                        value={prefs[item.key]}
                        onValueChange={
                          item.locked ? undefined : (val) => handleToggle(item.key, val)
                        }
                        disabled={item.locked}
                        thumbColor={prefs[item.key] ? colors.primary : colors.outline}
                        trackColor={{
                          false: colors.outlineVariant,
                          true: withOpacity(colors.primary, 0.25),
                        }}
                      />
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['3xl'],
    },
    sectionLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 1.4,
      color: colors.outline,
      marginBottom: spacing.sm,
      marginLeft: spacing.xs,
    },
    card: {
      backgroundColor: colors.surfaceCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.base,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    divider: { height: 1, backgroundColor: colors.rimLightSubtle, marginHorizontal: spacing.base },
    syncErrorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: withOpacity(colors.statusWarning, 0.15),
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: withOpacity(colors.statusWarning, 0.4),
    },
  });
