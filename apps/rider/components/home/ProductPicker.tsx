import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fonts, spacing } from '@eyego/config';
import { Text, Pressable, goDeeper } from '@eyego/ui';
import type { Colors } from '../../utils/useColors';

/**
 * ── WHAT DO YOU WANT TO DO? ──────────────────────────────────────────────────
 *
 * Client meeting 2026-10-29, item 8: the first screen asks which product the
 * rider wants instead of a single "Where to?" bar.
 *   Book a seat    — join a bus already passing your stop (the core product)
 *   Whole bus      — a group or charter: the whole vehicle, door to door
 *   Private bus    — an empty bus comes to you on demand (can be scheduled)
 *
 * Card spec v2 (docs/research/2026-10-29-visual-teardown.md §7): flat solid
 * surface, 16 pt corners, 1 pt hairline, brand colour only on the icon and the
 * primary tile's outline. No glass, no glow.
 */
type Product = 'seat' | 'bus' | 'ride';

const PRODUCTS: { id: Product; title: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'seat', title: 'Book a seat', sub: 'Join a bus passing you', icon: 'people-outline' },
  { id: 'bus', title: 'Whole bus', sub: 'Groups & events', icon: 'bus-outline' },
  { id: 'ride', title: 'Private bus', sub: 'Comes to you', icon: 'navigate-outline' },
];

export function ProductPicker({ colors }: { colors: Colors }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="What do you want to book?">
      {PRODUCTS.map((p, i) => {
        const primary = i === 0;
        return (
          <Pressable
            key={p.id}
            testID={`home-product-${p.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${p.title}. ${p.sub}`}
            onPress={() => {
              void Haptics.selectionAsync();
              goDeeper(`/trip?stage=search&product=${p.id}` as any);
            }}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: colors.surfaceCard,
                borderColor: primary ? colors.primary : colors.rimLight,
                borderWidth: primary ? 2 : StyleSheet.hairlineWidth * 2,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            <Ionicons name={p.icon} size={22} color={colors.primary} />
            <Text style={[styles.title, { color: colors.onSurface }]} numberOfLines={1}>{p.title}</Text>
            <Text style={[styles.sub, { color: colors.onSurfaceVariant }]} numberOfLines={2}>{p.sub}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  tile: {
    flex: 1,
    minHeight: 96,
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: 6,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 14 },
  sub: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
});
