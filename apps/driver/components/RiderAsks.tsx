import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, radii, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors } from '../utils/useColors';

const PREF: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  quiet: { label: 'Quiet ride', icon: 'volume-mute-outline' },
  ac: { label: 'AC on', icon: 'snow-outline' },
  luggage: { label: 'Luggage help', icon: 'briefcase-outline' },
};

/**
 * What the rider asked of the driver: their ride preferences as chips and
 * their pickup note ("blue gate, opposite the pharmacy"). On the offer card so
 * the driver decides knowing them, and on the trip sheet so they arrive at the
 * right gate. Renders nothing when the rider asked nothing.
 */
export function RiderAsks({ note, prefs }: { note?: string | null; prefs?: string[] | null }) {
  const colors = useColors();
  const chips = (prefs ?? []).filter((p) => PREF[p]);
  if (!note && !chips.length) return null;
  return (
    <View style={styles.wrap}>
      {chips.length ? (
        <View style={styles.chips}>
          {chips.map((p) => (
            <View key={p} style={[styles.chip, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainer }]}>
              <Ionicons name={PREF[p].icon} size={13} color={colors.onSurfaceVariant} />
              <Text style={[styles.chipText, { color: colors.onSurface }]}>{PREF[p].label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {note ? (
        <View style={[styles.note, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '33' }]}>
          <Ionicons name="chatbox-ellipses-outline" size={14} color={colors.primary} />
          <Text style={[styles.noteText, { color: colors.onSurface }]} numberOfLines={3}>
            “{note}”
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.full, borderWidth: 1,
  },
  chipText: { fontFamily: fonts.medium, fontSize: fontSizes.caption },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    padding: spacing.md, borderRadius: radii.lg, borderWidth: 1,
  },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, lineHeight: 18 },
});
