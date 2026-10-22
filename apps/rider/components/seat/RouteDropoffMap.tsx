import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, radii, spacing, withOpacity } from '@eyego/config';
import { Text, Pressable, GlassSurface, GradientGlowBorder } from '@eyego/ui';
import { boundsFor, isUsableCoord, type Coord, type CameraRef } from '@eyego/maps';
import { eyegoDarkStyle, eyegoLightStyle } from '@eyego/map-styles';
import MapboxGL from '../../utils/mapbox';
import { reverseGeocode } from '../../utils/geocoding';
import { placeLabel } from '@eyego/utils';

/**
 * ── WHERE DO YOU GET OFF? — ON THE ROAD ─────────────────────────────────────
 *
 * FEATURE ("make sure the user can select where they drop off on the map, the
 * whole trip route highlighted, and only allow a drop-off on the route or not
 * far off it").
 *
 * The whole route is drawn; a pin sits at the centre of the map; the rider
 * pans until the pin is where they want to get off. The pin is SNAPPED to the
 * nearest point on the road as they move, and the snapped point is the one
 * that is offered — so the driver is sent to a kerb on the route, never to a
 * rooftop beside it. More than `MAX_OFF_ROUTE_M` from the road the pin turns
 * red and the button refuses, which is the same rule the server enforces
 * (`resolveDropoff`), applied here so the rider learns it from the map rather
 * than from an error after tapping Pay.
 *
 * Confirming hands back the snapped coordinate and a street name for it; the
 * seat page asks the server what that seat now costs.
 */

/** Must match `DROPOFF_MAX_OFF_ROUTE_M` in bookings.service. */
const MAX_OFF_ROUTE_M = 150;

export interface RouteDropoff {
  latitude: number;
  longitude: number;
  address: string | null;
}

export interface RouteDropoffMapProps {
  /** `[lng, lat][]` — the trip's road, origin → destination. */
  route: Coord[] | null;
  origin?: Coord | null;
  destination?: Coord | null;
  /** The drop-off already chosen, if any. Frames the map on it. */
  value: RouteDropoff | null;
  onChange: (dropoff: RouteDropoff | null) => void;
  isDark: boolean;
  accent: string;
  colors: Record<string, string>;
  /** Short name of the end of the route — "4.1 km before Madina". */
  destinationName?: string | null;
  /** True while a finger is on the map — the page stops scrolling so the pan reaches it. */
  onInteract?: (active: boolean) => void;
  /**
   * `screen`: the map IS the page — full-bleed, tilted, with a close button.
   * The seat page opens it this way; a pannable map inside a dragging sheet
   * fights the sheet for every vertical swipe.
   */
  variant?: 'card' | 'screen';
  onClose?: () => void;
  /** Safe-area insets for the `screen` variant's chrome. */
  insets?: { top: number; bottom: number };
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type Snap = { point: Coord; distanceM: number; alongM: number; totalM: number };

/**
 * Nearest point on the polyline to `[lng, lat]`, how far off it is, and how far
 * along the road it falls. Mirrors utils/geo.js on the server.
 */
function snapToRoute(point: Coord, line: Coord[]): Snap | null {
  if (line.length < 2) return null;
  const [plng, plat] = point;
  let best: Snap | null = null;
  let walked = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [alng, alat] = line[i];
    const [blng, blat] = line[i + 1];
    const dx = blng - alng;
    const dy = blat - alat;
    const lenSq = dx * dx + dy * dy;
    const segM = haversineM(alat, alng, blat, blng);
    let t = 0;
    if (lenSq > 0) t = Math.max(0, Math.min(1, ((plng - alng) * dx + (plat - alat) * dy) / lenSq));
    const proj: Coord = [alng + t * dx, alat + t * dy];
    const d = haversineM(plat, plng, proj[1], proj[0]);
    if (!best || d < best.distanceM) best = { point: proj, distanceM: d, alongM: walked + segM * t, totalM: 0 };
    walked += segM;
  }
  if (best) best.totalM = walked;
  return best;
}

/** The point halfway along the road — where the pin starts, so it starts ON the route. */
function midpointOf(line: Coord[]): Coord | null {
  if (line.length < 2) return null;
  const segs = line.slice(1).map((b, i) => haversineM(line[i][1], line[i][0], b[1], b[0]));
  let left = segs.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < segs.length; i += 1) {
    if (segs[i] > 0 && segs[i] >= left) {
      const t = left / segs[i];
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
    }
    left -= segs[i];
  }
  return line[line.length - 1];
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(50, Math.round(m / 50) * 50)} m`);

/**
 * Where the pin is, in words a rider can use, when no street is known there.
 * "Accra, Greater Accra, Ghana" names the whole city; "3.2 km into the ride ·
 * 4.1 km before Madina" names the point.
 */
function alongRoute(s: Snap, destinationName?: string | null): string {
  return `${km(s.alongM)} into the ride · ${km(s.totalM - s.alongM)} before ${destinationName || 'the end'}`;
}

export function RouteDropoffMap({
  route,
  origin,
  destination,
  value,
  onChange,
  isDark,
  accent,
  colors,
  destinationName,
  onInteract,
  variant = 'card',
  onClose,
  insets = { top: 0, bottom: 0 },
}: RouteDropoffMapProps) {
  const screen = variant === 'screen';
  const cameraRef = useRef<CameraRef | null>(null);
  const line = useMemo(() => (Array.isArray(route) ? route.filter(isUsableCoord) : []), [route]);
  const mid = useMemo(() => midpointOf(line), [line]);
  const seed: Coord | null = value ? [value.longitude, value.latitude] : mid;

  /**
   * BUGFIX ("the where-do-you-get-off map is blank and Drop me off here is
   * grayed out"). The camera had no seed and ONE fit at 120 ms — a command
   * that lands before MapLibre attaches the camera is dropped, so the map sat
   * at the Ghana-wide default: a blank sheet. And `centre` only ever came from
   * `onRegionDidChange`, so until the rider happened to pan there was no pin,
   * nothing snapped, and the button stayed disabled. The pin now starts on the
   * road (halfway along it) and the framing is re-sent, as every other map in
   * the app does it.
   */
  const [centre, setCentre] = useState<Coord | null>(seed);
  // Frozen: a declarative centre that changed per render would yank the map back.
  const [cameraSeed] = useState(seed);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const snapped = useMemo(() => (centre && line.length >= 2 ? snapToRoute(centre, line) : null), [centre, line]);
  const onRoute = !!snapped && snapped.distanceM <= MAX_OFF_ROUTE_M;

  // Frame the whole road with the pin halfway along it, or the chosen drop-off.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || line.length < 2) return;
    framed.current = true;
    const frame = () => {
      const cam = cameraRef.current;
      if (!cam) return;
      if (value) {
        cam.setCamera({ centerCoordinate: [value.longitude, value.latitude], zoomLevel: 15, pitch: screen ? 45 : 0, animationDuration: 0 });
        return;
      }
      const box = boundsFor([...line, ...[origin, destination].filter(isUsableCoord)]);
      const pad = screen ? { top: insets.top + 90, bottom: insets.bottom + 190, left: 40, right: 40 } : { top: 48, bottom: 48, left: 40, right: 40 };
      if (box) cam.fitBounds([box.ne, box.sw], pad, false, { bearing: 0, pitch: 0 });
      // Same zoom, re-centred on the road so the pin begins ON the route — and,
      // full-screen, tilted into the city like the share page.
      if (mid) setTimeout(() => cameraRef.current?.setCamera({ centerCoordinate: mid, pitch: screen ? 45 : 0, animationDuration: screen ? 700 : 0 }), 40);
    };
    const timers = [120, 420, 900].map((ms) => setTimeout(frame, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.length]);

  /**
   * A street name for the snapped point, asked for once the map has settled —
   * never per frame of a drag. The label rides the booking so the driver's
   * stop list says "Madina Zongo Junction", not two numbers.
   */
  /**
   * Stale answers are dropped (a slow lookup for where the pin WAS must not
   * name where it is), and `naming` always comes back down — it used to stick
   * when the pin left the route mid-lookup.
   *
   * "Accra, Greater Accra, Ghana" is not a place anybody can find: when the
   * server only knows the city (`approximate`), the pin is described by where
   * it falls on the ride instead.
   */
  const pending = useRef<Promise<string> | null>(null);
  useEffect(() => {
    setName(null);
    if (!snapped || !onRoute) {
      setNaming(false);
      pending.current = null;
      return;
    }
    setNaming(true);
    const [lng, lat] = snapped.point;
    const fallback = alongRoute(snapped, destinationName);
    let live = true;
    let settle: (v: string) => void = () => {};
    pending.current = new Promise<string>((r) => { settle = r; });
    const t = setTimeout(() => {
      void reverseGeocode(lat, lng)
        .then((hit) => (hit && !hit.approximate ? placeLabel(hit.name, hit.fullAddress) ?? hit.name : null))
        .catch(() => null)
        .then((label) => {
          settle(label ?? fallback);
          if (!live) return;
          setName(label ?? fallback);
          setNaming(false);
        });
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
      settle(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapped?.point[0], snapped?.point[1], onRoute]);

  // Tapping while the street is still being looked up waits for it — the
  // button never greys out just because a lookup is in flight.
  const confirm = useCallback(async () => {
    if (!snapped || !onRoute) return;
    const [lng, lat] = snapped.point;
    const label = name ?? (pending.current ? await pending.current : null) ?? alongRoute(snapped, destinationName);
    onChange({ latitude: lat, longitude: lng, address: label });
  }, [snapped, onRoute, name, onChange, destinationName]);

  const routeShape = useMemo(
    () =>
      line.length >= 2
        ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line } }
        : null,
    [line],
  );

  const Frame = screen ? ScreenFrame : CardFrame;
  return (
    <Frame fill={colors.surfaceCard}>
      <View
        style={screen ? StyleSheet.absoluteFill : styles.wrap}
        // The page scrolls; a vertical pan on the map must move the map.
        onTouchStart={() => onInteract?.(true)}
        onTouchEnd={() => onInteract?.(false)}
        onTouchCancel={() => onInteract?.(false)}
      >
        <MapboxGL.MapView
          style={StyleSheet.absoluteFill}
          styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={screen}
          onRegionDidChange={(e) => {
            const c = e?.geometry?.coordinates;
            if (Array.isArray(c) && c.length === 2) setCentre([c[0], c[1]]);
          }}
        >
          <MapboxGL.Camera ref={cameraRef} animationMode="none" centerCoordinate={cameraSeed ?? undefined} zoomLevel={13} />

          {routeShape ? (
            <MapboxGL.ShapeSource id="dropoff-route" shape={routeShape}>
              <MapboxGL.LineLayer
                id="dropoff-route-casing"
                style={{ lineColor: '#031A0C', lineWidth: 9, lineOpacity: 0.85, lineCap: 'round', lineJoin: 'round' }}
              />
              <MapboxGL.LineLayer
                id="dropoff-route-line"
                style={{ lineColor: accent, lineWidth: 5, lineOpacity: 1, lineCap: 'round', lineJoin: 'round' }}
              />
            </MapboxGL.ShapeSource>
          ) : null}

          {isUsableCoord(origin) ? (
            <MapboxGL.MarkerView coordinate={origin} anchor="center">
              <View style={[styles.endDot, { borderColor: colors.onSurfaceVariant }]} />
            </MapboxGL.MarkerView>
          ) : null}
          {isUsableCoord(destination) ? (
            <MapboxGL.MarkerView coordinate={destination} anchor="center">
              <View style={[styles.endPin, { backgroundColor: accent }]}>
                <Ionicons name="flag" size={11} color="#fff" />
              </View>
            </MapboxGL.MarkerView>
          ) : null}

          {/* The snapped point — where the driver would actually stop. */}
          {snapped ? (
            <MapboxGL.MarkerView coordinate={snapped.point} anchor="center">
              <View style={[styles.snapHalo, { backgroundColor: withOpacity(onRoute ? accent : colors.error, 0.28) }]}>
                <View style={[styles.snapDot, { backgroundColor: onRoute ? accent : colors.error }]} />
              </View>
            </MapboxGL.MarkerView>
          ) : null}
        </MapboxGL.MapView>

        {/* The pin, fixed at the centre: the map moves, the pin does not. */}
        <View style={styles.crosshair} pointerEvents="none">
          <Ionicons name="location" size={34} color={onRoute ? accent : colors.error} style={styles.crosshairGlyph} />
        </View>

        {screen && onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close the drop-off map"
            style={[styles.close, { top: insets.top + spacing.sm, backgroundColor: colors.surfaceCard }]}
          >
            <Ionicons name="close" size={20} color={colors.onSurface} />
          </Pressable>
        ) : null}

        <View style={[styles.chrome, screen && { left: spacing.base, right: spacing.base, bottom: insets.bottom + spacing.base }]} pointerEvents="box-none">
          <View style={styles.hint}>
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
            <Text variant="caption" color={onRoute ? colors.onSurface : colors.error} numberOfLines={2}>
              {!snapped
                ? 'Move the map to put the pin where you get off'
                : onRoute
                  ? naming
                    ? 'Finding the street…'
                    : name ?? 'On the route'
                  : `Move the pin onto the route (${Math.round(snapped.distanceM)} m off)`}
            </Text>
          </View>
          <View style={styles.buttons}>
            {value ? (
              <Pressable
                onPress={() => onChange(null)}
                accessibilityRole="button"
                accessibilityLabel="Ride to the end instead"
                style={[styles.btn, { borderColor: colors.outlineVariant }]}
              >
                <Text style={[styles.btnText, { color: colors.onSurfaceVariant }]}>Ride to the end</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={confirm}
              disabled={!onRoute}
              accessibilityRole="button"
              accessibilityLabel="Drop me off here"
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: accent, borderColor: accent },
                !onRoute && { opacity: 0.45 },
              ]}
            >
              <Text style={[styles.btnText, { color: colors.onPrimary ?? '#0A0D14' }]}>
                {value ? 'Move drop-off here' : 'Drop me off here'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Frame>
  );
}

function CardFrame({ fill, children }: { fill: string; children: React.ReactNode }) {
  return (
    <GradientGlowBorder palette="brandGreen" fillColor={fill} borderRadius={radii.xl} thickness="thin" glow glowIntensity={0.5} maxGlowRadius={12}>
      {children}
    </GradientGlowBorder>
  );
}

function ScreenFrame({ fill, children }: { fill: string; children: React.ReactNode }) {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]}>{children}</View>;
}

const styles = StyleSheet.create({
  wrap: { height: 300, borderRadius: radii.xl, overflow: 'hidden' },
  crosshair: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The glyph's tip is its bottom-centre; lift it so the tip sits on the centre.
  crosshairGlyph: { marginTop: -34 },
  chrome: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, gap: spacing.sm },
  hint: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  btnPrimary: {},
  close: {
    position: 'absolute',
    left: spacing.base,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall },
  endDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, backgroundColor: '#0A0D14' },
  endPin: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  snapHalo: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  snapDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
});
