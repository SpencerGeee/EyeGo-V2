import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import {
  Text,
  Avatar,
  Skeleton,
  Entrance,
  GlassSurface,
  GradientGlowBorder,
  AppBackground,
} from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

interface SettingsItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  action: () => void;
  destructive?: boolean;
  rightElement?: React.ReactNode;
}

export default function ProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { driver, logout } = useDriverStore();

  // Fetch fresh profile data from the API on mount
  const { data: meData, isLoading: profileLoading, isError: profileError, refetch: refetchProfile } = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const data = (r.data as any).data;
      // Backend wraps driver data in { driver: ... } — unwrap it
      return data?.driver ?? data;
    },
    staleTime: 0,
    refetchOnMount: true,
  });

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/phone');
        },
      },
    ]);
  };

  const settingsItems: SettingsItem[] = [
    {
      icon: 'person-outline',
      label: 'Edit Profile',
      action: () => router.push('/(profile)/edit'),
    },
    {
      icon: 'car-outline',
      label: 'My Vehicle',
      action: () => router.push('/(profile)/vehicle'),
    },
    {
      icon: 'star-outline',
      label: 'My Ratings',
      action: () => router.push('/(profile)/ratings'),
    },
    {
      icon: 'document-text-outline',
      label: 'Documents',
      action: () => router.push('/(profile)/documents'),
    },
    {
      icon: 'shield-outline',
      label: 'Safety',
      action: () => router.push('/(profile)/safety'),
    },
    {
      icon: 'stats-chart-outline',
      label: 'Performance',
      action: () => router.push('/(profile)/performance'),
    },
    {
      icon: 'help-circle-outline',
      label: 'Help & Support',
      action: () => router.push('/(profile)/help'),
    },
    {
      icon: 'cash-outline',
      label: 'Payout Account',
      action: () => router.push('/(profile)/payout-account'),
    },
    {
      icon: 'settings-outline',
      label: 'Settings & Privacy',
      action: () => router.push('/(profile)/settings'),
    },
    {
      icon: 'document-text-outline',
      label: 'Driver Agreement',
      action: () => router.push('/(profile)/terms'),
    },
    {
      icon: 'shield-outline',
      label: 'Privacy Policy',
      action: () => router.push('/(profile)/privacy'),
    },
    {
      icon: 'trash-outline',
      label: 'Delete Account',
      action: () => router.push('/(profile)/account-deletion'),
      destructive: true,
    },
    {
      icon: 'log-out-outline',
      label: 'Log out',
      action: handleLogout,
      destructive: true,
    },
  ];

  const totalTrips = meData?.totalTrips ?? driver?.totalTrips ?? 0;
  const totalEarned = meData?.totalEarned ?? driver?.totalEarned ?? 0;
  // null = no ratings yet; show "New" rather than a fake 5.0
  const rating: number | null = meData?.rating ?? (driver as any)?.rating ?? null;
  const ratingCount: number = meData?.ratingCount ?? 0;
  // Always prefer fresh API name; store may have stale "Driver" placeholder
  const displayName = meData?.name ?? driver?.name ?? 'Driver';

  if (profileLoading && !driver) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppBackground variant="static" />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Skeleton header */}
          <View style={{ paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing.md }}>
            <Skeleton width={120} height={24} borderRadius={radii.full} />
          </View>
          {/* Skeleton profile card */}
          <View style={{ marginHorizontal: spacing['2xl'], flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg }}>
            <Skeleton width={72} height={72} borderRadius={36} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="60%" height={18} borderRadius={radii.full} />
              <Skeleton width="40%" height={14} borderRadius={radii.full} />
              <Skeleton width="50%" height={12} borderRadius={radii.full} />
            </View>
          </View>
          {/* Skeleton stats row */}
          <Skeleton height={72} borderRadius={radii.xl} style={{ marginHorizontal: spacing['2xl'], marginBottom: spacing.lg }} />
          {/* Skeleton settings list */}
          <View style={{ marginHorizontal: spacing['2xl'], gap: spacing.xs }}>
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} height={60} borderRadius={radii.xl} />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // D10: show error state with retry if profile fetch failed and no cached driver
  if (profileError && !driver && !meData) {
    return (
      <SafeAreaView style={styles.safe}>
        <AppBackground variant="static" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 16 }}>
          <Text variant="bodyMedium" color={colors.error}>Failed to load profile.</Text>
          <Pressable
            onPress={() => refetchProfile()}
            style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 }}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.semiBold }}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Entrance animation="slideUp" delay={50} style={styles.header}>
          <Text variant="headlineMedium" style={styles.title}>Profile</Text>
        </Entrance>

        {/* Avatar + info card — hero element gets the premium ring */}
        <Entrance animation="slideDown" delay={100} style={styles.profileCardWrapper}>
        <GradientGlowBorder
          palette="driver"
          fillColor={colors.surfaceContainerHigh}
          borderRadius={radii['2xl']}
          glow
          style={styles.profileCard}
        >
          <GlassSurface borderRadius={radii['2xl'] - 3} intensity="high" dark style={StyleSheet.absoluteFill} />
          <View style={styles.profileCardGlow} pointerEvents="none" />
          <View style={styles.avatarRing}>
            <Avatar
              size={72}
              name={displayName}
              uri={meData?.avatarUrl ?? driver?.avatarUrl}
            />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.driverName}>{displayName}</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
              {meData?.phone ?? driver?.phone ?? ''}
            </Text>
            <View style={styles.ratingRow}>
              {rating == null ? (
                <Text variant="caption" color={colors.onSurfaceVariant}>No ratings yet</Text>
              ) : (
                <>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Ionicons
                      key={s}
                      name={s <= Math.round(rating) ? 'star' : 'star-outline'}
                      size={14}
                      color="#F59E0B"
                    />
                  ))}
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginLeft: 4 }}>
                    {rating.toFixed(1)} ({ratingCount})
                  </Text>
                </>
              )}
            </View>
          </View>
        </GradientGlowBorder>
        </Entrance>

        {/* Stats row */}
        <Entrance animation="slideDown" delay={150} style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalTrips}</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Total Trips</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>GHS {totalEarned.toFixed(0)}</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Total Earned</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {(meData?.createdAt ?? driver?.createdAt)
                ? new Date(meData?.createdAt ?? driver!.createdAt).toLocaleDateString('en-GH', { month: 'short', year: 'numeric' })
                : 'Calculating...'}
            </Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>Member Since</Text>
          </View>
        </Entrance>

        {/* Driver badge */}
        <Entrance animation="fadeIn" delay={200} style={styles.badgeRow}>
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
            <Text style={styles.badgeText}>Verified Driver</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: `${colors.online}18`, borderColor: `${colors.online}44` }]}>
            <View style={[styles.onlineDot, { backgroundColor: driver?.isActive ? colors.online : colors.offline }]} />
            <Text style={[styles.badgeText, { color: driver?.isActive ? colors.online : colors.onSurfaceVariant }]}>
              {driver?.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </Entrance>

        {/* Settings */}
        <Entrance animation="slideDown" delay={220} style={styles.settingsCard}>
          {settingsItems.map((item, i) => (
            <Pressable
              key={item.label}
              style={[styles.settingsRow, i < settingsItems.length - 1 && styles.settingsBorder]}
              onPress={item.action}
            >
              <View style={[
                styles.settingsIcon,
                { backgroundColor: item.destructive ? `${colors.error}18` : `${colors.primary}18` },
              ]}>
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={item.destructive ? colors.error : colors.primary}
                />
              </View>
              <Text
                style={[
                  styles.settingsLabel,
                  item.destructive && { color: colors.error },
                ]}
              >
                {item.label}
              </Text>
              {item.rightElement ?? (
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
              )}
            </Pressable>
          ))}
        </Entrance>

        {/* Version */}
        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
          EyeGo Driver v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    scroll: { paddingBottom: 120 },
    header: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
    },
    title: { fontFamily: fonts.displayBold, letterSpacing: -0.5 },
    profileCardWrapper: {
      marginHorizontal: spacing['2xl'],
      marginBottom: spacing.lg,
    },
    profileCard: {
      padding: spacing['2xl'],
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    profileCardGlow: {
      position: 'absolute',
      width: 180,
      height: 180,
      borderRadius: 90,
      backgroundColor: colors.primary,
      opacity: 0.06,
      top: -50,
      right: -30,
    },
    avatarRing: {
      padding: 3,
      borderRadius: 999,
      borderWidth: 2,
      borderColor: colors.primary,
    },
    profileInfo: { flex: 1, gap: 4 },
    driverName: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.3),
      color: colors.onSurface,
    },
    ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    statsRow: {
      marginHorizontal: spacing['2xl'],
      flexDirection: 'row',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
      marginBottom: spacing.lg,
    },
    statItem: { flex: 1, alignItems: 'center', gap: 4 },
    statDivider: { width: 1, backgroundColor: colors.outline, marginVertical: 4 },
    statValue: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
    },
    badgeRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing['2xl'],
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: `${colors.primary}18`,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    badgeText: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: 14,
      color: colors.primary,
    },
    onlineDot: { width: 7, height: 7, borderRadius: 4 },
    settingsCard: {
      marginHorizontal: spacing['2xl'],
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      overflow: 'hidden',
      marginBottom: spacing.xl,
    },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.base,
      gap: spacing.md,
    },
    settingsBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    settingsIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingsLabel: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
      color: colors.onSurface,
    },
    version: { textAlign: 'center', marginBottom: spacing.lg },
  });
