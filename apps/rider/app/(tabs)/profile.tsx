import React, { useMemo } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  FadeIn,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, walletApi, queryKeys } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Pressable, MorphSource, useMorph, setBackgroundBusy, backgroundScrollPauseProps } from '@eyego/ui';
import { getInitials, formatCurrency } from '@eyego/utils';
import { TAB_BAR_BASE_HEIGHT } from './_layout';

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: 'primary' | 'success' | 'error';
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

/**
 * Profile hub — collapsing-hero motion.
 *
 * One shared value (`scrollY`) drives every header transform: the expanded
 * hero (big avatar + name + chips) fades and lifts away while a compact pinned
 * navbar fades in, mirroring the iOS large-title collapse. The avatar also
 * scales on overscroll for a parallax depth cue. Nothing animates height or
 * font size (relayout cost) — only transforms/opacity on the UI thread — and
 * no child invents its own motion; each header layer reads the same `scrollY`.
 */
const HERO_HEIGHT = 128;   // expanded hero content, below the status bar
const NAV_HEIGHT = 52;     // collapsed pinned navbar
const COLLAPSE_DIST = HERO_HEIGHT - NAV_HEIGHT;

export default function ProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const { morphTo } = useMorph();
  const PROFILE_MORPH_ID = 'profile-hero-avatar';

  const scrollY = useSharedValue(0);
  // Pause the ambient shader while the list is actively scrolling — the
  // begin/end pairs stay balanced (busy counter) across drag → momentum.
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
    onBeginDrag: () => {
      runOnJS(setBackgroundBusy)(true);
    },
    onEndDrag: () => {
      runOnJS(setBackgroundBusy)(false);
    },
    onMomentumBegin: () => {
      runOnJS(setBackgroundBusy)(true);
    },
    onMomentumEnd: () => {
      runOnJS(setBackgroundBusy)(false);
    },
  });

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

  // ── Derived header motion (all from scrollY) ──────────────────────────────
  const heroStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE_DIST * 0.7], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, COLLAPSE_DIST], [0, -24], Extrapolation.CLAMP) },
    ],
  }));

  const avatarStyle = useAnimatedStyle(() => ({
    transform: [
      // Subtle parallax settle — no overscroll bounce (clamped).
      { scale: interpolate(scrollY.value, [-90, 0], [1.08, 1], Extrapolation.CLAMP) },
    ],
  }));

  const navBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_DIST * 0.45, COLLAPSE_DIST], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.safe}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        {...backgroundScrollPauseProps}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + HERO_HEIGHT + spacing.base },
        ]}
      >
        {/* ── Wallet card ── */}
        <Animated.View entering={FadeIn.delay(60).duration(200)} style={styles.walletCard}>
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
              haptic="light"
              style={styles.topUpBtn}
              accessibilityRole="button"
              accessibilityLabel="Top up wallet"
            >
              <Text style={styles.topUpText}>Top Up</Text>
            </Pressable>
          </View>
        </Animated.View>

        {/* ── Menu sections (staggered reveal) ── */}
        {menuSections.map((section, sIdx) => (
          <Animated.View
            key={section.title}
            entering={FadeIn.delay(120 + sIdx * 50).duration(200)}
            style={styles.sectionWrapper}
          >
            <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
            <View style={styles.sectionCard}>
              {section.items.map((item, itemIdx) => (
                <Pressable
                  key={item.label}
                  haptic="light"
                  scaleOnPress={0.98}
                  style={
                    itemIdx === section.items.length - 1
                      ? [styles.menuItem, styles.menuItemLast]
                      : styles.menuItem
                  }
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
          </Animated.View>
        ))}

        {/* ── Log out ── */}
        <Pressable onPress={handleLogout} haptic="medium" style={styles.logoutBtn} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={20} color={colors.statusError} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>

        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
          EyeGo v1.0.0
        </Text>
      </Animated.ScrollView>

      {/* ── Expanded hero (fades + lifts away on scroll) ── */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.hero, { top: insets.top, height: HERO_HEIGHT }, heroStyle]}
      >
        <View style={styles.headerLeft}>
          <MorphSource id={PROFILE_MORPH_ID} borderRadius={32} backgroundColor={colors.surfaceContainerHigh}>
            <Animated.View style={[styles.avatarRing, avatarStyle]}>
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={[styles.avatarInitials, { color: colors.primary }]}>
                    {user?.name ? getInitials(user.name) : '?'}
                  </Text>
                </View>
              )}
            </Animated.View>
          </MorphSource>
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
          onPress={() => morphTo(PROFILE_MORPH_ID, () => router.push('/profile/edit' as any))}
          haptic="light"
          style={styles.editBtn}
          accessibilityLabel="Edit profile"
          accessibilityRole="button"
          hitSlop={8}
        >
          <Ionicons name="pencil" size={18} color={colors.onSurfaceVariant} />
        </Pressable>
      </Animated.View>

      {/* ── Collapsed pinned navbar (fades in as hero leaves) ── */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.navBar, { paddingTop: insets.top, height: insets.top + NAV_HEIGHT }, navBarStyle]}
      >
        <View style={styles.navContent}>
          <View style={styles.navAvatar}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={[styles.navAvatarInitials, { color: colors.primary }]}>
                  {user?.name ? getInitials(user.name) : '?'}
                </Text>
              </View>
            )}
          </View>
          <Text variant="titleSmall" numberOfLines={1} style={styles.navTitle}>
            {user?.name ?? 'Profile'}
          </Text>
          <Pressable
            onPress={() => router.push('/profile/edit' as any)}
            haptic="light"
            style={styles.navEditBtn}
            accessibilityLabel="Edit profile"
            accessibilityRole="button"
            hitSlop={8}
          >
            <Ionicons name="pencil" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: spacing['2xl'], paddingBottom: TAB_BAR_BASE_HEIGHT + 64 },

  // Expanded hero
  hero: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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

  // Collapsed pinned navbar
  navBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: withOpacity(colors.surfaceCard ?? colors.surfaceContainer, 0.92),
    borderBottomWidth: 1,
    borderBottomColor: colors.rimLightSubtle,
  },
  navContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing['2xl'],
  },
  navAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${colors.primary}80`,
    overflow: 'hidden',
  },
  navAvatarInitials: { fontFamily: fonts.displayBold, fontSize: 13, lineHeight: 17 },
  navTitle: { flex: 1, color: colors.onSurface },
  navEditBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
