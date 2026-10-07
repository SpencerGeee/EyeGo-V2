import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, Alert, Pressable, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import { fonts, radii } from '@eyego/config';
import { Text, Screen, ListSection, ListRow, SkeletonValue, goDeeper, goLateral } from '@eyego/ui';
import { getInitials, formatGhs } from '@eyego/utils';
import { useAuthStore } from '../../stores/auth.store';
import { useColors, Colors } from '../../utils/useColors';
import { useWalletBalance } from '../../hooks/useWalletBalance';
import { TAB_BAR_BASE_HEIGHT } from './_layout';

/**
 * ACCOUNT (rival spec §6) — who you are, three tiles for the places riders go
 * most (Wallet · Activity · Help), then plain sections. Legal, privacy, safety
 * and delete moved into Settings, where Uber keeps them.
 */
export default function ProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, logout } = useAuthStore();

  // `balancePesewas` — see hooks/useWalletBalance.
  const wallet = useWalletBalance();

  // The rating is server-computed; the store's copy is from sign-in.
  const profile = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: () => userApi.getProfile(),
    select: (r: any) => r.data?.data ?? null,
    staleTime: 60_000,
  });
  // What the account still needs — the server decides, so this can't
  // disagree with the console.
  const checklist = useQuery({
    queryKey: ['user', 'account-checklist'],
    queryFn: () => userApi.getAccountChecklist(),
    select: (r: any) => r.data?.data ?? null,
    staleTime: 30_000,
  });

  // Tabs never unmount: re-ask when the rider comes back from filling
  // something in, or the card tells them to add the email they just added.
  useFocusEffect(
    useCallback(() => {
      void checklist.refetch();
    }, []), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const ratingRaw = profile.data?.rating ?? (user as any)?.rating ?? null;
  const rating = typeof ratingRaw === 'number' && ratingRaw > 0 ? ratingRaw.toFixed(2) : null;
  const avatarUrl = profile.data?.avatarUrl ?? user?.avatarUrl;
  const todo = (checklist.data?.items ?? []).filter((i: any) => !i.done && i.severity !== 'optional');

  const handleLogout = () => {
    Alert.alert('Log out?', 'You’ll need your phone number to sign back in.', [
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

  const refreshing = profile.isRefetching || wallet.isRefetching;
  const onRefresh = () => {
    profile.refetch();
    wallet.refetch();
    checklist.refetch();
  };

  return (
    <Screen
      title="Account"
      back={false}
      contentContainerStyle={{ paddingBottom: TAB_BAR_BASE_HEIGHT + 64 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Who you are */}
      <Pressable
        style={styles.identity}
        onPress={() => goDeeper('/profile/edit')}
        accessibilityRole="button"
        accessibilityLabel={`${user?.name ?? 'Your profile'}${rating ? `, rated ${rating}` : ''}. Edit profile`}
      >
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Text style={styles.initials}>{user?.name ? getInitials(user.name) : '?'}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{user?.name || 'Add your name'}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="star" size={13} color={colors.onSurface} />
            <Text style={styles.meta}>{rating ?? 'New'}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={[styles.meta, { color: colors.primary }]}>Edit profile</Text>
          </View>
        </View>
      </Pressable>

      {/* Wallet · Activity · Help */}
      <View style={styles.tiles}>
        <Tile
          icon="wallet-outline"
          label="Wallet"
          onPress={() => goDeeper('/profile/wallet')}
          styles={styles}
          colors={colors}
          detail={
            <SkeletonValue loading={wallet.isPending} width={64} height={14} borderRadius={4}>
              <Text style={styles.tileDetail} numberOfLines={1}>
                {wallet.data == null && wallet.isError ? 'Tap to load' : formatGhs(wallet.data ?? 0)}
              </Text>
            </SkeletonValue>
          }
        />
        <Tile icon="time-outline" label="Activity" onPress={() => goLateral('/(tabs)/activity')} styles={styles} colors={colors} />
        <Tile icon="help-buoy-outline" label="Help" onPress={() => goDeeper('/profile/help')} styles={styles} colors={colors} />
      </View>

      {/* Finish setting up — hidden once nothing is outstanding. */}
      {checklist.data && todo.length > 0 ? (
        <ListSection
          title={`Finish setting up · ${checklist.data.completeness}%`}
          footer={checklist.data.outstandingRequired > 0 ? 'Needed before your next trip.' : undefined}
        >
          {todo.map((item: any) => (
            <ListRow
              key={item.id}
              icon={item.severity === 'required' ? 'alert-circle-outline' : 'add-circle-outline'}
              iconColor={item.severity === 'required' ? colors.statusWarning : colors.primary}
              title={item.label}
              subtitle={item.description}
              onPress={item.route ? () => goDeeper(item.route) : undefined}
            />
          ))}
        </ListSection>
      ) : null}

      <ListSection title="Rides">
        <ListRow icon="bookmark-outline" title="Saved places" onPress={() => goDeeper('/profile/saved-places')} />
        <ListRow icon="calendar-outline" title="Scheduled rides" onPress={() => goDeeper('/scheduled-rides')} />
        <ListRow icon="pricetag-outline" title="Promotions" onPress={() => goDeeper('/profile/promotions')} />
        <ListRow icon="briefcase-outline" title="Business profile" onPress={() => goDeeper('/profile/business')} />
      </ListSection>

      <ListSection title="Money">
        <ListRow icon="card-outline" title="Payment methods" onPress={() => goDeeper('/profile/payment-methods')} />
        <ListRow icon="paper-plane-outline" title="Send credits" onPress={() => goDeeper('/profile/send-money')} />
        <ListRow icon="qr-code-outline" title="Scan & pay" onPress={() => goDeeper('/profile/scan-pay')} />
      </ListSection>

      <ListSection>
        {/* Riders know the streets we route over — see app/improve-map. */}
        <ListRow icon="map-outline" title="Improve maps" onPress={() => goDeeper('/improve-map')} />
        <ListRow icon="settings-outline" title="Settings" subtitle="Notifications, privacy, safety, legal" onPress={() => goDeeper('/profile/settings')} />
      </ListSection>

      <ListSection>
        <ListRow icon="log-out-outline" title="Log out" destructive onPress={handleLogout} />
      </ListSection>

      <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
        EyeGo {Constants.expoConfig?.version ?? ''}
      </Text>
    </Screen>
  );
}

function Tile({
  icon,
  label,
  detail,
  onPress,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: React.ReactNode;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const [pressed, setPressed] = React.useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.tile, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={colors.onSurface} />
      <Text style={styles.tileLabel}>{label}</Text>
      {detail}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 8 },
    avatar: {
      width: 60,
      height: 60,
      borderRadius: 30,
      overflow: 'hidden',
      backgroundColor: c.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initials: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
    name: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    meta: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: c.onSurfaceVariant },
    metaDot: { fontFamily: fonts.regular, fontSize: 14, color: c.onSurfaceVariant },
    tiles: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 24 },
    tile: {
      flex: 1,
      minHeight: 92,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceContainer,
      padding: 14,
      justifyContent: 'space-between',
    },
    tileLabel: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 20, color: c.onSurface, marginTop: 10 },
    tileDetail: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: c.onSurfaceVariant, fontVariant: ['tabular-nums'] },
    version: { textAlign: 'center', marginTop: 28 },
  });
