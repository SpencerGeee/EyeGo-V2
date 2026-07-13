import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi, queryKeys, type SafetySettings } from '@eyego/api';
import { spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';

const CACHE_KEY = 'eyego_safety_settings';

const SAFETY_FEATURES: {
  id: keyof SafetySettings;
  icon: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
}[] = [
  {
    id: 'shareTrip',
    icon: 'share-social-outline',
    title: 'Share Trip Status',
    description: 'Auto-share your trip status with emergency contacts',
    defaultEnabled: true,
  },
  {
    id: 'rideCheck',
    icon: 'shield-checkmark-outline',
    title: 'RideCheck',
    description: 'Get alerted if your trip deviates unexpectedly or stops for too long',
    defaultEnabled: true,
  },
  {
    id: 'speedAlerts',
    icon: 'speedometer-outline',
    title: 'Speed Alerts',
    description: 'Notify you if your driver exceeds the speed limit',
    defaultEnabled: false,
  },
  {
    id: 'nightSafety',
    icon: 'moon-outline',
    title: 'Night Safety Check',
    description: 'Periodic check-ins on trips between 10pm - 5am, with automatic SOS escalation if you don\'t respond',
    defaultEnabled: false,
  },
];

// Both features are now live: Speed Alerts reads the driver's real-time GPS
// speed from the socket location stream (tracking.tsx); Night Safety Check
// runs a periodic check-in prompt during night trips that escalates through
// the existing emergencyAlert/SOS flow if unanswered.
const UNIMPLEMENTED_FEATURE_IDS: Array<keyof SafetySettings> = [];

const DEFAULTS = Object.fromEntries(
  SAFETY_FEATURES.map((f) => [f.id, f.defaultEnabled])
) as SafetySettings;

export default function SafetyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<SafetySettings>(DEFAULTS);

  // Offline-first hydrate: cached copy renders instantly, server copy wins.
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
    if (serverSettings && Object.keys(serverSettings).length > 0) {
      setSettings((s) => ({ ...s, ...serverSettings }));
    }
  }, [serverSettings]);

  const saveMutation = useMutation({
    mutationFn: (next: SafetySettings) => userApi.updateSafetySettings(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.safetySettings }),
  });

  const toggleFeature = (id: keyof SafetySettings) => {
    if (UNIMPLEMENTED_FEATURE_IDS.includes(id)) {
      Alert.alert('Coming Soon', 'This safety feature is not available yet — we\'ll notify you when it launches.');
      return;
    }
    setSettings((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
      saveMutation.mutate(next);
      return next;
    });
  };

  const isEnabled = (id: keyof SafetySettings) => settings[id] ?? false;

  const handleUploadInsurance = () => {
    Alert.alert(
      'Upload Insurance',
      'You can upload your travel or health insurance card so it is accessible in case of an emergency during your trip. This information is encrypted and only shared with emergency responders.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upload', onPress: () => Alert.alert('Coming Soon', 'Insurance upload will be available in the next update.') },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} accessibilityLabel="Safety settings">
      {/* Header */}
      <View
        style={styles.header}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="headlineMedium" style={{ flex: 1 }}>Safety</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Shield icon header */}
        <View
          style={styles.shieldSection}
        >
          <View style={styles.shieldCircle}>
            <Ionicons name="shield-checkmark" size={40} color={colors.primary} />
          </View>
          <Text variant="titleSmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            Your safety is our priority. Customize your safety preferences below.
          </Text>
        </View>

        {/* Safety features */}
        <View
          style={styles.card}
        >
          <Text variant="titleSmall" style={styles.cardTitle}>Safety Features</Text>
          <View style={styles.featuresList}>
            {SAFETY_FEATURES.map((feature, i) => (
              <View
                key={feature.id}
                >
                <Pressable
                  style={styles.featureRow}
                  onPress={() => toggleFeature(feature.id)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isEnabled(feature.id) }}
                  accessibilityLabel={`${feature.title}. ${feature.description}. ${isEnabled(feature.id) ? 'Enabled' : 'Disabled'}`}
                >
                  <View style={[styles.featureIcon, { backgroundColor: withOpacity(colors.primary, 0.1) }]}>
                    <Ionicons name={feature.icon as any} size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">{feature.title}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      {feature.description}
                    </Text>
                  </View>
                  <Switch
                    value={isEnabled(feature.id)}
                    onValueChange={() => toggleFeature(feature.id)}
                    trackColor={{ false: colors.outlineVariant, true: withOpacity(colors.primary, 0.4) }}
                    thumbColor={isEnabled(feature.id) ? colors.primary : colors.onSurfaceVariant}
                  />
                </Pressable>
                {i < SAFETY_FEATURES.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        </View>

        {/* Insurance card */}
        <View
          style={styles.card}
        >
          <Text variant="titleSmall" style={styles.cardTitle}>Emergency Insurance</Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.md, lineHeight: 20 }}>
            Upload your health or travel insurance card so it can be accessed by emergency responders if needed.
            Your data is encrypted and only shared during an active emergency.
          </Text>
          <Pressable
            style={styles.uploadButton}
            onPress={handleUploadInsurance}
            accessibilityRole="button"
            accessibilityLabel="Upload insurance card"
          >
            <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
            <Text variant="label" color={colors.primary}>Upload Insurance Card</Text>
          </Pressable>
        </View>

        {/* Emergency contacts shortcut */}
        <View
          >
          <Pressable
            style={styles.linkRow}
            onPress={() => router.push('/profile/emergency-contacts' as any)}
            accessibilityRole="button"
            accessibilityLabel="Manage emergency contacts"
          >
            <View style={[styles.linkIcon, { backgroundColor: withOpacity(colors.error, 0.1) }]}>
              <Ionicons name="people-outline" size={20} color={colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">Emergency Contacts</Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Add or edit who to contact in an emergency
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* Trust & support */}
        <View
          >
          <Pressable
            style={styles.linkRow}
            onPress={() => router.push('/profile/help' as any)}
            accessibilityRole="button"
            accessibilityLabel="Safety help center"
          >
            <View style={[styles.linkIcon, { backgroundColor: withOpacity(colors.secondary, 0.1) }]}>
              <Ionicons name="help-buoy-outline" size={20} color={colors.secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">Safety Help Center</Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>
                Learn about our safety features and guidelines
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
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
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      gap: spacing.md,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['3xl'],
      gap: spacing.xl,
    },
    shieldSection: {
      alignItems: 'center',
      gap: spacing.md,
      paddingTop: spacing.lg,
    },
    shieldCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: withOpacity(colors.primary, 0.08),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: withOpacity(colors.primary, 0.2),
    },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    cardTitle: {
      marginBottom: spacing.md,
    },
    featuresList: {
      gap: spacing.xs,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.base,
    },
    featureIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    divider: {
      height: 1,
      backgroundColor: colors.rimLightSubtle,
    },
    uploadButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: withOpacity(colors.primary, 0.08),
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: withOpacity(colors.primary, 0.2),
      borderStyle: 'dashed',
      paddingVertical: spacing.base,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      padding: spacing.base,
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    linkIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
