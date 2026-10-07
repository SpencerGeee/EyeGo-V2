import React, { useState, useEffect, useCallback } from 'react';
import { Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@eyego/api';
import { Screen, ListSection, ListRow } from '@eyego/ui';
import { useColors } from '../../utils/useColors';

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

const SECTIONS: { title: string; footer?: string; items: { key: keyof NotifPrefs; label: string; hint?: string; locked?: boolean }[] }[] = [
  {
    title: 'Trips',
    items: [
      { key: 'driverArriving', label: 'Driver on the way', hint: 'Matched, en route, arrived' },
      { key: 'tripStarted', label: 'Trip started' },
      { key: 'tripCompleted', label: 'Trip completed', hint: 'Receipt and rating' },
    ],
  },
  {
    title: 'Messages',
    items: [
      { key: 'chatMessages', label: 'Chat messages', hint: 'From your driver' },
      { key: 'paymentConfirmations', label: 'Payments', hint: 'Top-ups, transfers, refunds' },
    ],
  },
  {
    title: 'Offers',
    items: [
      { key: 'promotions', label: 'Promotions and offers' },
      { key: 'newFeatures', label: 'New features' },
    ],
  },
  {
    title: 'Safety',
    footer: 'Safety alerts can’t be turned off.',
    items: [{ key: 'safetyAlerts', label: 'Safety alerts', locked: true }],
  },
];

/**
 * NOTIFICATIONS — each switch is enforced by the server before it pushes
 * (push.service prefAllows; chat now included). Local copy paints instantly,
 * the account's copy wins.
 */
export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [syncError, setSyncError] = useState(false);

  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {
      /* first run */
    }
    try {
      const res = await apiClient.get<{ data?: { prefs?: Partial<NotifPrefs> } }>('/user/me/notifications');
      const server = res.data?.data?.prefs;
      if (server && Object.keys(server).length > 0) {
        setPrefs((p) => {
          const merged = { ...p, ...server };
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged)).catch(() => {});
          return merged;
        });
      }
    } catch {
      setSyncError(true);
    }
  }, []);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const toggle = (key: keyof NotifPrefs, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSyncError(false);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
    apiClient.patch('/user/me/notifications', updated).catch(() => setSyncError(true));
  };

  return (
    <Screen title="Notifications" subtitle={syncError ? 'Saved on this phone — we couldn’t reach your account. It’ll sync on your next change.' : undefined}>
      {SECTIONS.map((section) => (
        <ListSection key={section.title} title={section.title} footer={section.footer}>
          {section.items.map((item) => (
            <ListRow
              key={item.key}
              title={item.label}
              subtitle={item.hint}
              right={
                <Switch
                  value={prefs[item.key]}
                  onValueChange={item.locked ? undefined : (v) => toggle(item.key, v)}
                  disabled={item.locked}
                  trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.surfaceContainerHighest}
                  accessibilityLabel={item.label}
                />
              }
            />
          ))}
        </ListSection>
      ))}
    </Screen>
  );
}
