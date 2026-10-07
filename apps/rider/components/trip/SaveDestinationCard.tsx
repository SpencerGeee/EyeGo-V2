import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fonts, radii, spacing, withOpacity } from '@eyego/config';
import { Text, Pressable, notify } from '@eyego/ui';
import { userApi, queryKeys, type SavedPlace, type SavedPlaceSlot } from '@eyego/api';
import { useColors, type Colors } from '../../utils/useColors';

/** Within this distance an existing saved place IS this destination. */
const SAME_PLACE_M = 120;

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * "SAVE THIS DESTINATION" — Uber's post-trip card.
 *
 * The cheapest moment to save a place is the moment the rider has just been
 * there. Shown only when nothing saved is already within ~120 m, and offers
 * Home or Work only for a slot that is still empty — never an overwrite.
 */
export function SaveDestinationCard({ address, lat, lng }: { address: string; lat: number; lng: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: places, isSuccess } = useQuery({
    queryKey: queryKeys.user.savedPlaces,
    queryFn: () => userApi.getSavedPlaces(),
    select: (r): SavedPlace[] => (r.data as any)?.data?.places ?? [],
    staleTime: 60_000,
  });

  if (!isSuccess || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const list = places ?? [];
  if (!saved && list.some((p) => metresBetween(p.lat, p.lng, lat, lng) <= SAME_PLACE_M)) return null;
  const hasHome = list.some((p) => p.slot === 'HOME');
  const hasWork = list.some((p) => p.slot === 'WORK');
  const shortName = address.split(',')[0]?.trim() || 'This place';

  const save = async (slot: SavedPlaceSlot | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await userApi.createSavedPlace({
        label: slot === 'HOME' ? 'Home' : slot === 'WORK' ? 'Work' : shortName,
        address,
        lat,
        lng,
        slot,
        icon: slot === 'HOME' ? 'home' : slot === 'WORK' ? 'briefcase' : 'star',
      });
      setSaved(slot === 'HOME' ? 'Home' : slot === 'WORK' ? 'Work' : shortName);
      queryClient.invalidateQueries({ queryKey: queryKeys.user.savedPlaces });
    } catch (err: any) {
      notify("Couldn't save this place", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name={saved ? 'checkmark-circle' : 'bookmark-outline'} size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{saved ? `Saved as ${saved}` : 'Save this destination?'}</Text>
          <Text style={styles.sub} numberOfLines={1}>{address}</Text>
        </View>
      </View>
      {saved ? null : (
        <View style={styles.row}>
          {!hasHome ? <Chip label="Home" icon="home-outline" onPress={() => save('HOME')} styles={styles} colors={colors} /> : null}
          {!hasWork ? <Chip label="Work" icon="briefcase-outline" onPress={() => save('WORK')} styles={styles} colors={colors} /> : null}
          <Chip label="Saved place" icon="star-outline" onPress={() => save(null)} styles={styles} colors={colors} />
        </View>
      )}
    </View>
  );
}

function Chip({
  label,
  icon,
  onPress,
  styles,
  colors,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <Pressable onPress={onPress} haptic="light" style={styles.chip} accessibilityRole="button" accessibilityLabel={`Save as ${label}`}>
      <Ionicons name={icon} size={14} color={colors.onSurface} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.primary, 0.35),
      backgroundColor: colors.surfaceContainer,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.onSurface },
    sub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.onSurfaceVariant, marginTop: 1 },
    row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 40,
      paddingHorizontal: spacing.md,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainerHigh,
    },
    chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.onSurface },
  });

export default SaveDestinationCard;
