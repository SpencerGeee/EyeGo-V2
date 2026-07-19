import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi, queryKeys, type PrivacySettings } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { useToastStore } from '../../stores/toast.store';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';

const PRIVACY_KEYS = {
  locationSharing: 'eyego_privacy_location',
  marketingNotifs: 'eyego_privacy_marketing',
  analytics: 'eyego_privacy_analytics',
};

const PRIVACY_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Who We Are',
    body: 'EyeGo ("we", "us", or "our") operates the EyeGo ride-hailing platform in Ghana, connecting riders with shared vans and drivers across Accra. This policy explains what personal data we collect, why we collect it, how we protect it, and the rights you have over it. It applies to the EyeGo rider app, driver app, and related services. By using EyeGo you agree to the practices described here.',
  },
  {
    heading: 'Legal Basis',
    body: 'We process your personal data in accordance with the Data Protection Act, 2012 (Act 843) of Ghana and, where applicable, other data protection laws. Processing is based on: performance of our contract with you (providing rides), your consent (marketing, analytics), our legitimate interests (fraud prevention, service improvement), and legal obligations (tax, safety and law-enforcement requirements).',
  },
  {
    heading: 'Information We Collect',
    body: 'Account data: name, phone number, email address, date of birth, and profile photo you provide during signup. Trip data: pickup and drop-off locations, routes, timestamps, seat bookings, fare amounts, and payment history. Device data: device model, operating system, app version, push notification token, and crash logs. Communications: support tickets, in-ride chat messages, and ratings you submit.',
  },
  {
    heading: 'Location Data',
    body: 'We collect your precise GPS location while the app is in use to show nearby trips, match you with drivers, provide live trip tracking, and power safety features such as RideCheck and trip sharing. Your live location is shared with your assigned driver only during an active trip, and with your emergency contacts only if you enable Share Trip Status or trigger SOS. You can disable location access in your device settings, but core ride features will not work without it.',
  },
  {
    heading: 'Payment Information',
    body: 'Payments are processed by Paystack, a PCI-DSS Level 1 certified payment processor. EyeGo never stores your full card number, CVV, or mobile money PIN. We retain only transaction references, amounts, and confirmation status needed for receipts, refunds, and dispute resolution.',
  },
  {
    heading: 'How We Use Your Data',
    body: 'We use your data to: operate and improve the ride service; calculate fares and process payments; provide live tracking and safety features; send trip notifications; prevent fraud and enforce our terms; respond to support requests and disputes; and, with your consent, send promotions and service updates.',
  },
  {
    heading: 'Data Sharing',
    body: 'We do not sell your personal data. We share limited data only with: your assigned driver (first name, pickup point, seat count); other members of a group booking you join (name and seat status); Paystack (payment processing); emergency services and your emergency contacts (if you trigger SOS or enable trip sharing); analytics and crash-reporting providers (aggregated or pseudonymised data, if you allow analytics); and authorities where required by law.',
  },
  {
    heading: 'Data Security',
    body: 'All traffic between the app and our servers is encrypted with TLS. Access to production data is restricted to authorised personnel and logged. Payment credentials never touch our servers. While no system is perfectly secure, we review our safeguards regularly and will notify you and the Data Protection Commission of any breach as required by Act 843.',
  },
  {
    heading: 'Data Retention',
    body: 'Trip history is retained for 24 months for receipts, disputes, and safety investigations, then anonymised. Support tickets are retained for 12 months after closure. Account data is retained while your account is active and deleted within 30 days of a verified account deletion request, except where a longer period is required by law (e.g. financial records).',
  },
  {
    heading: 'Your Rights',
    body: 'Under Act 843 you have the right to: access a copy of the personal data we hold about you; correct inaccurate data; delete your account and associated data; object to or restrict certain processing; and withdraw consent for marketing or analytics at any time using the controls above. To exercise any of these rights, contact privacy@eyego.app or use the Delete My Account button below. We respond to verified requests within 30 days.',
  },
  {
    heading: 'Children',
    body: 'EyeGo is not directed at children under 16. We do not knowingly collect data from children. Riders aged 16–17 may use the service only under a parent or guardian’s supervision and account consent.',
  },
  {
    heading: 'Changes & Contact',
    body: 'We may update this policy as the service evolves; material changes will be announced in the app before they take effect. Questions or complaints: privacy@eyego.app, or write to the Data Protection Commission of Ghana if you believe your rights have been infringed.\n\nLast updated: July 2026',
  },
];

export default function PrivacyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { logout } = useAuthStore();

  const queryClient = useQueryClient();
  const [locationSharing, setLocationSharing] = useState(true);
  const [marketingNotifs, setMarketingNotifs] = useState(false);
  const [analytics, setAnalytics] = useState(true);

  // Local cache renders instantly; server copy (source of truth) overrides.
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

  const { data: serverSettings } = useQuery({
    queryKey: queryKeys.user.privacySettings,
    queryFn: async () => (await userApi.getPrivacySettings()).data?.data?.settings ?? {},
  });

  useEffect(() => {
    if (!serverSettings) return;
    if (serverSettings.locationSharing !== undefined) setLocationSharing(serverSettings.locationSharing);
    if (serverSettings.marketingNotifs !== undefined) setMarketingNotifs(serverSettings.marketingNotifs);
    if (serverSettings.analytics !== undefined) setAnalytics(serverSettings.analytics);
  }, [serverSettings]);

  const saveMutation = useMutation({
    mutationFn: (patch: PrivacySettings) => userApi.updatePrivacySettings(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.privacySettings }),
    onError: () => {
      useToastStore.getState().show("Couldn't sync to your account — will retry on your next change.", 'warning');
    },
  });

  const setToggle = async (key: string, field: keyof PrivacySettings, value: boolean) => {
    AsyncStorage.setItem(key, String(value)).catch(() => {});
    saveMutation.mutate({ [field]: value });
  };

  const deleteAccountMutation = useMutation({
    mutationFn: () => userApi.deleteAccount(),
    onSuccess: () => {
      logout();
    },
    // Deleting an account is the one flow that must never fail silently —
    // previously a failed request left the rider believing they were deleted.
    onError: (err: any) => {
      Alert.alert(
        'Deletion Failed',
        err?.response?.data?.message ?? err?.message ?? 'Please check your connection and try again.'
      );
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
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall">Privacy & Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Privacy Controls */}
        <View
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
                setToggle(PRIVACY_KEYS.locationSharing, 'locationSharing', v);
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
                setToggle(PRIVACY_KEYS.marketingNotifs, 'marketingNotifs', v);
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
                setToggle(PRIVACY_KEYS.analytics, 'analytics', v);
              }}
            />
          </View>
        </View>

        {/* Privacy Policy Text */}
        <View
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            PRIVACY POLICY
          </Text>
          <View style={styles.policyCard}>
            {PRIVACY_SECTIONS.map((section, i) => (
              <View key={section.heading} style={i > 0 ? { marginTop: spacing.base } : undefined}>
                <Text variant="bodyMedium" color={colors.onSurface} style={{ fontFamily: fonts.semiBold, marginBottom: 4 }}>
                  {section.heading}
                </Text>
                <Text variant="caption" color={colors.onSurfaceVariant} style={styles.policyText}>
                  {section.body}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Terms of Service link */}
        <View
          >
          <Pressable
            onPress={() => router.push('/profile/terms' as any)}
            style={styles.tosLink}
          >
            <Text variant="bodySmall" color={colors.primary}>
              View Terms of Service →
            </Text>
          </Pressable>
        </View>

        {/* Delete Account */}
        <View
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
        </View>
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
  safe: { flex: 1, backgroundColor: 'transparent' },
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
