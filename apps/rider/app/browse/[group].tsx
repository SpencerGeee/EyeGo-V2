import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';

import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';
import { Text, Button, Skeleton, SmoothScreen, SmoothDefer, goDeeper, goBack, notify, usePanelMotion, type PanelState } from '@eyego/ui';
import { formatGhs, describeError } from '@eyego/utils';
import { bookingsApi, queryKeys, tripsApi } from '@eyego/api';
import {
  MapView,
  Camera,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  MarkerView,
  RiderLocation3D,
  GHANA_BOUNDS,
  GHANA_MIN_ZOOM,
  type CameraRef,
} from '@eyego/maps';
import mapStyles from '@eyego/map-styles';

import { useColors, type Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';
import { useAuthStore } from '../../stores/auth.store';
import { useTripFlow } from '../../stores/tripFlow.store';
import { searchPlaces, type GeocodeResult } from '../../utils/geocoding';
import { registerForPushNotifications } from '../../utils/notifications';
import { seedPickupAt } from '../../utils/journey';
import {
  BOARDING_ACCENT,
  BROWSE_GROUPS,
  GROUP_COPY,
  type BrowseGroup,
  byDeparture,
  clockTime,
  departureLabel,
  departureOf,
  destinationName,
  groupOf,
  haversineKm,
  originName,
  seatsLeft,
  tripDestination,
  tripOrigin,
  vehicleLabel,
  walkLabel,
} from '../../utils/tripGroups';

/**
 * BROWSE — EVERY SHARED RIDE A DRIVER HAS OPENED, ON A MAP.
 *
 * Uber/Bolt "explore" layout: the map is the screen, the list is a sheet over
 * it with three stops (peek / half / full). Pins cluster natively, so thirty
 * buses at Circle read as one "30" bubble instead of thirty overlapping views.
 *
 *  - "Where to?" filters by text as you type and offers real places; picking
 *    one filters by distance (destination or any stop within 3 km).
 *  - Boarding-now trips (driver at the kerb, filling) get their own strip.
 *  - Sort: soonest / nearest pickup / cheapest. Full trips sink to the end.
 *  - Nothing matching? "Notify me" watches that destination for 24 h, or
 *    request a car now, or schedule.
 *
 * Only the sheet HEADER drags the sheet; the list scrolls on its own in every
 * stop and pads its bottom by whatever the sheet hides below the screen, so
 * every row stays reachable at half and peek.
 */

type Sort = 'soonest' | 'nearest' | 'cheapest';
type LatLng = { lat: number; lng: number };
type Place = { name: string; fullAddress: string; latitude: number; longitude: number };

const ACCRA: [number, number] = [-0.187, 5.6037];
const PLACE_RADIUS_KM = 3;
const STRIP_CARD_W = 232;
const SORTS: { id: Sort; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'soonest', label: 'Soonest', icon: 'time-outline' },
  { id: 'nearest', label: 'Nearest', icon: 'navigate-outline' },
  { id: 'cheapest', label: 'Cheapest', icon: 'pricetag-outline' },
];

function parseGroup(raw: string | string[] | undefined): BrowseGroup {
  const g = Array.isArray(raw) ? raw[0] : raw;
  return (BROWSE_GROUPS as readonly string[]).includes(g ?? '') ? (g as BrowseGroup) : 'all';
}

const stopsOf = (trip: any): any[] => (Array.isArray(trip?.route?.virtualStops) ? trip.route.virtualStops : []);

function matchesText(trip: any, q: string): boolean {
  const hay = [destinationName(trip), originName(trip), ...stopsOf(trip).map((s) => s?.name)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function goesNear(trip: any, place: Place): boolean {
  const p = { lat: place.latitude, lng: place.longitude };
  const d = tripDestination(trip);
  if (d && haversineKm({ lat: d[1], lng: d[0] }, p) <= PLACE_RADIUS_KM) return true;
  return stopsOf(trip).some(
    (s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng) && haversineKm({ lat: s.lat, lng: s.lng }, p) <= PLACE_RADIUS_KM,
  );
}

const isFull = (t: any) => seatsLeft(t) === 0;
const isBoardingOpen = (t: any) => groupOf(t) === 'boarding' && !isFull(t);

// ── Map ─────────────────────────────────────────────────────────────────────

function BrowseMap({
  trips,
  selected,
  onSelect,
  onOpen,
  userLoc,
  cameraRef,
  fitKey,
  onFit,
  colors,
  s,
}: {
  trips: any[];
  selected: any | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  userLoc: LatLng | null;
  cameraRef: React.RefObject<CameraRef | null>;
  /** The set of trips on the map; the camera refits when it changes. */
  fitKey: string;
  onFit: () => void;
  colors: Colors;
  s: Styles;
}) {
  // Same two styles every other map in this app uses.
  const isDark = useThemeStore((st) => st.isDark);
  const mapStyle = isDark ? mapStyles.eyegoDarkStyle : mapStyles.eyegoLightStyle;
  const sourceRef = useRef<{ getClusterExpansionZoom: (id: number) => Promise<number> } | null>(null);

  // Here, not in the screen: this component mounts late (SmoothDefer), and a
  // fit issued before the Camera exists goes nowhere. Keyed on the SET of
  // trips, so a 15 s refetch with the same ids never yanks a panned map.
  const fitRef = useRef(onFit);
  fitRef.current = onFit;
  useEffect(() => {
    const t = setTimeout(() => fitRef.current(), 80);
    return () => clearTimeout(t);
  }, [fitKey]);

  const shape = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: trips.flatMap((t) => {
        const c = tripOrigin(t);
        return c
          ? [{
              type: 'Feature',
              id: String(t.id),
              properties: { id: String(t.id), boarding: groupOf(t) === 'boarding' ? 1 : 0 },
              geometry: { type: 'Point', coordinates: c },
            }]
          : [];
      }),
    }),
    [trips],
  );

  const onPress = useCallback(
    async (e: { nativeEvent: { features: any[] } }) => {
      const f = e?.nativeEvent?.features?.[0];
      const props = f?.properties ?? {};
      const coord = f?.geometry?.coordinates;
      if (props.point_count != null || props.cluster) {
        if (!Array.isArray(coord) || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;
        let zoom = 14;
        try {
          const z = await sourceRef.current?.getClusterExpansionZoom(Number(props.cluster_id));
          if (Number.isFinite(z)) zoom = Number(z);
        } catch {
          // Native lookup failed: a fixed step in is still the right gesture.
        }
        void Haptics.selectionAsync().catch(() => {});
        cameraRef.current?.setCamera({ centerCoordinate: [coord[0], coord[1]], zoomLevel: Math.min(zoom + 0.4, 16), animationDuration: 450 });
        return;
      }
      if (props.id) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onSelect(String(props.id));
      }
    },
    [cameraRef, onSelect],
  );

  const selCoord = selected ? tripOrigin(selected) : null;
  const selAccent = selected && groupOf(selected) === 'boarding' ? BOARDING_ACCENT : colors.primary;
  const selFare = selected?.farePerSeatPesewas;

  return (
    <MapView
      style={StyleSheet.absoluteFillObject}
      styleURL={mapStyle}
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled={false}
      pitchEnabled={false}
    >
      <Camera ref={cameraRef} centerCoordinate={ACCRA} zoomLevel={11} maxBounds={GHANA_BOUNDS} minZoom={GHANA_MIN_ZOOM} />
      {userLoc && <RiderLocation3D coordinate={[userLoc.lng, userLoc.lat]} color={colors.statusInfo} />}
      <ShapeSource
        id="browse-trips"
        ref={sourceRef}
        shape={shape}
        cluster
        clusterRadius={46}
        clusterMaxZoom={13}
        onPress={onPress}
        hitbox={{ top: 14, right: 14, bottom: 14, left: 14 }}
      >
        <CircleLayer
          id="browse-clusters"
          filter={['has', 'point_count']}
          style={{
            circleColor: colors.onSurface,
            circleOpacity: 0.92,
            circleRadius: ['step', ['get', 'point_count'], 15, 5, 18, 15, 22],
            circleStrokeWidth: 3,
            circleStrokeColor: withOpacity(colors.onSurface, 0.25),
          }}
        />
        <SymbolLayer
          id="browse-cluster-count"
          filter={['has', 'point_count']}
          textField={['get', 'point_count_abbreviated']}
          textColor={colors.background}
          textSize={13}
        />
        <CircleLayer
          id="browse-points"
          filter={['!', ['has', 'point_count']]}
          style={{
            circleColor: ['case', ['==', ['get', 'boarding'], 1], BOARDING_ACCENT, colors.primary],
            circleOpacity: 1,
            circleRadius: 7,
            circleStrokeWidth: 2.5,
            circleStrokeColor: '#FFFFFF',
          }}
        />
      </ShapeSource>
      {selCoord && (
        <MarkerView coordinate={selCoord} anchor="bottom">
          <Pressable
            onPress={() => onOpen(String(selected.id))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Open the ride to ${destinationName(selected)}`}
          >
            <View style={s.pricePin}>
              <View style={[s.pricePinBody, { backgroundColor: selAccent }]}>
                <Ionicons name="bus" size={12} color={selAccent === colors.primary ? colors.onPrimary : '#0A0A0B'} />
                <Text
                  style={[s.pricePinText, selAccent === colors.primary && { color: colors.onPrimary }]}
                  numberOfLines={1}
                >
                  {typeof selFare === 'number' ? formatGhs(selFare) : 'Ride'}
                </Text>
              </View>
              <View style={[s.pricePinTail, { borderTopColor: selAccent }]} />
            </View>
          </Pressable>
        </MarkerView>
      )}
    </MapView>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

function SeatDots({ total, left, accent, colors, s }: { total: number | null; left: number | null; accent: string; colors: Colors; s: Styles }) {
  if (total == null || left == null || total <= 0) return null;
  const free = Math.max(0, Math.min(total, left));
  if (total > 10) {
    return (
      <View style={[s.seatBar, { backgroundColor: withOpacity(colors.onSurface, 0.12) }]}>
        <View style={{ width: `${(free / total) * 100}%`, height: '100%', borderRadius: 2, backgroundColor: accent }} />
      </View>
    );
  }
  const taken = total - free;
  return (
    <View style={s.seatDots}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[s.seatDot, { backgroundColor: i < taken ? withOpacity(colors.onSurface, 0.2) : accent }]} />
      ))}
    </View>
  );
}

const TripRow = React.memo(function TripRow({
  trip,
  selected,
  mine,
  walkKm,
  onPress,
  colors,
  s,
}: {
  trip: any;
  selected: boolean;
  mine: boolean;
  walkKm: number | null;
  /** Re-render tick for the countdown — not read, only compared. */
  now: number;
  onPress: (id: string) => void;
  colors: Colors;
  s: Styles;
}) {
  const accent = groupOf(trip) === 'boarding' ? BOARDING_ACCENT : colors.primary;
  const left = seatsLeft(trip);
  const total = Number.isFinite(trip?.maxSeats) ? Number(trip.maxSeats) : null;
  const full = left === 0;
  const fare = trip?.farePerSeatPesewas;
  const rating = trip?.driver?.rating;
  const vehicle = vehicleLabel(trip);
  const label = departureLabel(trip);
  const at = departureOf(trip);
  const when = at && label.startsWith('Leaves in') ? `${label} · ${clockTime(at)}` : label;

  const press = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.015 }] }));

  return (
    <Animated.View style={[pressStyle, full && { opacity: 0.55 }]}>
      <Pressable
        onPress={() => onPress(String(trip.id))}
        onPressIn={() => { press.value = withSpring(1, springs.press); }}
        onPressOut={() => { press.value = withSpring(0, springs.press); }}
        accessibilityRole="button"
        accessibilityLabel={[
          `Ride to ${destinationName(trip)}`,
          when,
          typeof fare === 'number' ? `${formatGhs(fare)} a seat` : null,
          full ? 'full' : left != null ? `${left} seat${left === 1 ? '' : 's'} left` : null,
        ].filter(Boolean).join(', ')}
        style={[s.row, selected && { borderColor: withOpacity(accent, 0.75), backgroundColor: colors.surfaceContainerHigh }]}
      >
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Text style={[s.rowWhen, { color: accent }]} numberOfLines={1}>
              {when.toUpperCase()}
            </Text>
            {mine && (
              <View style={[s.mineTag, { borderColor: withOpacity(colors.primary, 0.5) }]}>
                <Text style={[s.mineTagText, { color: colors.primary }]}>YOUR SEAT</Text>
              </View>
            )}
          </View>
          <Text style={s.rowDest} numberOfLines={1}>
            {destinationName(trip)}
          </Text>
          <Text style={s.rowFrom} numberOfLines={1}>
            from {originName(trip)}
            {walkKm != null ? ` · ${walkLabel(walkKm)}` : ''}
          </Text>
          <View style={s.rowMeta}>
            {typeof rating === 'number' ? (
              <>
                <Ionicons name="star" size={11} color={BOARDING_ACCENT} />
                <Text style={s.metaStrong}>{rating.toFixed(1)}</Text>
              </>
            ) : (
              <Text style={s.metaStrong}>New driver</Text>
            )}
            {vehicle ? (
              <Text style={s.metaText} numberOfLines={1}>
                {'  ·  '}
                {vehicle}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.rowSide}>
          {typeof fare === 'number' && (
            <Text style={s.rowFare} numberOfLines={1}>
              {formatGhs(fare)}
            </Text>
          )}
          <Text style={s.rowPer}>per seat</Text>
          <SeatDots total={total} left={left} accent={accent} colors={colors} s={s} />
          {left != null && (
            <Text style={[s.rowSeats, full && { color: colors.error }]} numberOfLines={1}>
              {full ? 'Full' : total != null && total > 10 ? `${left} of ${total} left` : `${left} left`}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

function BoardingCard({
  trip,
  selected,
  walkKm,
  onOpen,
  s,
}: {
  trip: any;
  selected: boolean;
  walkKm: number | null;
  onOpen: (id: string) => void;
  s: Styles;
}) {
  const left = seatsLeft(trip);
  const fare = trip?.farePerSeatPesewas;
  return (
    <Pressable
      onPress={() => onOpen(String(trip.id))}
      accessibilityRole="button"
      accessibilityLabel={`Boarding now to ${destinationName(trip)}${typeof fare === 'number' ? `, ${formatGhs(fare)} a seat` : ''}. Reserve.`}
      style={[s.card, selected && { borderColor: withOpacity(BOARDING_ACCENT, 0.8) }]}
    >
      <View style={s.cardTop}>
        <View style={s.liveDot} />
        <Text style={s.cardLive} numberOfLines={1}>
          BOARDING{left != null ? ` · ${left} LEFT` : ''}
        </Text>
      </View>
      <Text style={s.cardDest} numberOfLines={1}>
        {destinationName(trip)}
      </Text>
      <Text style={s.cardFrom} numberOfLines={1}>
        from {originName(trip)}
        {walkKm != null ? ` · ${walkLabel(walkKm)}` : ''}
      </Text>
      <View style={s.cardBottom}>
        <Text style={s.cardFare} numberOfLines={1}>
          {typeof fare === 'number' ? formatGhs(fare) : ''}
          <Text style={s.cardPer}>{typeof fare === 'number' ? ' /seat' : ''}</Text>
        </Text>
        <View style={s.reserve}>
          <Text style={s.reserveText}>Reserve</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ group?: string }>();
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const [filter, setFilter] = useState<BrowseGroup>(() => parseGroup(params.group));
  const [sort, setSort] = useState<Sort>('soonest');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [alertState, setAlertState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [now, setNow] = useState(() => Date.now());

  const listRef = useRef<FlashListRef<any>>(null);
  const stripRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const cameraRef = useRef<CameraRef | null>(null);

  // ── sheet geometry: three stops, measured from the top of the screen ──────
  const fullY = insets.top + 56;
  const halfY = Math.round(screenH * 0.44);
  const peekY = screenH - (insets.bottom + 176);
  const sheetH = screenH - fullY;
  const [sheetState, setSheetState] = useState<PanelState>('collapsed');
  const { panGesture, sheetStyle, snapToState } = usePanelMotion({
    snapPoints: { hidden: peekY, collapsed: halfY, expanded: fullY },
    initialState: 'collapsed',
    // "dismissible" here only means the lowest stop is reachable: `hidden` is
    // the peek, not off-screen.
    dismissible: true,
    onStateChange: setSheetState,
  });
  // Vertical drags only — the chip row inside the header scrolls sideways.
  const sheetPan = useMemo(() => panGesture.activeOffsetY([-6, 6]).failOffsetX([-14, 14]), [panGesture]);
  const sheetTop = sheetState === 'expanded' ? fullY : sheetState === 'collapsed' ? halfY : peekY;
  const hiddenBelow = sheetTop - fullY;
  const visibleSheet = screenH - sheetTop;

  // ── data ──────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    // The SAME key the home screen uses, so this page paints from cache.
    queryKey: queryKeys.rides.list({ status: 'OPEN' }),
    queryFn: () => tripsApi.search({ status: 'OPEN' } as any),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const { data: activeBookings } = useQuery({
    queryKey: ['bookings', 'active'],
    queryFn: () => (bookingsApi as any).getActive?.() ?? Promise.resolve([]),
    staleTime: 30_000,
  });
  const myTripId: string | null = (activeBookings as any)?.data?.data?.booking?.tripId ?? null;

  const allTrips: any[] = useMemo(() => {
    const raw = (data as any)?.data?.data?.trips ?? (data as any)?.data?.trips ?? (data as any)?.trips ?? [];
    return Array.isArray(raw) ? [...raw].sort(byDeparture) : [];
  }, [data]);

  // Countdowns move on their own.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Location only if already granted — "Nearest" asks when tapped.
  const locate = useCallback(async (ask: boolean): Promise<LatLng | null> => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && ask && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return null;
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLoc(here);
      return here;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void locate(false);
  }, [locate]);

  // Place suggestions, debounced, latest answer wins.
  const suggestSeq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!focused || place || q.length < 2) {
      setSuggestions([]);
      setSuggesting(false);
      return;
    }
    const seq = ++suggestSeq.current;
    setSuggesting(true);
    const t = setTimeout(async () => {
      const found = await searchPlaces(q, 4, userLoc ? { latitude: userLoc.lat, longitude: userLoc.lng } : null).catch(() => []);
      if (seq !== suggestSeq.current) return;
      setSuggestions(found);
      setSuggesting(false);
    }, 350);
    return () => clearTimeout(t);
  }, [query, focused, place, userLoc]);

  const pickupKm = useMemo(() => {
    const m = new Map<string, number>();
    if (!userLoc) return m;
    for (const t of allTrips) {
      const o = tripOrigin(t);
      if (o) m.set(String(t.id), haversineKm(userLoc, { lat: o[1], lng: o[0] }));
    }
    return m;
  }, [allTrips, userLoc]);

  const searched = useMemo(() => {
    if (place) return allTrips.filter((t) => goesNear(t, place));
    const q = query.trim();
    return q ? allTrips.filter((t) => matchesText(t, q)) : allTrips;
  }, [allTrips, place, query]);

  const counts = useMemo(() => {
    const c: Record<BrowseGroup, number> = { all: searched.length, boarding: 0, scheduled: 0, suggested: 0 };
    for (const t of searched) c[groupOf(t)] += 1;
    return c;
  }, [searched]);

  const visible = useMemo(() => {
    const list = filter === 'all' ? searched : searched.filter((t) => groupOf(t) === filter);
    const num = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const cmp = (a: number | null, b: number | null) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : a - b);
    return [...list].sort((a, b) => {
      const full = Number(isFull(a)) - Number(isFull(b));
      if (full) return full;
      if (sort === 'nearest') {
        const d = cmp(num(pickupKm.get(String(a.id))), num(pickupKm.get(String(b.id))));
        if (d) return d;
      } else if (sort === 'cheapest') {
        const d = cmp(num(a?.farePerSeatPesewas), num(b?.farePerSeatPesewas));
        if (d) return d;
      }
      return byDeparture(a, b);
    });
  }, [searched, filter, sort, pickupKm]);

  // The urgency strip: buses at the kerb right now. Only on the unfiltered
  // board, and only when there is also a list for it to sit above.
  const strip = useMemo(() => {
    if (filter !== 'all' || place || query.trim()) return [];
    const boarding = visible.filter(isBoardingOpen);
    return boarding.length > 0 && boarding.length < visible.length ? boarding.slice(0, 8) : [];
  }, [visible, filter, place, query]);
  const rows = useMemo(() => {
    if (!strip.length) return visible;
    const inStrip = new Set(strip.map((t) => String(t.id)));
    return visible.filter((t) => !inStrip.has(String(t.id)));
  }, [visible, strip]);

  const selected = useMemo(() => visible.find((t) => String(t.id) === selectedId) ?? null, [visible, selectedId]);

  // ── camera ────────────────────────────────────────────────────────────────
  const fitAll = useCallback(() => {
    const coords = visible.map(tripOrigin).filter((c): c is [number, number] => !!c);
    if (!coords.length) return;
    // Edge inset spelling (top/bottom/…) — see the fitBounds padding contract.
    cameraRef.current?.fitBounds(coords, { top: insets.top + 72, bottom: visibleSheet + 32, left: 48, right: 48 }, true);
  }, [visible, insets.top, visibleSheet]);

  const pinKey = useMemo(() => visible.map((t) => String(t.id)).join(','), [visible]);

  // ── actions ───────────────────────────────────────────────────────────────
  const openTrip = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedId(id);
    goDeeper(`/ride/${id}`);
  }, []);

  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id);
      const trip = visible.find((t) => String(t.id) === id);
      const coord = trip ? tripOrigin(trip) : null;
      if (coord) {
        cameraRef.current?.setCamera({
          centerCoordinate: coord,
          zoomLevel: 14.5,
          animationDuration: 420,
          padding: { paddingTop: insets.top + 56, paddingBottom: Math.max(visibleSheet, screenH - halfY) },
        });
      }
      if (sheetState !== 'expanded' && sheetState !== 'collapsed') snapToState('collapsed');
      const stripIdx = strip.findIndex((t) => String(t.id) === id);
      if (stripIdx >= 0) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        stripRef.current?.scrollTo({ x: Math.max(0, stripIdx * (STRIP_CARD_W + 12) - 16), animated: true });
        return;
      }
      const idx = rows.findIndex((t) => String(t.id) === id);
      if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.15 });
    },
    [visible, strip, rows, insets.top, visibleSheet, screenH, halfY, sheetState, snapToState],
  );

  const cycleSheet = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    snapToState(sheetState === 'collapsed' ? 'expanded' : 'collapsed');
  }, [sheetState, snapToState]);

  const changeFilter = useCallback((g: BrowseGroup) => {
    void Haptics.selectionAsync().catch(() => {});
    setFilter(g);
    setSelectedId(null);
  }, []);

  const changeSort = useCallback(
    async (next: Sort) => {
      void Haptics.selectionAsync().catch(() => {});
      if (next === 'nearest' && !userLoc) {
        const here = await locate(true);
        if (!here) {
          notify('Location is off', 'Turn on location to sort rides by how close their pickup is.', {
            tone: 'warning',
            action: { label: 'Settings', onPress: () => void Linking.openSettings() },
          });
          return;
        }
      }
      setSort(next);
      setSelectedId(null);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    },
    [userLoc, locate],
  );

  const pickPlace = useCallback((r: GeocodeResult) => {
    void Haptics.selectionAsync().catch(() => {});
    setPlace({ name: r.name, fullAddress: r.fullAddress, latitude: r.latitude, longitude: r.longitude });
    setQuery(r.name);
    setSelectedId(null);
    setAlertState('idle');
    Keyboard.dismiss();
    inputRef.current?.blur();
  }, []);

  const clearSearch = useCallback(() => {
    setQuery('');
    setPlace(null);
    setSuggestions([]);
    setSelectedId(null);
    setAlertState('idle');
  }, []);

  const notifyMe = useCallback(async () => {
    if (!place || alertState !== 'idle') return;
    setAlertState('saving');
    try {
      await tripsApi.createTripAlert({
        destinationName: place.name,
        destinationLat: place.latitude,
        destinationLng: place.longitude,
        ...(userLoc ? { originLat: userLoc.lat, originLng: userLoc.lng } : {}),
      });
      setAlertState('saved');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // The alert is useless without a way to reach the phone.
      await registerForPushNotifications(useAuthStore.getState().accessToken ?? undefined).catch(() => null);
      const { granted } = await Notifications.getPermissionsAsync().catch(() => ({ granted: false }));
      if (granted) {
        notify('You’re on the list', `We’ll tell you the moment a ride to ${place.name} opens. Watching for 24 hours.`, { tone: 'success' });
      } else {
        notify('Saved, but notifications are off', 'Turn them on so we can tell you when a ride opens.', {
          tone: 'warning',
          action: { label: 'Settings', onPress: () => void Linking.openSettings() },
        });
      }
    } catch (err) {
      setAlertState('idle');
      const e = describeError(err, 'We couldn’t save that. Try again.');
      notify(e.title, e.message);
    }
  }, [place, alertState, userLoc]);

  /**
   * AS IF THE RIDER HAD SEARCHED IT ON WHERE-TO.
   *
   * BUGFIX ("I tapped Notify me, then Request a ride now, and it just took me
   * to the Where-To page"). The place they had just looked up was dropped and
   * they typed it again. It travels as route params because opening the
   * surface re-seeds the flow store (which would wipe a searchPlace set here);
   * with a known position the pickup is seeded too and the rider lands
   * straight on the ride options.
   */
  const requestNow = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!place) {
      goDeeper('/trip?stage=search' as any);
      return;
    }
    if (userLoc) void seedPickupAt(userLoc.lat, userLoc.lng);
    goDeeper({
      pathname: '/trip',
      params: {
        stage: userLoc ? 'configure' : 'search',
        destName: place.name,
        destAddress: place.fullAddress,
        destLat: String(place.latitude),
        destLng: String(place.longitude),
      },
    } as any);
  }, [place, userLoc]);

  const scheduleLater = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // The schedule screen seeds its destination from the flow store.
    if (place) useTripFlow.getState().setSearchPlace({ ...place });
    goDeeper('/ride/schedule' as any);
  }, [place]);

  // ── render ────────────────────────────────────────────────────────────────
  const copy = GROUP_COPY[filter];
  const boardingCount = counts.boarding;
  const laterCount = counts.scheduled;
  const subtitle = isLoading
    ? 'Finding rides…'
    : searched.length === 0
      ? 'Nothing open yet'
      : [boardingCount ? `${boardingCount} boarding` : null, laterCount ? `${laterCount} later` : null].filter(Boolean).join(' · ') ||
        `${searched.length} ride${searched.length === 1 ? '' : 's'}`;
  const showSuggestions = focused && !place && query.trim().length >= 2;
  const listPadBottom = insets.bottom + 24 + hiddenBelow;

  const header = strip.length ? (
    <View style={s.stripWrap}>
      <View style={s.stripHead}>
        <View style={s.liveDot} />
        <Text style={s.stripTitle}>Boarding now</Text>
        <Text style={s.stripHint}>Driver is at the pickup, filling seats</Text>
      </View>
      <ScrollView
        ref={stripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.stripRow}
        decelerationRate="fast"
        snapToInterval={STRIP_CARD_W + 12}
      >
        {strip.map((t) => (
          <BoardingCard
            key={String(t.id)}
            trip={t}
            selected={String(t.id) === selectedId}
            walkKm={pickupKm.get(String(t.id)) ?? null}
            onOpen={openTrip}
            s={s}
          />
        ))}
      </ScrollView>
      {rows.length > 0 && <Text style={s.sectionLabel}>LATER</Text>}
    </View>
  ) : null;

  let body: React.ReactNode;
  if (showSuggestions) {
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: listPadBottom }}>
        <Pressable
          onPress={() => { Keyboard.dismiss(); inputRef.current?.blur(); }}
          style={s.suggestion}
          accessibilityRole="button"
          accessibilityLabel={`Show rides matching ${query.trim()}`}
        >
          <View style={s.suggestionIcon}>
            <Ionicons name="search" size={16} color={colors.onSurface} />
          </View>
          <View style={s.suggestionText}>
            <Text style={s.suggestionName} numberOfLines={1}>Rides matching “{query.trim()}”</Text>
            <Text style={s.suggestionAddr} numberOfLines={1}>
              {searched.length ? `${searched.length} on the board` : 'None on the board yet'}
            </Text>
          </View>
        </Pressable>
        {suggestions.map((r) => (
          <Pressable
            key={`${r.placeId}-${r.latitude}-${r.longitude}`}
            onPress={() => pickPlace(r)}
            style={s.suggestion}
            accessibilityRole="button"
            accessibilityLabel={`Rides to ${r.name}`}
          >
            <View style={s.suggestionIcon}>
              <Ionicons name="location-outline" size={16} color={colors.onSurface} />
            </View>
            <View style={s.suggestionText}>
              <Text style={s.suggestionName} numberOfLines={1}>{r.name}</Text>
              <Text style={s.suggestionAddr} numberOfLines={1}>{r.fullAddress}</Text>
            </View>
          </Pressable>
        ))}
        {suggesting && suggestions.length === 0 && <Text style={s.suggestHint}>Looking up places…</Text>}
      </ScrollView>
    );
  } else if (isLoading && !allTrips.length) {
    body = (
      <View style={s.listPad}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={104} borderRadius={radii.xl} />
        ))}
      </View>
    );
  } else if (isError && !allTrips.length) {
    body = (
      <View style={s.empty}>
        <Ionicons name="cloud-offline-outline" size={30} color={colors.onSurfaceVariant} />
        <Text style={s.emptyTitle}>Couldn’t load rides</Text>
        <Text style={s.emptyText}>Check your connection and try again.</Text>
        <Button label="Try again" variant="secondary" size="md" onPress={() => void refetch()} />
      </View>
    );
  } else if (visible.length === 0) {
    const watching = alertState === 'saved';
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.empty, { paddingBottom: listPadBottom }]}>
        <View style={s.emptyIcon}>
          <Ionicons name={place ? 'notifications-outline' : 'bus-outline'} size={26} color={colors.onSurface} />
        </View>
        <Text style={s.emptyTitle}>
          {place
            ? `No rides to ${place.name} yet`
            : query.trim()
              ? `Nothing matches “${query.trim()}”`
              : filter !== 'all' && allTrips.length
                ? `No ${copy.title.toLowerCase()} rides right now`
                : 'No shared rides open right now'}
        </Text>
        <Text style={s.emptyText}>
          {place
            ? 'Drivers open new trips all day. We can tell you the moment one heads there.'
            : query.trim()
              ? 'Pick a place from the suggestions and we can tell you when a ride heads there.'
              : 'Get a car now, or book one for later.'}
        </Text>
        <View style={s.emptyActions}>
          {place && (
            <Button
              label={watching ? 'We’ll notify you' : 'Notify me'}
              variant="primary"
              size="lg"
              fullWidth
              loading={alertState === 'saving'}
              disabled={watching}
              icon={<Ionicons name={watching ? 'checkmark-circle' : 'notifications'} size={18} color={colors.onPrimary} />}
              onPress={notifyMe}
            />
          )}
          <Button
            label="Request a ride now"
            variant={place ? 'secondary' : 'primary'}
            size="lg"
            fullWidth
            onPress={requestNow}
          />
          <Button label="Schedule for later" variant="ghost" size="md" fullWidth onPress={scheduleLater} />
          {filter !== 'all' && !place && !query.trim() && allTrips.length > 0 && (
            <Button label="Show all rides" variant="ghost" size="md" fullWidth onPress={() => changeFilter('all')} />
          )}
        </View>
      </ScrollView>
    );
  } else {
    body = (
      <FlashList
        ref={listRef}
        data={rows}
        extraData={`${selectedId}|${now}|${userLoc ? 1 : 0}|${myTripId}`}
        keyExtractor={(t: any, i: number) => String(t?.id ?? i)}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: listPadBottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: any }) => (
          <View style={{ marginBottom: 10 }}>
            <TripRow
              trip={item}
              selected={String(item?.id) === selectedId}
              mine={myTripId != null && String(item?.id) === String(myTripId)}
              walkKm={pickupKm.get(String(item?.id)) ?? null}
              now={now}
              onPress={openTrip}
              colors={colors}
              s={s}
            />
          </View>
        )}
      />
    );
  }

  return (
    <SmoothScreen
      style={{ backgroundColor: colors.backgroundDeep }}
      placeholder={
        <View style={[s.placeholder, { paddingTop: halfY }]}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={104} borderRadius={radii.xl} />
          ))}
        </View>
      }
    >
      <View style={s.root}>
        {/* Deferred so the push animation gets the frame budget — a MapLibre
            surface coming up mid-transition is the costliest thing here. */}
        <SmoothDefer placeholder={<View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceContainer }]} />}>
          <BrowseMap
            trips={visible}
            selected={selected}
            onSelect={selectFromMap}
            onOpen={openTrip}
            userLoc={userLoc}
            cameraRef={cameraRef}
            fitKey={pinKey}
            onFit={fitAll}
            colors={colors}
            s={s}
          />
        </SmoothDefer>

        <Pressable
          onPress={() => goBack('/(tabs)/home')}
          style={[s.fab, { top: insets.top + 8, left: spacing.lg }]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={19} color={colors.onSurface} />
        </Pressable>
        {visible.length > 1 && (
          <Pressable
            onPress={() => { setSelectedId(null); fitAll(); }}
            style={[s.fab, { top: insets.top + 8, right: spacing.lg }]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Show every ride on the map"
          >
            <Ionicons name="scan-outline" size={17} color={colors.onSurface} />
          </Pressable>
        )}

        <Animated.View style={[s.sheet, { height: sheetH }, sheetStyle]}>
          <GestureDetector gesture={sheetPan}>
            <View style={s.sheetHead}>
              <Pressable onPress={cycleSheet} style={s.grabberHit} accessibilityRole="button" accessibilityLabel="Resize the ride list">
                <View style={s.grabber} />
              </Pressable>

              <View style={s.titleRow}>
                <Text style={s.title} numberOfLines={1}>
                  {place ? `To ${place.name}` : copy.title}
                </Text>
                <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>
              </View>

              <View style={[s.search, focused && { borderColor: withOpacity(colors.onSurface, 0.35) }]}>
                <Ionicons name="search" size={17} color={colors.onSurfaceVariant} />
                <TextInput
                  ref={inputRef}
                  value={query}
                  onChangeText={(t) => {
                    setQuery(t);
                    if (place) setPlace(null);
                    setSelectedId(null);
                    setAlertState('idle');
                  }}
                  onFocus={() => {
                    setFocused(true);
                    snapToState('expanded');
                  }}
                  onBlur={() => setFocused(false)}
                  placeholder="Where to?"
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={s.searchInput}
                  returnKeyType="search"
                  autoCorrect={false}
                  autoCapitalize="words"
                  maxFontSizeMultiplier={1.3}
                  accessibilityLabel="Where to? Search rides by destination"
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
                {(query.length > 0 || place) && (
                  <Pressable onPress={clearSearch} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={18} color={colors.onSurfaceVariant} />
                  </Pressable>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.chips}
                keyboardShouldPersistTaps="handled"
              >
                {BROWSE_GROUPS.map((g) => {
                  const on = g === filter;
                  const n = counts[g];
                  if (g !== 'all' && n === 0 && !on) return null;
                  return (
                    <Pressable
                      key={g}
                      onPress={() => changeFilter(g)}
                      style={[s.chip, on && { backgroundColor: colors.onSurface, borderColor: colors.onSurface }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${GROUP_COPY[g].title}, ${n}`}
                    >
                      <Text style={[s.chipText, on && { color: colors.background }]} numberOfLines={1}>
                        {g === 'all' ? 'All' : g === 'scheduled' ? 'Later' : GROUP_COPY[g].title}
                      </Text>
                      <Text style={[s.chipCount, on && { color: colors.background, opacity: 0.7 }]}>{n}</Text>
                    </Pressable>
                  );
                })}
                <View style={s.chipDivider} />
                {SORTS.map((o) => {
                  const on = o.id === sort;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => void changeSort(o.id)}
                      style={[s.chip, on && { borderColor: colors.onSurface, backgroundColor: withOpacity(colors.onSurface, 0.08) }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Sort by ${o.label.toLowerCase()}`}
                    >
                      <Ionicons name={o.icon} size={13} color={on ? colors.onSurface : colors.onSurfaceVariant} />
                      <Text style={[s.chipText, !on && { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                        {o.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </GestureDetector>

          <View style={s.sheetBody}>{body}</View>
        </Animated.View>
      </View>
    </SmoothScreen>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep },
    placeholder: { flex: 1, paddingHorizontal: spacing.lg, gap: 12 },

    fab: {
      position: 'absolute',
      width: 40,
      height: 40,
      borderRadius: 20,
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

    pricePin: { alignItems: 'center' },
    pricePinBody: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      height: 30,
      borderRadius: 15,
      borderWidth: 2,
      borderColor: '#FFFFFF',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 5,
      elevation: 6,
    },
    pricePinText: { fontFamily: fonts.bold, fontSize: 13, color: '#0A0A0B', fontVariant: ['tabular-nums'] },
    pricePinTail: {
      width: 0,
      height: 0,
      borderLeftWidth: 6,
      borderRightWidth: 6,
      borderTopWidth: 7,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      marginTop: -1,
    },

    sheet: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: colors.backgroundDeep,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.rimLight,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 16,
    },
    sheetHead: { paddingBottom: spacing.xs },
    sheetBody: { flex: 1 },
    grabberHit: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: withOpacity(colors.onSurface, 0.22) },

    titleRow: { paddingHorizontal: spacing.lg, gap: 2 },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.headlineSmall,
      lineHeight: Math.round(fontSizes.headlineSmall * 1.15),
      letterSpacing: -0.5,
      color: colors.onSurface,
    },
    subtitle: { fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, color: colors.onSurfaceVariant, fontVariant: ['tabular-nums'] },

    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 48,
      marginTop: spacing.md,
      marginHorizontal: spacing.lg,
      paddingHorizontal: 14,
      borderRadius: radii.xl,
      backgroundColor: colors.surfaceContainer,
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    searchInput: {
      flex: 1,
      height: 48,
      paddingVertical: 0,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      includeFontPadding: false,
      textAlignVertical: 'center',
    },

    chips: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      height: 34,
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outline,
      backgroundColor: colors.surfaceContainer,
    },
    chipText: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.onSurface },
    chipCount: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.onSurfaceVariant, fontVariant: ['tabular-nums'] },
    chipDivider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: colors.outline, marginHorizontal: 2 },

    stripWrap: { marginHorizontal: -spacing.lg, marginBottom: 4 },
    stripHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.lg, paddingTop: 2 },
    stripTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    stripHint: { flex: 1, fontFamily: fonts.regular, fontSize: 11.5, color: colors.onSurfaceVariant },
    stripRow: { gap: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    sectionLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 10,
      letterSpacing: 1.2,
      color: colors.onSurfaceVariant,
      paddingHorizontal: spacing.lg,
      paddingTop: 4,
      paddingBottom: 10,
    },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: BOARDING_ACCENT },

    card: {
      width: STRIP_CARD_W,
      padding: spacing.base,
      gap: 3,
      borderRadius: radii.xl,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: withOpacity(BOARDING_ACCENT, 0.35),
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardLive: { fontFamily: fonts.labelCaps, fontSize: 9.5, letterSpacing: 1, color: BOARDING_ACCENT },
    cardDest: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, color: colors.onSurface, marginTop: 2 },
    cardFrom: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.onSurfaceVariant },
    cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    cardFare: { fontFamily: fonts.bold, fontSize: fontSizes.bodyMedium, color: colors.onSurface, fontVariant: ['tabular-nums'], flexShrink: 1 },
    cardPer: { fontFamily: fonts.regular, fontSize: 11, color: colors.onSurfaceVariant },
    reserve: { paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: BOARDING_ACCENT },
    reserveText: { fontFamily: fonts.semiBold, fontSize: 12.5, color: '#0A0A0B' },

    listPad: { paddingHorizontal: spacing.lg, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 104,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
      gap: spacing.md,
      borderRadius: radii.xl,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
    },
    rowMain: { flex: 1, gap: 2 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowWhen: { flexShrink: 1, fontFamily: fonts.labelCaps, fontSize: 9.5, lineHeight: 13, letterSpacing: 1 },
    mineTag: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
    mineTagText: { fontFamily: fonts.labelCaps, fontSize: 8.5, letterSpacing: 0.8 },
    rowDest: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyLarge,
      lineHeight: Math.round(fontSizes.bodyLarge * 1.25),
      color: colors.onSurface,
    },
    rowFrom: { fontFamily: fonts.regular, fontSize: 12, color: colors.onSurfaceVariant },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
    metaStrong: { fontFamily: fonts.semiBold, fontSize: 11.5, color: colors.onSurface },
    metaText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 11.5, color: colors.onSurfaceVariant },
    rowSide: { alignItems: 'flex-end', gap: 3, minWidth: 84 },
    rowFare: { fontFamily: fonts.bold, fontSize: fontSizes.bodyLarge, color: colors.onSurface, fontVariant: ['tabular-nums'] },
    rowPer: { fontFamily: fonts.regular, fontSize: 10.5, color: colors.onSurfaceVariant, marginTop: -2 },
    rowSeats: { fontFamily: fonts.medium, fontSize: 10.5, color: colors.onSurfaceVariant, fontVariant: ['tabular-nums'] },
    seatDots: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 3, maxWidth: 84, marginTop: 4 },
    seatDot: { width: 6, height: 6, borderRadius: 3 },
    seatBar: { width: 64, height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },

    suggestion: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 56,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    suggestionIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainer,
    },
    suggestionText: { flex: 1, gap: 1 },
    suggestionName: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    suggestionAddr: { fontFamily: fonts.regular, fontSize: 12, color: colors.onSurfaceVariant },
    suggestHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.onSurfaceVariant, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },

    empty: { alignItems: 'center', gap: 8, paddingTop: spacing.xl, paddingHorizontal: spacing.xl },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainer,
      marginBottom: 4,
    },
    emptyTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleMedium, color: colors.onSurface, textAlign: 'center' },
    emptyText: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      lineHeight: Math.round(fontSizes.bodySmall * 1.45),
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      maxWidth: 320,
    },
    emptyActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
  });
