import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';

const PRIVACY_KEYS = {
  locationSharing: 'eyego_privacy_location',
  marketingNotifs: 'eyego_privacy_marketing',
  analytics: 'eyego_privacy_analytics',
};

const PRIVACY_TEXT = `Last updated: May 2026

EyeGo ("we", "us", or "our") operates the EyeGo mobile application. This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service.

Information We Collect
We collect information you provide directly: name, phone number, email address, and profile photo. We also collect trip data (routes, bookings, payment history) and device information necessary to operate the service.

Location Data
When you use EyeGo, we collect your precise location to show nearby drivers, provide real-time tracking, and improve route recommendations. Location is only shared with your assigned driver during an active trip.

Payment Information
Payment processing is handled by Paystack. EyeGo does not store card numbers or MoMo PIN codes. We only receive confirmation of successful transactions.

Data Sharing
We do not sell your personal data. We share data only with: your assigned driver (name, pickup location), Paystack (for payment processing), and emergency services if you trigger an SOS alert.

Data Retention
Trip history is retained for 24 months. Account data is retained until you delete your account. You may request deletion at any time.

Your Rights
You have the right to access, correct, or delete your personal data. Contact support@eyego.app to exercise these rights.`;

export default function PrivacyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { logout } = useAuthStore();

  const [locationSharing, setLocationSharing] = useState(true);
  const [marketingNotifs, setMarketingNotifs] = useState(false);
  const [analytics, setAnalytics] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [loc, mkt, ana] = await Promise.all([
        AsyncStorage.getItem(PRIVACY_KEYS.locationSharing),
        AsyncStorage.getItem(PRIVACY_KEYS.marketingNotifs),
        AsyncStorage.getItem(PRIVACY_KEYS.analytics),
      ]);
      if (loc !== null) setLocationSharing(loc === 'true');
      if (mkt !== null) setMarketingNotifs(mkt === 'true');
      if (ana !== null) setAnalytics(ana === 'true');
    };
    load();
  }, []);

  const setToggle = async (key: string, value: boolean) => {
    await AsyncStorage.setItem(key, String(value));
  };

  const deleteAccountMutation = useMutation({
    mutationFn: () => (userApi as any).deleteAccount(),
    onSuccess: () => {
      logout();
    },
  });

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all trip history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: () => deleteAccountMutation.mutate(),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Privacy & Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Privacy Controls */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            PRIVACY CONTROLS
          </Text>
          <View style={styles.card}>
            <ToggleRow
              icon="location-outline"
              label="Share location with driver"
              description="Required during active trips for real-time tracking"
              value={locationSharing}
              onChange={(v) => {
                setLocationSharing(v);
                setToggle(PRIVACY_KEYS.locationSharing, v);
              }}
            />
            <View style={styles.divider} />
            <ToggleRow
              icon="megaphone-outline"
              label="Marketing notifications"
              description="Promotions, discounts, and EyeGo updates"
              value={marketingNotifs}
              onChange={(v) => {
                setMarketingNotifs(v);
                setToggle(PRIVACY_KEYS.marketingNotifs, v);
              }}
            />
            <View style={styles.divider} />
            <ToggleRow
              icon="analytics-outline"
              label="Analytics & crash reports"
              description="Helps us fix bugs and improve the app"
              value={analytics}
              onChange={(v) => {
                setAnalytics(v);
                setToggle(PRIVACY_KEYS.analytics, v);
              }}
            />
          </View>
        </MotiView>

        {/* Privacy Policy Text */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 100 }}
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            PRIVACY POLICY
          </Text>
          <View style={styles.policyCard}>
            <Text variant="caption" color={colors.onSurfaceVariant} style={styles.policyText}>
              {PRIVACY_TEXT}
            </Text>
          </View>
        </MotiView>

        {/* Terms of Service link */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 200 }}
        >
          <TouchableOpacity
            onPress={() => Linking.openURL('https://eyego.app/terms')}
            style={styles.tosLink}
            activeOpacity={0.7}
          >
            <Text variant="bodySmall" color={colors.primary}>
              View Terms of Service →
            </Text>
          </TouchableOpacity>
        </MotiView>

        {/* Delete Account */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 250 }}
          style={{ marginTop: spacing['2xl'] }}
        >
          <View style={styles.dangerCard}>
            <View style={styles.dangerHeader}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <Text variant="label" color={colors.error} style={{ marginLeft: spacing.xs }}>
                Danger Zone
              </Text>
            </View>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.dangerDesc}>
              Permanently delete your account and all associated data. This cannot be undone.
            </Text>
            <Button
              label="Delete My Account"
              variant="destructive"
              onPress={handleDeleteAccount}
              loading={deleteAccountMutation.isPending}
            />
          </View>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  value,
  onChange,
}: {
  icon: any;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={toggleStyles.row}>
      <View style={toggleStyles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.onSurfaceVariant} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" color={colors.onSurface}>{label}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 2 }}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary + '80' }}
        thumbColor={value ? colors.primary : colors.onSurfaceVariant}
        ios_backgroundColor={colors.surfaceContainerHigh}
      />
    </View>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    gap: spacing.base,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.base,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.base,
  },
  policyCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    maxHeight: 240,
    overflow: 'hidden',
  },
  policyText: {
    lineHeight: 18,
  },
  tosLink: {
    paddingVertical: spacing.base,
    alignItems: 'center',
  },
  dangerCard: {
    backgroundColor: colors.error + '10',
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.error + '30',
    gap: spacing.base,
  },
  dangerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerDesc: { lineHeight: 18 },
});
