import React, { useMemo } from 'react';
import { View, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts } from '@eyego/config';
import { Text, Screen, ListSection, ListRow, SkeletonRows, QueryBoundary, goDeeper } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';

const TIER_LABEL: Record<string, string> = { ECO: 'Eco', COMFORT: 'Comfort', PREMIUM: 'Premium' };

/**
 * VEHICLE (rival spec §18) — what riders see at the kerb: colour, make, model,
 * plate. Read-only; changes go through support, and the page says so with a
 * row that gets you there instead of a dead-end hint.
 */
export default function MyVehicleScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    // The server wraps the profile in { driver } — unwrap it.
    select: (r) => (r.data as any).data?.driver ?? (r.data as any).data,
  });
  const vehicle = me.data?.vehicles?.[0] ?? null;

  return (
    <Screen
      title="Vehicle"
      refreshControl={<RefreshControl refreshing={me.isRefetching} onRefresh={() => me.refetch()} tintColor={colors.primary} />}
    >
      <QueryBoundary
        loading={me.isLoading}
        error={me.isError && !me.data}
        onRetry={() => me.refetch()}
        skeleton={<SkeletonRows count={5} />}
      >
        {vehicle ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons name="bus-outline" size={30} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle} numberOfLines={2}>
                  {[vehicle.colour, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
                </Text>
                <View style={styles.plate}>
                  <Text style={styles.plateText}>{vehicle.plateNumber}</Text>
                </View>
              </View>
            </View>

            <ListSection title="Details">
              <ListRow icon="calendar-outline" title="Year" value={vehicle.year ? String(vehicle.year) : '—'} />
              <ListRow icon="people-outline" title="Passenger seats" value={vehicle.seaterCount ? String(vehicle.seaterCount) : '—'} />
              <ListRow icon="layers-outline" title="Class" value={TIER_LABEL[vehicle.tier] ?? vehicle.tier ?? '—'} />
              <ListRow
                icon={vehicle.isVerified ? 'shield-checkmark-outline' : 'time-outline'}
                title="Inspection"
                value={vehicle.isVerified ? 'Verified' : 'In review'}
                valueColor={vehicle.isVerified ? colors.statusSuccess : colors.statusWarning}
              />
            </ListSection>
          </>
        ) : (
          <ListSection footer="You need a vehicle on file to go online.">
            <ListRow icon="add-circle-outline" title="Add your vehicle" subtitle="Make, model, plate and class" onPress={() => goDeeper('/(onboarding)')} />
          </ListSection>
        )}

        {vehicle ? (
          <ListSection footer="Vehicle details are checked against your registration, so changes go through the EyeGo team.">
            <ListRow icon="chatbubble-ellipses-outline" title="Change vehicle details" onPress={() => goDeeper('/(profile)/help')} />
          </ListSection>
        ) : null}
      </QueryBoundary>
    </Screen>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    hero: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 8 },
    heroIcon: {
      width: 60,
      height: 60,
      borderRadius: 16,
      backgroundColor: c.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTitle: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
    plate: {
      alignSelf: 'flex-start',
      marginTop: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: c.onSurface,
    },
    plateText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 18, letterSpacing: 1.2, color: c.onSurface },
  });
