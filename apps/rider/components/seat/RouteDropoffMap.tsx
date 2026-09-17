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
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Nearest point on the polyline to `[lng, lat]`, and how far off it is. Mirrors utils/geo.js on the server. */
function snapToRoute(point: Coord, line: Coord[]): { point: Coord; distanceM: number } | null {
  if (line.length < 2) return null;
  const [plng, plat] = point;
  let best: { point: Coord; distanceM: number } | null = null;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [alng, alat] = line[i];
    const [blng, blat] = line[i + 1];
    const dx = blng - alng;
    const dy = blat - alat;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) t = Math.max(0, Math.min(1, ((plng - alng) * dx + (plat - alat) * dy) / lenSq));
    const proj: Coord = [alng + t * dx, alat + t * dy];
    const d = haversineM(plat, plng, proj[1], proj[0]);
    if (!best || d < best.distanceM) best = { point: proj, distanceM: d };
  }
  return best;
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
}: RouteDropoffMapProps) {
  const cameraRef = useRef<CameraRef | null>(null);
  const [centre, setCentre] = useState<Coord | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const line = useMemo(() => (Array.isArray(route) ? route.filter(isUsableCoord) : []), [route]);
  const snapped = useMemo(() => (centre && line.length >= 2 ? snapToRoute(centre, line) : null), [centre, line]);
  const onRoute = !!snapped && snapped.distanceM <= MAX_OFF_ROUTE_M;

  // Frame the whole road once, or the chosen drop-off if there is one.
  const framed = useRef(false);
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam || framed.current) return;
    const t = setTimeout(() => {
      framed.current = true;
      if (value) {
        cam.setCamera({ centerCoordinate: [value.longitude, value.latitude], zoomLevel: 15, animationDuration: 0 });
        return;
      }
      const box = boundsFor([...line, ...[origin, destination].filter(isUsableCoord)]);
      if (box) cam.fitBounds([box.ne, box.sw], { top: 48, bottom: 48, left: 40, right: 40 }, false);
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.length]);

  /**
   * A street name for the snapped point, asked for once the map has settled —
   * never per frame of a drag. The label rides the booking so the driver's
   * stop list says "Madina Zongo Junction", not two numbers.
   */
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (nameTimer.current) clearTimeout(nameTimer.current);
    setName(null);
    if (!snapped || !onRoute) return;
    setNaming(true);
    const [lng, lat] = snapped.point;
    nameTimer.current = setTimeout(() => {
      void reverseGeocode(lat, lng)
        .then((hit) => {
          if (!hit) return setName(null);
          setName(placeLabel(hit.name, hit.fullAddress) ?? hit.fullAddress ?? hit.name ?? null);
        })
        .catch(() => setName(null))
        .finally(() => setNaming(false));
    }, 450);
    return () => {
      if (nameTimer.current) clearTimeout(nameTimer.current);
    };
  }, [snapped?.point[0], snapped?.point[1], onRoute]);

  const confirm = useCallback(() => {
    if (!snapped || !onRoute) return;
    const [lng, lat] = snapped.point;
    onChange({ latitude: lat, longitude: lng, address: name });
  }, [snapped, onRoute, name, onChange]);

  const routeShape = useMemo(
    () =>
      line.length >= 2
        ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: line } }
        : null,
    [line],
  );

  return (
    <GradientGlowBorder
      palette="brandGreen"
      fillColor={colors.surfaceCard}
      borderRadius={radii.xl}
      thickness="thin"
      glow
      glowIntensity={0.5}
      maxGlowRadius={12}
    >
      <View style={styles.wrap}>
        <MapboxGL.MapView
          style={StyleSheet.absoluteFill}
          styleURL={isDark ? eyegoDarkStyle : eyegoLightStyle}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          onRegionDidChange={(e) => {
            const c = e?.geometry?.coordinates;
            if (Array.isArray(c) && c.length === 2) setCentre([c[0], c[1]]);
          }}
        >
          <MapboxGL.Camera ref={cameraRef} animationMode="none" />

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

        <View style={styles.chrome} pointerEvents="box-none">
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
              disabled={!onRoute || naming}
              accessibilityRole="button"
              accessibilityLabel="Drop me off here"
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: accent, borderColor: accent },
                (!onRoute || naming) && { opacity: 0.45 },
              ]}
            >
              <Text style={[styles.btnText, { color: colors.onPrimary ?? '#0A0D14' }]}>
                {value ? 'Move drop-off here' : 'Drop me off here'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </GradientGlowBorder>
  );
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
  btnText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall },
  endDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, backgroundColor: '#0A0D14' },
  endPin: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  snapHalo: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  snapDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
});
