import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { mapReportsApi, type MapReport, type MapReportType } from '@eyego/api';
import { relativeTime } from '@eyego/utils';
import { spacing, radii, withOpacity } from '@eyego/config';
import { Text, Pressable, AppBackground, backgroundScrollPauseProps, Entrance, Loader, goDeeper, goBack } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';

/**
 * IMPROVE MAPS — the hub.
 *
 * "You need to implement the improve maps page which would allow users to add
 *  places and fix errors on the app. Yango does this and it's better to make
 *  this. In that page they should be able to add place, edit place, edit
 *  address, add object, road issue and leave comment."
 *
 * ── WHY THIS IS WORTH BUILDING ──────────────────────────────────────────────
 * Riders know things the geocoder does not. A shop that moved. A gate that is
 * always locked, so the pin lands on the wrong side of a wall. A road that is
 * one-way now. None of it reaches us today, and the same bad pickup point costs
 * a driver five minutes every single time somebody books it.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 * Six entries, one form. Each row carries a WORKED EXAMPLE rather than a
 * category name, because "Add object" means nothing to a rider standing at a
 * kerb and "a gate, a barrier, a speed bump" means something immediately. The
 * form itself is one screen (`[type].tsx`) driven by the server's own schema —
 * see mapReportsApi.getSchema — so adding a seventh type never needs a release
 * of this file.
 *
 * The recent list underneath is not decoration. A feedback surface that
 * swallows what it is given is one people use once; showing the rider their own
 * reports and what came of each is the entire difference.
 */

const OPTIONS: {
  type: MapReportType;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
}[] = [
  {
    type: 'ADD_PLACE',
    icon: 'add-circle-outline',
    title: 'Add a place',
    sub: "A shop, office or landmark that isn't on the map yet",
  },
  {
    type: 'EDIT_PLACE',
    icon: 'create-outline',
    title: 'Fix a place',
    sub: "Wrong name, closed down, moved, or the wrong kind of place",
  },
  {
    type: 'EDIT_ADDRESS',
    icon: 'pin-outline',
    title: 'Fix an address or pin',
    sub: 'The pin lands in the wrong spot, or the address text is wrong',
  },
  {
    type: 'ADD_OBJECT',
    icon: 'cube-outline',
    title: 'Add something on the road',
    sub: 'An entrance, a barrier, a speed bump, a crossing',
  },
  {
    type: 'ROAD_ISSUE',
    icon: 'warning-outline',
    title: 'Report a road problem',
    sub: 'Closed, one-way, flooded, under construction',
  },
  {
    type: 'COMMENT',
    icon: 'chatbubble-ellipses-outline',
    title: 'Leave a comment',
    sub: 'Anything else you noticed, in your own words',
  },
];

/** What a status means to the person who filed it — not what it means to us. */
const STATUS_COPY: Record<string, { label: string; tone: 'pending' | 'good' | 'bad' }> = {
  PENDING: { label: 'Sent', tone: 'pending' },
  IN_REVIEW: { label: 'Being checked', tone: 'pending' },
  ACCEPTED: { label: 'Applied — thank you', tone: 'good' },
  REJECTED: { label: "Couldn't use this", tone: 'bad' },
  DUPLICATE: { label: 'Already reported', tone: 'pending' },
};

const TYPE_LABEL: Record<MapReportType, string> = {
  ADD_PLACE: 'New place',
  EDIT_PLACE: 'Place fix',
  EDIT_ADDRESS: 'Address fix',
  ADD_OBJECT: 'Road object',
  ROAD_ISSUE: 'Road problem',
  COMMENT: 'Comment',
};

export default function ImproveMapScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const { data: mine, isLoading } = useQuery({
    queryKey: ['map-reports', 'mine'],
    queryFn: async () => {
      const res = await mapReportsApi.mine({ limit: 10 });
      return res.data?.data?.reports ?? [];
    },
    // The rider's own history changes only when they file something, and this
    // screen is the thing that files it — so the mutation invalidates rather
    // than this polling.
    staleTime: 60_000,
  });

  const open = (type: MapReportType) => {
    void Haptics.selectionAsync().catch(() => {});
    goDeeper(`/improve-map/${type}` as never);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" isDark={isDark} />

      <View style={styles.header}>
        <Pressable
          onPress={() => goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>
          Improve maps
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        {...backgroundScrollPauseProps}
      >
        <Entrance animation="slideDown" delay={60}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.intro}>
            You see the streets we&apos;re routing over. If something on the map is wrong, tell us
            and we&apos;ll fix it for everyone.
          </Text>
        </Entrance>

        <View style={styles.card}>
          {OPTIONS.map((opt, i) => (
            <View key={opt.type}>
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={() => open(opt.type)}
                accessibilityRole="button"
                accessibilityLabel={`${opt.title}. ${opt.sub}`}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={opt.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.rowBody}>
                  <Text variant="bodyMedium" color={colors.onSurface}>
                    {opt.title}
                  </Text>
                  <Text variant="caption" style={{ color: colors.onSurfaceVariant }}>
                    {opt.sub}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
              </Pressable>
              {i < OPTIONS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/*
          WHAT CAME OF WHAT YOU SENT.

          A feedback surface that swallows what it is given is one people use
          once. This is the half that makes the rest worth building.
        */}
        <Text variant="labelCaps" style={styles.sectionLabel}>
          YOUR REPORTS
        </Text>
        <View style={styles.card}>
          {isLoading ? (
            <View style={styles.loading}>
              <Loader size={20} color={colors.primary} />
            </View>
          ) : !mine || mine.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="caption" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
                Nothing yet. Anything you send shows up here with what happened to it.
              </Text>
            </View>
          ) : (
            mine.map((r: MapReport, i: number) => {
              const status = STATUS_COPY[r.status] ?? STATUS_COPY.PENDING;
              const tone =
                status.tone === 'good'
                  ? colors.statusSuccess
                  : status.tone === 'bad'
                    ? colors.statusError
                    : colors.onSurfaceVariant;
              return (
                <View key={r.id}>
                  <View style={styles.row}>
                    <View style={[styles.rowIcon, { backgroundColor: withOpacity(tone, 0.12) }]}>
                      <Ionicons
                        name={
                          status.tone === 'good'
                            ? 'checkmark-circle-outline'
                            : status.tone === 'bad'
                              ? 'close-circle-outline'
                              : 'time-outline'
                        }
                        size={18}
                        color={tone}
                      />
                    </View>
                    <View style={styles.rowBody}>
                      <Text variant="bodyMedium" color={colors.onSurface} numberOfLines={1}>
                        {r.name || r.address || TYPE_LABEL[r.type]}
                      </Text>
                      <Text variant="caption" style={{ color: colors.onSurfaceVariant }} numberOfLines={1}>
                        {TYPE_LABEL[r.type]} · {relativeTime(r.createdAt)}
                      </Text>
                      {/* The reason, when there is one. A rejection with no
                          reason is indistinguishable from one nobody read. */}
                      {r.reviewNote ? (
                        <Text variant="caption" style={{ color: tone }} numberOfLines={2}>
                          {r.reviewNote}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.statusChip, { backgroundColor: withOpacity(tone, 0.14) }]}>
                      <Text variant="caption" style={{ color: tone }}>
                        {status.label}
                      </Text>
                    </View>
                  </View>
                  {i < mine.length - 1 && <View style={styles.divider} />}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { paddingHorizontal: spacing['2xl'], paddingBottom: spacing['4xl'] },
    intro: { lineHeight: 22, marginBottom: spacing.xl },
    sectionLabel: { marginTop: spacing['2xl'], marginBottom: spacing.sm, color: colors.onSurfaceVariant },
    card: {
      backgroundColor: colors.surfaceCard,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.rimLight,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', padding: spacing.base, gap: spacing.md },
    rowIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: withOpacity(colors.primary, 0.12),
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowBody: { flex: 1, gap: 2 },
    divider: { height: 1, backgroundColor: colors.rimLightSubtle, marginHorizontal: spacing.base },
    statusChip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.sm },
    loading: { padding: spacing.xl, alignItems: 'center' },
    empty: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  });
