import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, queryKeys } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';
import { getInitials } from '@eyego/utils';

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
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

  const tripsCount = (tripsTotal ?? 0).toString();

  const memberSince = useMemo(() => {
    if (user?.createdAt) {
      return new Date(user.createdAt).getFullYear().toString();
    }
    return '2026';
  }, [user]);

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

  const menuItems: MenuItem[] = [
    { label: 'Edit Profile', icon: 'person-outline', onPress: () => router.push('/profile/edit' as any) },
    { label: 'EyeGo Wallet & Pay', icon: 'wallet-outline', onPress: () => router.push('/profile/wallet' as any) },
    { label: 'Payment Methods', icon: 'card-outline', onPress: () => router.push('/profile/payment-methods' as any) },
    { label: 'Promotions & Referrals', icon: 'gift-outline', onPress: () => router.push('/profile/promotions' as any) },
    { label: 'Saved Places', icon: 'location-outline', onPress: () => router.push('/profile/saved-places' as any) },
    { label: 'Emergency Contacts', icon: 'shield-checkmark-outline', onPress: () => router.push('/profile/emergency-contacts' as any) },
    { label: 'Trip History', icon: 'time-outline', onPress: () => router.push('/(tabs)/trips') },
    { label: 'Notification Preferences', icon: 'notifications-outline', onPress: () => router.push('/profile/notification-preferences' as any) },
    { label: 'Help & Support', icon: 'help-circle-outline', onPress: () => router.push('/profile/help' as any) },
    { label: 'General Settings', icon: 'settings-outline', onPress: () => router.push('/profile/settings' as any) },
    { label: 'Privacy Policy', icon: 'shield-outline', onPress: () => router.push('/profile/privacy' as any) },
    { label: 'Terms of Service', icon: 'document-text-outline', onPress: () => router.push('/profile/terms' as any) },
    { label: 'Delete Account', icon: 'trash-outline', onPress: () => router.push('/profile/account-deletion' as any), destructive: true },
    { label: 'Log Out', icon: 'log-out-outline', onPress: handleLogout, destructive: true },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.header}
        >
          <Text variant="headlineMedium">Profile</Text>
        </MotiView>

        {/* Avatar + info card */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          style={styles.profileCard}
        >
          {/* Avatar */}
          <View style={styles.avatarWrapper}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>
                  {user?.name ? getInitials(user.name) : '?'}
                </Text>
              </View>
            )}
            <Pressable style={styles.editBadge} onPress={() => router.push('/profile/edit' as any)}>
              <Ionicons name="pencil" size={12} color={colors.onPrimary} />
            </Pressable>
          </View>

          {/* Name + phone */}
          <Text variant="titleLarge" style={{ marginTop: spacing.base }}>
            {user?.name ?? 'Set your name'}
          </Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant}>
            {user?.phone ?? ''}
          </Text>

          {/* Emergency contact chip */}
          <Pressable
            onPress={() => router.push('/profile/emergency-contacts' as any)}
            style={styles.emergencyChip}
          >
            <Ionicons name="shield-checkmark-outline" size={12} color={(user as any)?.emergencyContact?.name ? colors.primary : colors.onSurfaceVariant} />
            <Text variant="caption" color={(user as any)?.emergencyContact?.name ? colors.primary : colors.onSurfaceVariant}>
              {(user as any)?.emergencyContact?.name
                ? `SOS: ${(user as any).emergencyContact.name}`
                : 'Add emergency contact'}
            </Text>
          </Pressable>

          {/* Stats */}
          <View style={styles.statsRow}>
            <StatItem label="Trips" value={tripsCount} />
            <View style={styles.statDivider} />
            <StatItem label="Rating" value={(user as any)?.rating ? `${(user as any).rating} ★` : '4.9 ★'} />
            <View style={styles.statDivider} />
            <StatItem label="Member" value={memberSince} />
          </View>
        </MotiView>

        {/* Menu */}
        <View style={styles.menuSection}>
          {menuItems.map((item, i) => (
            <MotiView
              key={item.label}
              from={{ opacity: 0, translateX: -10 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 + i * 35 }}
            >
              <Pressable
                style={[styles.menuItem, i === menuItems.length - 1 && styles.menuItemLast]}
                onPress={item.onPress}
              >
                <View style={[styles.menuIcon, item.destructive && styles.menuIconDestructive]}>
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={item.destructive ? colors.error : colors.onSurface}
                  />
                </View>
                <Text
                  variant="bodyLarge"
                  color={item.destructive ? colors.error : colors.onSurface}
                  style={{ flex: 1 }}
                >
                  {item.label}
                </Text>
                {!item.destructive && (
                  <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
                )}
              </Pressable>
            </MotiView>
          ))}
        </View>

        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
          EyeGo v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text variant="titleMedium" color={colors.primary}>{value}</Text>
      <Text variant="caption" color={colors.onSurfaceVariant}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  scroll: { paddingBottom: spacing['3xl'] },
  header: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
  },
  profileCard: {
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.xl,
  },
  avatarWrapper: { position: 'relative', width: 80, height: 80 },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: colors.primary },
  avatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
    color: colors.onSurfaceVariant,
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    paddingTop: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    width: '100%',
  },
  statDivider: { width: 1, backgroundColor: colors.outlineVariant },
  menuSection: {
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconDestructive: { backgroundColor: 'rgba(255, 180, 171, 0.1)' },
  version: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
