import React, { useMemo } from 'react';
import { formatGhs, monthYear } from '@eyego/utils';
import { View, StyleSheet, Pressable, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { driverApi, apiClient, MOMO_NETWORKS, type DriverDocument } from '@eyego/api';
import Constants from 'expo-constants';
import { fonts } from '@eyego/config';
import { Text, Avatar, Skeleton, Screen, ListSection, ListRow, goDeeper } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const DAY_MS = 86_400_000;

/** One line that says whether the documents need the driver, worst first. */
function documentsSummary(docs: DriverDocument[] | undefined): { text: string; tone: 'ok' | 'warn' | 'bad' } | null {
  if (!docs) return null;
  const bad = docs.filter((d) => d.status === 'REJECTED' || d.status === 'EXPIRED' || d.status === 'MISSING').length;
  if (bad) return { text: `${bad} need${bad === 1 ? 's' : ''} attention`, tone: 'bad' };
  const soon = docs.filter((d) => d.expiresAt && new Date(d.expiresAt).getTime() - Date.now() < 30 * DAY_MS).length;
  if (soon) return { text: `${soon} expiring soon`, tone: 'warn' };
  if (docs.some((d) => d.status === 'PENDING')) return { text: 'In review', tone: 'warn' };
  return { text: 'All verified', tone: 'ok' };
}

function payoutSummary(p: any): string {
  if (!p?.type) return 'Not set up';
  const tail = String(p.type === 'momo' ? p.phone : p.accountNumber ?? '').slice(-4);
  const net = MOMO_NETWORKS.find((n) => n.value === p.network || n.label === p.network)?.label;
  const name = p.type === 'momo' ? (net || 'Mobile money') : (p.bankName || 'Bank');
  return tail ? `${name} •••• ${tail}` : name;
}

/**
 * ACCOUNT — the driver's Uber-style account page (rival spec §18).
 *
 * A header that says who you are, then four plain sections. Legal pages and
 * Delete account moved into Settings, where Uber keeps them; Ratings and
 * Performance are one page now. Each row carries the one fact a driver opens
 * it for — the vehicle on file, whether documents need them, where money goes —
 * so most visits end on this screen.
 */
export default function ProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { driver, logout } = useDriverStore();

  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const data = (r.data as any).data;
      return data?.driver ?? data;
    },
    staleTime: 0,
    refetchOnMount: true,
  });
  const docs = useQuery({
    queryKey: ['driver', 'documents'],
    queryFn: () => driverApi.getDocuments(),
    select: (r) => ((r.data as any)?.data ?? []) as DriverDocument[],
  });
  const payout = useQuery({
    queryKey: ['payout-account'],
    queryFn: () => apiClient.get('/driver/wallet/payout-account'),
    select: (r) => (r.data as any)?.data ?? null,
  });

  const meData = me.data;
  const displayName = meData?.name ?? driver?.name ?? 'Driver';
  const rating: number | null = meData?.rating ?? (driver as any)?.rating ?? null;
  const totalTrips = meData?.totalTrips ?? driver?.totalTrips ?? 0;
  const totalEarned = meData?.totalEarned ?? driver?.totalEarned ?? 0;
  const since = meData?.createdAt ?? driver?.createdAt;
  const vehicle = meData?.vehicles?.[0];
  const docLine = documentsSummary(docs.data);

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

  const refreshing = me.isRefetching || docs.isRefetching || payout.isRefetching;
  const onRefresh = () => {
    me.refetch();
    docs.refetch();
    payout.refetch();
  };

  return (
    <Screen
      title="Account"
      back={false}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Who you are */}
      <Pressable
        style={styles.identity}
        onPress={() => goDeeper('/(profile)/edit')}
        accessibilityRole="button"
        accessibilityLabel={`${displayName}, edit profile`}
      >
        <View style={styles.avatarRing}>
          <Avatar size={64} name={displayName} uri={meData?.avatarUrl ?? driver?.avatarUrl} />
        </View>
        <View style={{ flex: 1 }}>
          {me.isLoading && !driver ? (
            <>
              <Skeleton width="55%" height={20} />
              <Skeleton width="35%" height={14} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <View style={styles.metaRow}>
                <Ionicons name="star" size={13} color={colors.onSurface} />
                <Text style={styles.meta}>
                  {rating == null ? 'New' : rating.toFixed(2)}
                  {'  ·  '}
                  {meData?.phone ?? driver?.phone ?? ''}
                </Text>
              </View>
            </>
          )}
        </View>
        <Ionicons name="create-outline" size={20} color={colors.onSurfaceVariant} />
      </Pressable>

      {/* Lifetime numbers — flat, no card */}
      <View style={styles.stats}>
        <Stat label="Trips" value={String(totalTrips)} styles={styles} />
        <View style={styles.statRule} />
        <Stat label="Earned" value={formatGhs(totalEarned, { showDecimals: false })} styles={styles} />
        <View style={styles.statRule} />
        <Stat
          label="Driving since"
          value={since ? monthYear(since) : '—'}
          styles={styles}
        />
      </View>

      <ListSection title="Driving">
        <ListRow
          icon="car-outline"
          title="Vehicle"
          subtitle={vehicle ? `${vehicle.colour ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} · ${vehicle.plateNumber ?? ''}`.trim() : 'Add your vehicle'}
          onPress={() => goDeeper('/(profile)/vehicle')}
        />
        <ListRow
          icon="document-text-outline"
          title="Documents"
          subtitle={docLine?.text ?? (docs.isError ? 'Couldn’t load' : 'Checking…')}
          value={docLine?.tone === 'bad' ? 'Action needed' : undefined}
          valueColor={colors.error}
          onPress={() => goDeeper('/(profile)/documents')}
        />
        <ListRow
          icon="wallet-outline"
          title="Payout account"
          subtitle={payout.isLoading ? 'Checking…' : payoutSummary(payout.data)}
          onPress={() => goDeeper('/(profile)/payout-account')}
        />
      </ListSection>

      <ListSection title="You">
        <ListRow
          icon="star-outline"
          title="Ratings & performance"
          value={rating == null ? undefined : `${rating.toFixed(2)} ★`}
          onPress={() => goDeeper('/(profile)/performance')}
        />
        <ListRow icon="shield-checkmark-outline" title="Safety" subtitle="Emergency contact and safety tools" onPress={() => goDeeper('/(profile)/safety')} />
        <ListRow icon="help-circle-outline" title="Help" onPress={() => goDeeper('/(profile)/help')} />
      </ListSection>

      <ListSection>
        <ListRow icon="settings-outline" title="Settings" subtitle="Navigation, alerts, appearance, legal" onPress={() => goDeeper('/(profile)/settings')} />
        <ListRow icon="log-out-outline" title="Log out" destructive onPress={handleLogout} />
      </ListSection>

      <Text variant="caption" color={colors.onSurfaceVariant} style={styles.version}>
        EyeGo Driver {Constants.expoConfig?.version ?? ''}
      </Text>
    </Screen>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 12 },
    avatarRing: { padding: 2, borderRadius: 999, borderWidth: 2, borderColor: colors.primary },
    name: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: colors.onSurface },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    meta: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.onSurfaceVariant },
    stats: { flexDirection: 'row', marginTop: 24, marginHorizontal: 20 },
    stat: { flex: 1, gap: 2 },
    statRule: { width: StyleSheet.hairlineWidth, backgroundColor: colors.outlineVariant, marginHorizontal: 12 },
    statValue: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 23, color: colors.onSurface },
    statLabel: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 16, color: colors.onSurfaceVariant },
    version: { textAlign: 'center', marginTop: 28 },
  });
