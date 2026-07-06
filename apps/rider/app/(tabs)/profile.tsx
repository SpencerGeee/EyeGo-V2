import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, walletApi, queryKeys } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii, withOpacity, springs } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';
import { getInitials, formatCurrency } from '@eyego/utils';
import { TAB_BAR_BASE_HEIGHT } from './_layout';

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: 'primary' | 'success' | 'error';
  destructive?: boolean;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

export default function ProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const { data: tripsTotal } = useQuery({
    queryKey: ['bookings', 'completed', 'count'],
    queryFn: () => bookingsApi.getHistory({ status: 'COMPLETED', limit: 1 }),
    select: (r) => (r.data as any)?.data?.total ?? (r.data as any)?.total ?? 0,
  });

  const { data: walletBalance } = useQuery({
    queryKey: queryKeys.wallet.balance(),
    queryFn: () => walletApi.getBalance(),
    select: (r: any) => r.data?.data?.balance ?? r.data?.balance ?? 0,
    staleTime: 30_000,
  });

  const tripsCount = (tripsTotal ?? 0).toString();
  const rating = (user as any)?.rating ? `${(user as any).rating}` : '4.9';

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

  type RiderRoute = Parameters<typeof router.push>[0];

  const menuSections: MenuSection[] = [
    {
      title: 'Account',
      items: [
        { label: 'Edit Profile', icon: 'person-outline', onPress: () => router.push('/profile/edit' as RiderRoute) },
        { label: 'Payment Methods', icon: 'card-outline', onPress: () => router.push('/profile/payment-methods' as RiderRoute) },
        { label: 'Saved Places', icon: 'bookmark-outline', onPress: () => router.push('/profile/saved-places' as RiderRoute) },
        { label: 'Trip History', icon: 'time-outline', onPress: () => router.push('/(tabs)/activity' as any) },
      ],
    },
    {
      title: 'Safety',
      items: [
        { label: 'Safety Center', icon: 'shield-checkmark-outline', accent: 'success', onPress: () => router.push('/profile/safety' as RiderRoute) },
        { label: 'Emergency Contacts', icon: 'alert-circle-outline', accent: 'error', onPress: () => router.push('/profile/emergency-contacts' as RiderRoute) },
        { label: 'Notification Preferences', icon: 'notifications-outline', onPress: () => router.push('/profile/notification-preferences' as RiderRoute) },
      ],
    },
    {
      title: 'General',
      items: [
        { label: 'Promotions & Referrals', icon: 'pricetag-outline', onPress: () => router.push('/profile/promotions' as RiderRoute) },
        { label: 'Help & Support', icon: 'help-circle-outline', onPress: () => router.push('/profile/help' as RiderRoute) },
        { label: 'Settings', icon: 'settings-outline', onPress: () => router.push('/profile/settings' as RiderRoute) },
        { label: 'Privacy Policy', icon: 'lock-closed-outline', onPress: () => router.push('/profile/privacy' as RiderRoute) },
        { label: 'Terms of Service', icon: 'document-text-outline', onPress: () => router.push('/profile/terms' as RiderRoute) },
        { label: 'Delete Account', icon: 'trash-outline', accent: 'error', onPress: () => router.push('/profile/account-deletion' as RiderRoute) },
      ],
    },
  ];

  const accentColor = (accent?: MenuItem['accent']) =>
    accent === 'success' ? (colors.statusSuccess ?? colors.primary)
    : accent === 'error' ? colors.statusError
    : colors.outline;

  let rowDelayOffset = 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header row ── */}
        <MotiView
          from={{ opacity: 0, translateY: -8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.snappy }}
          style={styles.headerRow}
        >
          <View style={styles.headerLeft}>
            <View style={styles.avatarRing}>
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={[styles.avatarInitials, { color: colors.primary }]}>
                    {user?.name ? getInitials(user.name) : '?'}
                  </Text>
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall" numberOfLines={1} style={{ color: colors.onSurface }}>
                {user?.name ?? 'Set your name'}
              </Text>
              <View style={styles.chipsRow}>
                <View style={styles.memberChip}>
                  <Text style={styles.memberChipText}>Member</Text>
                </View>
                <View style={styles.ratingChip}>
                  <Ionicons name="star" size={11} color={colors.tierPremium} />
                  <Text style={styles.ratingChipText}>{rating}</Text>
                </View>
              </View>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/profile/edit' as any)}
            style={styles.editBtn}
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
            hitSlop={8}
          >
            <Ionicons name="pencil" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        </MotiView>

        {/* ── Wallet card ── */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.snappy, delay: 40 }}
          style={styles.walletCard}
        >
          <View style={styles.walletGlow} pointerEvents="none" />
          <View style={styles.walletGlowSecondary} pointerEvents="none" />
          <View style={styles.walletRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.walletLabelRow}>
                <Ionicons name="wallet-outline" size={16} color={colors.onSurfaceVariant} />
                <Text style={styles.walletLabel}>EYEGO WALLET</Text>
              </View>
              <Text style={styles.walletBalance}>{formatCurrency(walletBalance ?? 0)}</Text>
            </View>
            <Pressable
              onPress={() => router.push('/profile/wallet' as any)}
              style={({ pressed }) => [styles.topUpBtn, pressed && { transform: [{ scale: 0.96 }] }]}
            >
              <Text style={styles.topUpText}>Top Up</Text>
            </Pressable>
          </View>
        </MotiView>

        {/* ── Menu sections ── */}
        {menuSections.map((section) => {
          const sectionDelay = 40;
          rowDelayOffset += section.items.length + 1;
          return (
            <MotiView
              key={section.title}
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', ...springs.snappy, delay: sectionDelay }}
              style={styles.sectionWrapper}
            >
              <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
              <View style={styles.sectionCard}>
                {section.items.map((item, itemIdx) => (
                  <Pressable
                    key={item.label}
                    style={[
                      styles.menuItem,
                      itemIdx === section.items.length - 1 && styles.menuItemLast,
                    ]}
                    onPress={item.onPress}
                    accessibilityRole="button"
                  >
                    <Ionicons name={item.icon} size={20} color={accentColor(item.accent)} />
                    <Text
                      variant="bodyLarge"
                      style={{ flex: 1, color: item.accent === 'error' ? colors.statusError : colors.onSurface }}
                    >
                      {item.label}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.outline} />
                  </Pressable>
                ))}
              </View>
            </MotiView>
          );
        })}

        {/* ── Log out ── */}
        <Pressable onPress={handleLogout} style={styles.logoutBtn} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={20} color={colors.statusError} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>

        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
          EyeGo v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base, paddingBottom: TAB_BAR_BASE_HEIGHT + 64 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: `${colors.primary}80`,
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  avatar: { width: '100%', height: '100%' },
  avatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHigh,
  },
  avatarInitials: { fontFamily: fonts.displayBold, fontSize: fontSizes.titleMedium, lineHeight: fontSizes.titleMedium * 1.3 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  memberChip: {
    backgroundColor: colors.surfaceContainerHigh ?? colors.surfaceContainer,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  memberChipText: {
    fontFamily: fonts.labelCaps,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: `${colors.tierPremium}1F`,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  ratingChipText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 14, color: colors.tierPremium },
  editBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },

  walletCard: {
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  walletGlow: {
    position: 'absolute',
    right: -48,
    top: -48,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: `${colors.primary}33`,
  },
  walletGlowSecondary: {
    position: 'absolute',
    left: -48,
    bottom: -48,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: withOpacity(colors.tierRoyal, 0.1),
  },
  walletRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  walletLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  walletLabel: {
    fontFamily: fonts.labelCaps,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
  },
  walletBalance: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    lineHeight: 36,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  topUpBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  topUpText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodySmall,
    lineHeight: fontSizes.bodySmall * 1.35,
    letterSpacing: 0.4,
    color: colors.onPrimary,
  },

  sectionWrapper: { marginBottom: spacing.lg },
  sectionHeader: {
    fontFamily: fonts.labelCaps,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.outline,
    marginBottom: spacing.sm,
    marginLeft: spacing.base,
  },
  sectionCard: {
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  menuItemLast: { borderBottomWidth: 0 },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.base + 2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: `${colors.statusError}4D`,
    marginTop: spacing.xs,
  },
  logoutText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.statusError,
  },
  version: { textAlign: 'center', marginTop: spacing.lg },
});
