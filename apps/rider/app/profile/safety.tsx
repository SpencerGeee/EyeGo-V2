import React, { useState, useEffect } from 'react';
import { Alert, Switch } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi, queryKeys, type SafetySettings } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { Screen, ListSection, ListRow, goDeeper, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useToastStore } from '../../stores/toast.store';

const CACHE_KEY = 'eyego_safety_settings';

type SafetyToggleKey = 'shareTrip' | 'rideCheck' | 'nightSafety';

/**
 * Speed alerts is gone: nothing on the server or in the app ever read it, so
 * the switch promised a feature that did not exist. Every switch left here is
 * read by something (payments.service shareTrip, ride/[id]/sos RideCheck and
 * night check-ins, the booking path for the boarding PIN).
 */
const FEATURES: { id: SafetyToggleKey; icon: 'share-social-outline' | 'pulse-outline' | 'moon-outline'; title: string; detail: string; default: boolean }[] = [
  { id: 'shareTrip', icon: 'share-social-outline', title: 'Share my trip', detail: 'Text your first trusted contact a live tracking link when a booking is confirmed', default: true },
  { id: 'rideCheck', icon: 'pulse-outline', title: 'RideCheck', detail: 'We check in if your trip stops unexpectedly for a long time', default: true },
  { id: 'nightSafety', icon: 'moon-outline', title: 'Night check-ins', detail: 'Check-ins on trips between 10pm and 5am, escalating to SOS if you don’t answer', default: false },
];

const DEFAULTS = Object.fromEntries(FEATURES.map((f) => [f.id, f.default])) as SafetySettings;

/** SAFETY (rival spec §11) — preferences, trusted contacts, emergency info. */
export default function SafetyScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const [settings, setSettings] = useState<SafetySettings>(DEFAULTS);

  // Cached copy paints instantly; the server copy wins.
  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => { if (raw) setSettings((s) => ({ ...s, ...JSON.parse(raw) })); })
      .catch(() => {});
  }, []);

  const { data: serverSettings } = useQuery({
    queryKey: queryKeys.user.safetySettings,
    queryFn: async () => (await userApi.getSafetySettings()).data?.data?.settings ?? {},
  });
  useEffect(() => {
    if (serverSettings && Object.keys(serverSettings).length > 0) setSettings((s) => ({ ...s, ...serverSettings }));
  }, [serverSettings]);

  const save = useMutation({
    mutationFn: (next: SafetySettings) => userApi.updateSafetySettings(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.user.safetySettings }),
    // The next change re-sends everything, so a failed sync heals itself.
    onError: () => useToastStore.getState().show('Couldn’t sync to your account — it’ll retry on your next change.', 'warning'),
  });

  const toggle = (id: SafetyToggleKey, value: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, [id]: value };
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
      save.mutate(next);
      return next;
    });
  };

  // Verify my ride — a real column on the user, read when a boarding code is minted.
  const { data: profile } = useQuery({
    queryKey: queryKeys.user.profile,
    queryFn: () => userApi.getProfile(),
    select: (r: any) => r.data?.data ?? r.data ?? null,
    staleTime: 60_000,
  });
  const [pinOverride, setPinOverride] = useState<boolean | null>(null);
  const requirePin = pinOverride ?? profile?.requireBoardingPin ?? false;
  const togglePin = async (next: boolean) => {
    setPinOverride(next);
    try {
      await userApi.updateProfile({ requireBoardingPin: next } as any);
      qc.invalidateQueries({ queryKey: queryKeys.user.profile });
    } catch {
      // A safety switch that silently fails to save is worse than one that says so.
      setPinOverride(!next);
      notify('Couldn’t save that', 'We couldn’t reach the server, so Verify my ride is unchanged.');
    }
  };

  const upload = useMutation({
    mutationFn: (uri: string) => userApi.uploadInsurance(uri),
    onSuccess: (insuranceCardUrl) => {
      setSettings((prev) => {
        const next = { ...prev, insuranceCardUrl };
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      qc.invalidateQueries({ queryKey: queryKeys.user.safetySettings });
      notify('Insurance card saved', 'Only shared with responders during an active emergency.', { tone: 'success' });
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'Please check your connection and try again.');
      notify(title, message);
    },
  });

  const pickInsurance = () =>
    Alert.alert(
      settings.insuranceCardUrl ? 'Replace insurance card' : 'Add insurance card',
      'Your health or travel insurance card, kept for emergency responders. It’s only shared during an active emergency.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose photo',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
            if (!result.canceled && result.assets?.[0]?.uri) upload.mutate(result.assets[0].uri);
          },
        },
      ],
    );

  const sw = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
      thumbColor="#fff"
      ios_backgroundColor={colors.surfaceContainerHighest}
      accessibilityLabel={label}
    />
  );

  return (
    <Screen title="Safety">
      <ListSection title="Safety preferences">
        <ListRow
          icon="keypad-outline"
          title="Verify my ride"
          subtitle="A 4-digit code your driver must enter before you board"
          subtitleLines={3}
          right={sw(requirePin, togglePin, 'Verify my ride')}
        />
        {FEATURES.map((f) => (
          <ListRow
            key={f.id}
            icon={f.icon}
            title={f.title}
            subtitle={f.detail}
            subtitleLines={3}
            right={sw(((settings as any)[f.id] as boolean | undefined) ?? f.default, (v) => toggle(f.id, v), f.title)}
          />
        ))}
      </ListSection>

      <ListSection title="Trusted contacts">
        <ListRow icon="people-outline" title="Emergency contacts" subtitle="Who we alert in an emergency" onPress={() => goDeeper('/profile/emergency-contacts')} />
      </ListSection>

      <ListSection title="Emergency info">
        <ListRow
          icon="medkit-outline"
          title="Insurance card"
          subtitle={upload.isPending ? 'Uploading…' : 'For emergency responders only'}
          value={settings.insuranceCardUrl ? 'On file' : 'Add'}
          valueColor={settings.insuranceCardUrl ? colors.statusSuccess : colors.primary}
          onPress={upload.isPending ? undefined : pickInsurance}
        />
      </ListSection>

      <ListSection>
        <ListRow icon="help-buoy-outline" title="Report a safety issue" onPress={() => goDeeper('/profile/help')} />
      </ListSection>
    </Screen>
  );
}
