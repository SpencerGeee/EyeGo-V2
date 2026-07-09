import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';

export default function MyVehicleScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => {
      const data = (r.data as any).data;
      // Backend wraps driver data in { driver: ... } — unwrap it
      return data?.driver ?? data;
    },
  });

  const vehicle = (profile as any)?.vehicles?.[0] ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>My Vehicle</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
            Vehicle details assigned to your account.
          </Text>
        </MotiView>

        {isLoading ? (
          <View style={styles.skeletonWrapper}>
            {[200, 160, 120].map((w, i) => (
              <MotiView
                key={i}
                from={{ opacity: 0.3 }}
                animate={{ opacity: 0.7 }}
                transition={{ type: 'timing', duration: 800, loop: true, delay: i * 150 }}
                style={[styles.skeleton, { width: w }]}
              />
            ))}
          </View>
        ) : vehicle ? (
          <MotiView
            from={{ opacity: 0, translateY: 14 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 100 }}
            style={styles.vehicleCard}
          >
            <View style={styles.vehicleIconRow}>
              <View style={styles.vehicleIconBg}>
                <Ionicons name="bus-outline" size={36} color={colors.primary} />
              </View>
              <View style={styles.tierBadge}>
                <Text style={styles.tierText}>{vehicle.tier ?? 'ECO'}</Text>
              </View>
            </View>

            <VehicleRow icon="car-outline" label="Make / Model" value={`${vehicle.make ?? '—'} ${vehicle.model ?? ''}`} colors={colors} />
            <View style={styles.divider} />
            <VehicleRow icon="keypad-outline" label="License Plate" value={vehicle.plateNumber ?? '—'} colors={colors} />
            <View style={styles.divider} />
            <VehicleRow icon="people-outline" label="Capacity" value={`${vehicle.seatCapacity ?? 14} seats`} colors={colors} />
            <View style={styles.divider} />
            <VehicleRow
              icon={vehicle.isVerified ? 'shield-checkmark-outline' : 'time-outline'}
              label="Verification"
              value={vehicle.isVerified ? 'Verified' : 'Pending'}
              valueColor={vehicle.isVerified ? colors.primary : '#F59E0B'}
              colors={colors}
            />
          </MotiView>
        ) : (
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 100 }}
            style={styles.emptyCard}
          >
            <Ionicons name="car-outline" size={48} color={colors.onSurfaceVariant} />
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.md }}>
              No vehicle assigned yet.
            </Text>
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.xs }}>
              Contact EyeGo support to have your vehicle added.
            </Text>
          </MotiView>
        )}

        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 200 }}
          style={styles.supportHint}
        >
          <Ionicons name="information-circle-outline" size={14} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>
            To update vehicle details, contact EyeGo support.
          </Text>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

function VehicleRow({
  icon, label, value, valueColor, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  valueColor?: string;
  colors: DriverColors;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.base }}>
      <Ionicons name={icon} size={18} color={colors.onSurfaceVariant} />
      <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: valueColor ?? colors.onSurface }}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    headline: { letterSpacing: -1 },
    subtext: { marginTop: spacing.xs, marginBottom: spacing['2xl'] },
    skeletonWrapper: { gap: spacing.lg, marginTop: spacing.xl },
    skeleton: { height: 20, borderRadius: 10, backgroundColor: colors.surfaceContainerHigh },
    vehicleCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    vehicleIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xl,
    },
    vehicleIconBg: {
      width: 72,
      height: 72,
      borderRadius: radii.xl,
      backgroundColor: `${colors.primary}14`,
      borderWidth: 1,
      borderColor: `${colors.primary}33`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tierBadge: {
      backgroundColor: `${colors.primary}22`,
      borderWidth: 1,
      borderColor: `${colors.primary}55`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    tierText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.primary, letterSpacing: 1 },
    divider: { height: 1, backgroundColor: colors.outlineVariant },
    emptyCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing['3xl'],
      alignItems: 'center',
    },
    supportHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.xl,
      justifyContent: 'center',
    },
  });
