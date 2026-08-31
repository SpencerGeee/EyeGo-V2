import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';
import { Text, Skeleton, SmoothScreen, SmoothIn, SmoothDefer, goDeeper, goBack, useSmoothScreen } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { queryKeys, tripsApi } from '@eyego/api';
import { MapView, Camera, GHANA_BOUNDS, GHANA_MIN_ZOOM } from '@eyego/maps';
import MapboxGL from '@eyego/maps';
import mapStyles from '@eyego/map-styles';

import { useColors, type Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';
import {
  BOARDING_ACCENT,
  BROWSE_GROUPS,
  GROUP_COPY,
  type BrowseGroup,
  byDeparture,
  departureLabel,
  destinationName,
  groupOf,
  originName,
  seatsLeft,
  tripOrigin,
} from '../../utils/tripGroups';

/**
 * BROWSE — WHERE THIRTY TRIPS GO.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * "If there are about 30 trips created by different drivers and the user comes
 * to the homepage, currently he'd see a plethora of cards stacked vertically
 * and would scroll on and on. You need to find your way out on this."
 *
 * Right, and the home screen was never the place to solve it. A home screen's
 * job is to say what is available and let the rider choose to look; a catalogue
 * of every open ride in the city is a different screen with different needs — a
 * map, filters, and a list that can render hundreds of rows without stuttering.
 *
 * So home keeps a PREVIEW of each group (two cards and a count) and this page
 * is where the rest live. One route, four groups, driven by the `group` param.
 *
 * ── WHY THE MAP IS THE HEADER ───────────────────────────────────────────────
 * "If possible, these pages should have a map system so the rider can easily
 * locate where each trip card is going."
 *
 * A list of place names does not answer "is this one near me" — a rider who
 * does not know a neighbourhood by name cannot tell from a card whether a trip
 * leaves from the next street or across the city. Pins answer it instantly, and
 * the two halves are bound both ways: tapping a pin selects its card and
 * scrolls to it, tapping a card lifts its pin and flies the camera to it. That
 * is the interaction Uber's and Bolt's "explore" surfaces use, and it is what
 * makes a long list feel navigable rather than endless.
 *
 * ── AND WHY IT DOES NOT STUTTER ─────────────────────────────────────────────
 * `FlashList` for the rows, and the map deferred behind `SmoothDefer` so the
 * push animation is not competing with a MapLibre surface coming up. See
 * packages/ui/src/motion/smooth.
 */

const MAP_FRACTION = 0.38;

function parseGroup(raw: string | string[] | undefined): BrowseGroup {
  const g = Array.isArray(raw) ? raw[0] : raw;
  return (BROWSE_GROUPS as readonly string[]).includes(g ?? '') ? (g as BrowseGroup) : 'all';
}

/**
 * A ROW, NOT A CARD.
 *
 * The home rails use tall bento cards because they show two or three of them
 * and can afford the bloom. A list of thirty needs a scannable row: departure
 * on the left where the eye starts, the journey in the middle, the fare on the
 * right. Fixed height, so `FlashList` can size without measuring.
 */
const ROW_HEIGHT = 92;

function TripRow({
  trip,
  selected,
  onPress,
  colors,
  s,
}: {
  trip: any;
  selected: boolean;
  onPress: () => void;
  colors: Colors;
  s: ReturnType<typeof makeStyles>;
}) {
  const group = groupOf(trip);
  const accent = group === 'boarding' ? BOARDING_ACCENT : colors.primary;
  const left = seatsLeft(trip);
  const fare = trip?.farePerSeatPesewas;

  const press = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.015 }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        onPressIn={() => { press.value = withSpring(1, springs.press); }}
        onPressOut={() => { press.value = withSpring(0, springs.press); }}
        accessibilityRole="button"
        accessibilityLabel={`Ride to ${destinationName(trip)}, ${departureLabel(trip)}`}
        style={[
          s.row,
          selected && { borderColor: withOpacity(accent, 0.7), backgroundColor: colors.surfaceContainerHigh },
        ]}
      >
        {/* The tone rail — one element carries the group, as everywhere else. */}
        <View style={[s.rowRail, { backgroundColor: selected ? accent : withOpacity(accent, 0.45) }]} />

        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <Text style={[s.rowWhen, { color: accent }]} numberOfLines={1}>
              {departureLabel(trip).toUpperCase()}
            </Text>
            {left != null && (
              <Text style={s.rowSeats} numberOfLines={1}>
                {left === 0 ? 'Full' : `${left} seat${left === 1 ? '' : 's'} left`}
              </Text>
            )}
          </View>

          <Text style={s.rowDest} numberOfLines={1}>
            {destinationName(trip)}
          </Text>
          <Text style={s.rowFrom} numberOfLines={1}>
            from {originName(trip)}
          </Text>
        </View>

        <View style={s.rowRight}>
          {typeof fare === 'number' && (
            <Text style={s.rowFare} numberOfLines={1}>
              {formatGhs(fare)}
            </Text>
          )}
          <Ionicons name="chevron-forward" size={15} color={colors.onSurfaceVariant} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** The map half. Split out so `SmoothDefer` can hold just this back. */
function BrowseMap({
  trips,
  selectedId,
  onSelect,
  height,
  colors,
  s,
}: {
  trips: any[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  height: number;
  colors: Colors;
  s: ReturnType<typeof makeStyles>;
}) {
  // Same two styles every other map in this app uses — never a bare Mapbox URL,
  // which is what makes one screen's map look like a different product.
  const isDark = useThemeStore((st) => st.isDark);
  const mapStyle = isDark ? mapStyles.eyegoDarkStyle : mapStyles.eyegoLightStyle;
  const cameraRef = useRef<any>(null);

  const pins = useMemo(
    () =>
      trips
        .map((t) => ({ id: String(t.id), coord: tripOrigin(t), group: groupOf(t) }))
        .filter((p): p is { id: string; coord: [number, number]; group: BrowseGroup } => !!p.coord),
    [trips],
  );

  /**
   * Frame every pin once the set changes.
   *
   * `fitBounds` here takes an EDGE INSET (`top`/`right`/…), not the
   * `CameraPadding` spelling — mixing those up is what left every overview fit
   * in this app unpadded for months. See useMapCamera's `applyPlan`.
   */
  const fitAll = useCallback(() => {
    if (pins.length === 0) return;
    cameraRef.current?.fitBounds?.(
      pins.map((p) => p.coord),
      { top: 48, bottom: 48, left: 48, right: 48 },
      true,
    );
  }, [pins]);

  React.useEffect(() => {
    // One frame late: the camera is only attached once the map has a real size
    // (see MapReadyContext), and a fit issued before that is dropped.
    const t = setTimeout(fitAll, 60);
    return () => clearTimeout(t);
  }, [fitAll]);

  React.useEffect(() => {
    if (!selectedId) return;
    const pin = pins.find((p) => p.id === selectedId);
    if (!pin) return;
    cameraRef.current?.setCamera?.({
      centerCoordinate: pin.coord,
      zoomLevel: 14.5,
      animationDuration: 420,
    });
  }, [selectedId, pins]);

  return (
    <View style={[s.mapWrap, { height }]}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={mapStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
      >
        <Camera ref={cameraRef} maxBounds={GHANA_BOUNDS} minZoom={GHANA_MIN_ZOOM} />
        {pins.map((p) => {
          const isSel = p.id === selectedId;
          const accent = p.group === 'boarding' ? BOARDING_ACCENT : colors.primary;
          return (
            <MapboxGL.MarkerView key={p.id} id={`trip-${p.id}`} coordinate={p.coord} anchor="bottom">
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  onSelect(p.id);
                }}
                // A pin is a 26 pt bubble; the tap target around it is 44.
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Select this ride"
              >
                <View style={s.pin}>
                  <View
                    style={[
                      s.pinBubble,
                      { borderColor: accent, backgroundColor: isSel ? accent : colors.surfaceCard },
                      isSel && s.pinBubbleSelected,
                    ]}
                  >
                    <Ionicons
                      name="bus"
                      size={13}
                      color={isSel ? colors.onPrimary : accent}
                    />
                  </View>
                  <View style={[s.pinTail, { borderTopColor: accent }]} />
                </View>
              </Pressable>
            </MapboxGL.MarkerView>
          );
        })}
      </MapView>

      {/* Back to all of them, after the rider has flown to one. */}
      {selectedId && (
        <Pressable onPress={fitAll} style={s.fitAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="Show every ride">
          <Ionicons name="scan-outline" size={16} color={colors.onSurface} />
        </Pressable>
      )}
    </View>
  );
}

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ group?: string }>();
  const initialGroup = parseGroup(params.group);
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const [filter, setFilter] = useState<BrowseGroup>(initialGroup);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<FlashListRef<any>>(null);

  const { data, isLoading } = useQuery({
    // The SAME key the home screen uses, so opening this page reuses the rows
    // already in cache and paints instantly instead of re-fetching what the
    // rider is looking at.
    queryKey: queryKeys.rides.list({ status: 'OPEN' }),
    queryFn: () => tripsApi.search({ status: 'OPEN' } as any),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const allTrips: any[] = useMemo(() => {
    const raw = (data as any)?.data?.data?.trips ?? (data as any)?.data?.trips ?? (data as any)?.trips ?? [];
    return Array.isArray(raw) ? [...raw].sort(byDeparture) : [];
  }, [data]);

  const counts = useMemo(() => {
    const c: Record<BrowseGroup, number> = { all: allTrips.length, boarding: 0, scheduled: 0, suggested: 0 };
    for (const t of allTrips) c[groupOf(t)] += 1;
    return c;
  }, [allTrips]);

  const trips = useMemo(
    () => (filter === 'all' ? allTrips : allTrips.filter((t) => groupOf(t) === filter)),
    [allTrips, filter],
  );

  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id);
      const idx = trips.findIndex((t) => String(t.id) === id);
      if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
    },
    [trips],
  );

  const copy = GROUP_COPY[filter];
  const mapHeight = Math.round(screenH * MAP_FRACTION);

  return (
    <SmoothScreen
      style={{ backgroundColor: colors.backgroundDeep }}
      placeholder={
        <View style={[s.placeholder, { paddingTop: insets.top + 64 }]}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={ROW_HEIGHT - 12} borderRadius={radii.xl} />
          ))}
        </View>
      }
    >
      <View style={s.root}>
        {/* The map is the header. Deferred so the push animation gets the frame
            budget — a MapLibre surface coming up mid-transition is the single
            most expensive thing this screen does. */}
        <SmoothDefer placeholder={<View style={[s.mapWrap, { height: mapHeight, backgroundColor: colors.surfaceContainer }]} />}>
          <BrowseMap
            trips={trips}
            selectedId={selectedId}
            onSelect={selectFromMap}
            height={mapHeight}
            colors={colors}
            s={s}
          />
        </SmoothDefer>

        <Pressable
          onPress={() => goBack('/(tabs)/home')}
          style={[s.back, { top: insets.top + 8 }]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={19} color={colors.onSurface} />
        </Pressable>

        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title} numberOfLines={1}>{copy.title}</Text>
            <Text style={s.subtitle} numberOfLines={1}>{copy.subtitle}</Text>
          </View>

          {/* Filters. Counts on the chips so the rider can see where the rides
              are without switching to find out. */}
          <View style={s.filters}>
            {BROWSE_GROUPS.map((g) => {
              const on = g === filter;
              const n = counts[g];
              if (g !== 'all' && n === 0) return null;
              return (
                <Pressable
                  key={g}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    setFilter(g);
                    setSelectedId(null);
                  }}
                  style={[s.filterChip, on && { backgroundColor: colors.onSurface, borderColor: colors.onSurface }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${GROUP_COPY[g].title}, ${n}`}
                >
                  <Text style={[s.filterText, on && { color: colors.background }]} numberOfLines={1}>
                    {g === 'all' ? 'All' : GROUP_COPY[g].title}
                  </Text>
                  <Text style={[s.filterCount, on && { color: colors.background, opacity: 0.7 }]}>{n}</Text>
                </Pressable>
              );
            })}
          </View>

          <BrowseList
            listRef={listRef}
            trips={trips}
            loading={isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            colors={colors}
            s={s}
            bottomInset={insets.bottom + 16}
          />
        </View>
      </View>
    </SmoothScreen>
  );
}

/** Split out so the stagger can read `useSmoothScreen` below the provider. */
function BrowseList({
  listRef,
  trips,
  loading,
  selectedId,
  onSelect,
  colors,
  s,
  bottomInset,
}: {
  listRef: React.RefObject<FlashListRef<any> | null>;
  trips: any[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  colors: Colors;
  s: ReturnType<typeof makeStyles>;
  bottomInset: number;
}) {
  const { settled } = useSmoothScreen();

  if (loading) {
    return (
      <View style={s.listPad}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={ROW_HEIGHT - 12} borderRadius={radii.xl} />
        ))}
      </View>
    );
  }

  if (trips.length === 0) {
    return (
      <View style={s.empty}>
        <Ionicons name="bus-outline" size={34} color={colors.outline} />
        <Text style={s.emptyText}>No rides in this group right now</Text>
        <Text style={s.emptyHint}>Try another filter, or pull down on Home to refresh.</Text>
      </View>
    );
  }

  return (
    <FlashList
      ref={listRef}
      data={trips}
      keyExtractor={(t: any, i: number) => String(t?.id ?? i)}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomInset }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item, index }: { item: any; index: number }) => (
        // Only the first screenful staggers — a cascade thirty rows deep is a
        // queue, not a flourish. See SmoothIn's maxDelay.
        <SmoothIn index={settled ? Math.min(index, 6) : 0} style={{ marginBottom: 12 }}>
          <TripRow
            trip={item}
            selected={String(item?.id) === selectedId}
            onPress={() => {
              onSelect(String(item?.id));
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              goDeeper(`/ride/${item.id}`);
            }}
            colors={colors}
            s={s}
          />
        </SmoothIn>
      )}
    />
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep },
    placeholder: { flex: 1, paddingHorizontal: spacing.lg, gap: 12 },

    mapWrap: { width: '100%', overflow: 'hidden' },
    back: {
      position: 'absolute',
      left: spacing.lg,
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.22,
      shadowRadius: 6,
      elevation: 5,
    },
    fitAll: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },

    pin: { alignItems: 'center' },
    pinBubble: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pinBubbleSelected: {
      width: 32,
      height: 32,
      borderRadius: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 6,
    },
    pinTail: {
      width: 0,
      height: 0,
      borderLeftWidth: 4.5,
      borderRightWidth: 4.5,
      borderTopWidth: 6,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      marginTop: -1,
    },

    /* The sheet lifts over the map's bottom edge — the standard "list under a
       map" join, and what stops the two halves reading as separate screens. */
    sheet: {
      flex: 1,
      marginTop: -18,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.backgroundDeep,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
      paddingTop: spacing.lg,
    },
    head: { paddingHorizontal: spacing.lg, gap: 2 },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineSmall,
      lineHeight: Math.round(fontSizes.headlineSmall * 1.15),
      letterSpacing: -0.5,
      color: colors.onSurface,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
    },

    filters: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      // 36 pt tall with the padding — comfortably inside a 44 pt row target.
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    filterText: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.onSurface },
    filterCount: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      color: colors.onSurfaceVariant,
      fontVariant: ['tabular-nums'],
    },

    listPad: { paddingHorizontal: spacing.lg, gap: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      height: ROW_HEIGHT - 12,
      borderRadius: radii.xl,
      overflow: 'hidden',
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
    },
    rowRail: { width: 3.5, alignSelf: 'stretch' },
    rowBody: { flex: 1, paddingHorizontal: spacing.base, gap: 1, justifyContent: 'center' },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowWhen: { fontFamily: fonts.labelCaps, fontSize: 9.5, lineHeight: 12, letterSpacing: 1 },
    rowSeats: {
      fontFamily: fonts.medium,
      fontSize: 10.5,
      color: colors.onSurfaceVariant,
      fontVariant: ['tabular-nums'],
    },
    rowDest: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.25),
      color: colors.onSurface,
    },
    rowFrom: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.onSurfaceVariant },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: spacing.base },
    rowFare: {
      fontFamily: fonts.bold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      fontVariant: ['tabular-nums'],
    },

    empty: { alignItems: 'center', gap: 8, paddingTop: spacing['3xl'], paddingHorizontal: spacing['2xl'] },
    emptyText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    emptyHint: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
    },
  });
