import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
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

  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const handleToggle = async (key: keyof NotifPrefs, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      // fire-and-forget
      apiClient.patch('/user/me/notifications', updated).catch(() => {});
    } catch {
      // ignore local errors
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Notification Preferences</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          {SECTIONS.map((section) => (
            <View key={section.title} style={{ marginBottom: spacing['2xl'] }}>
              <Text
                variant="labelSmall"
                style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
              >
                {section.title}
              </Text>
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
                        thumbColor={prefs[item.key] ? colors.primary : colors.outline ?? '#ccc'}
                        trackColor={{
                          false: colors.outlineVariant,
                          true: colors.primary + '40',
                        }}
                      />
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))}
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    sectionLabel: { letterSpacing: 1, marginBottom: spacing.base },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.base,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    divider: { height: 1, backgroundColor: colors.outlineVariant, marginHorizontal: spacing.base },
  });
