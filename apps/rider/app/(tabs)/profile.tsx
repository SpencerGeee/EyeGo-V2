import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Image, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi } from '@eyego/api';
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

  type RiderRoute = Parameters<typeof router.push>[0];

  const menuSections: MenuSection[] = [
    {
      title: 'Account',
      items: [
        { label: 'Edit Profile', icon: 'person-outline', onPress: () => router.push('/profile/edit' as RiderRoute) },
        { label: 'EyeGo Wallet & Pay', icon: 'wallet-outline', onPress: () => router.push('/profile/wallet' as RiderRoute) },
        { label: 'Payment Methods', icon: 'card-outline', onPress: () => router.push('/profile/payment-methods' as RiderRoute) },
        { label: 'Promotions & Referrals', icon: 'gift-outline', onPress: () => router.push('/profile/promotions' as RiderRoute) },
        { label: 'Saved Places', icon: 'location-outline', onPress: () => router.push('/profile/saved-places' as RiderRoute) },
        { label: 'Trip History', icon: 'time-outline', onPress: () => router.push('/(tabs)/trips') },
      ],
    },
    {
      title: 'Safety',
      items: [
        { label: 'Emergency Contacts', icon: 'shield-checkmark-outline', onPress: () => router.push('/profile/emergency-contacts' as RiderRoute) },
        { label: 'Notification Preferences', icon: 'notifications-outline', onPress: () => router.push('/profile/notification-preferences' as RiderRoute) },
      ],
    },
    {
      title: 'App',
      items: [
        { label: 'Help & Support', icon: 'help-circle-outline', onPress: () => router.push('/profile/help' as RiderRoute) },
        { label: 'General Settings', icon: 'settings-outline', onPress: () => router.push('/profile/settings' as RiderRoute) },
        { label: 'Privacy Policy', icon: 'shield-outline', onPress: () => router.push('/profile/privacy' as RiderRoute) },
        { label: 'Terms of Service', icon: 'document-text-outline', onPress: () => router.push('/profile/terms' as RiderRoute) },
      ],
    },
    {
      title: 'Danger Zone',
      items: [
        { label: 'Delete Account', icon: 'trash-outline', onPress: () => router.push('/profile/account-deletion' as RiderRoute), destructive: true },
        { label: 'Log Out', icon: 'log-out-outline', onPress: handleLogout, destructive: true },
      ],
    },
  ];

  // Row delay offset per section
  let rowDelayOffset = 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Hero card ── */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          style={styles.heroWrapper}
        >
          <LinearGradient
            colors={[colors.primary + '28', colors.surfaceContainer]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.heroGradient}
          >
            {/* Avatar with glow ring */}
            <View style={styles.avatarWrapper}>
              <View style={[styles.avatarGlow, { shadowColor: colors.primary, borderColor: colors.primary + '55' }]}>
                {user?.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatarFallback, { backgroundColor: colors.surfaceContainerHigh }]}>
                    <Text style={[styles.avatarInitials, { color: colors.primary }]}>
                      {user?.name ? getInitials(user.name) : '?'}
                    </Text>
                  </View>
                )}
              </View>
              <Pressable
                style={[styles.editBadge, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/profile/edit' as any)}
                accessibilityLabel="Edit profile"
                accessibilityRole="button"
              >
                <Ionicons name="pencil" size={12} color={colors.onPrimary} />
              </Pressable>
            </View>

            {/* Name + phone */}
            <Text variant="titleLarge" style={{ marginTop: spacing.base, textAlign: 'center' }}>
              {user?.name ?? 'Set your name'}
            </Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.base }}>
              {user?.phone ?? ''}
            </Text>

            {/* Stats pills */}
            <View style={styles.statsRow}>
              <BlurView intensity={50} tint="dark" style={styles.statPill}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{tripsCount}</Text>
                <Text style={styles.statLabel}>Trips</Text>
              </BlurView>
              <BlurView intensity={50} tint="dark" style={styles.statPill}>
                <Text style={[styles.statValue, { color: colors.primary }]}>
                  {(user as any)?.rating ? `${(user as any).rating}★` : '4.9★'}
                </Text>
                <Text style={styles.statLabel}>Rating</Text>
              </BlurView>
              <BlurView intensity={50} tint="dark" style={styles.statPill}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{memberSince}</Text>
                <Text style={styles.statLabel}>Since</Text>
              </BlurView>
            </View>
          </LinearGradient>
        </MotiView>

        {/* ── Menu sections ── */}
        {menuSections.map((section, sectionIdx) => {
          const sectionDelay = 80 + rowDelayOffset * 35;
          rowDelayOffset += section.items.length + 1;
          return (
            <MotiView
              key={section.title}
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34, delay: sectionDelay }}
              style={styles.sectionWrapper}
            >
              <Text style={[styles.sectionHeader, { color: colors.onSurfaceVariant }]}>
                {section.title.toUpperCase()}
              </Text>
              <View style={[styles.sectionCard, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}>
                {section.items.map((item, itemIdx) => (
                  <Pressable
                    key={item.label}
                    style={[
                      styles.menuItem,
                      { borderBottomColor: colors.outlineVariant },
                      itemIdx === section.items.length - 1 && styles.menuItemLast,
                    ]}
                    onPress={item.onPress}
                    accessibilityRole="button"
                  >
                    <View style={[
                      styles.iconCircle,
                      {
                        backgroundColor: item.destructive
                          ? 'rgba(255, 59, 48, 0.1)'
                          : colors.primary + '1A',
                      },
                    ]}>
                      <Ionicons
                        name={item.icon}
                        size={17}
                        color={item.destructive ? colors.error : colors.primary}
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
                ))}
              </View>
            </MotiView>
          );
        })}

        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
          EyeGo v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  scroll: { paddingBottom: spacing['3xl'] },

  heroWrapper: {
    marginHorizontal: spacing['2xl'],
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primary + '30',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  heroGradient: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },

  avatarWrapper: { position: 'relative', width: 88, height: 88, marginBottom: spacing.xs },
  avatarGlow: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  avatarFallback: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
  },
  editBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.backgroundDeep,
  },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primary + '22',
  },
  statValue: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleMedium,
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },

  sectionWrapper: {
    marginHorizontal: spacing['2xl'],
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  sectionCard: {
    borderRadius: radii['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
  },
  menuItemLast: { borderBottomWidth: 0 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  version: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
