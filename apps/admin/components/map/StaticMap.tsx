'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';

import { mapStyleFor, useThemeMode } from './useMapStyle';

export type MapPoint = {
  lat: number;
  lng: number;
  /** Drawn on the pin; keep it to one or two characters. */
  glyph?: string;
  label?: string;
  tone?: 'accent' | 'info' | 'critical' | 'neutral';
};

export type LineGeometry = { type: 'LineString'; coordinates: [number, number][] } | null;

/**
 * A non-polling map for one situation: a trip's route, an SOS location, a
 * driver's last known position.
 *
 * Separate from FleetMap on purpose. FleetMap owns a refresh loop, a selection
 * model and a driver list; this owns none of that, so putting a second copy of
 * that machinery on a trip page would be strictly worse than a component that
 * draws exactly what it is given and then stops.
 *
 * `line` is the server's road geometry when it could be had. When it could not,
 * this draws the straight line between first and last point DASHED, and the
 * caller says so in words — an admin investigating a fare must never be shown a
 * straight line that looks like the road the driver took.
 */
export function StaticMap({
  points,
  line,
  height = 320,
  label,
  className,
}: {
  points: MapPoint[];
  line?: LineGeometry;
  height?: number;
  label: string;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const mode = useThemeMode();

  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled || !holder.current || map.current || usable.length === 0) return;

      const first = usable[0];
      if (!first) return;
      const instance = new maplibre.Map({
        container: holder.current,
        style: mapStyleFor(mode),
        center: [first.lng, first.lat],
        zoom: 13,
        pitchWithRotate: false,
        dragRotate: false,
      });
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        if (!cancelled) setReady(true);
      });
      map.current = instance;
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // Style changes are handled by the effect below; re-creating the map on a
    // theme toggle would drop the camera the operator had set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current || !ready) return;
    map.current.setStyle(mapStyleFor(mode));
  }, [mode, ready]);

  // Markers, the line, and the camera. Re-run on every data change, and again
  // after a style swap, because a style swap removes sources and layers (but not
  // DOM markers).
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || usable.length === 0) return;

    let cancelled = false;
    const markers: { remove: () => void }[] = [];

    const draw = async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled) return;
      const first = usable[0];
      const last = usable[usable.length - 1];
      if (!first || !last) return;

      for (const p of usable) {
        const el = document.createElement('div');
        el.className = `map-pin-static tone-${p.tone ?? 'neutral'}`;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', p.label ?? 'Location');
        el.textContent = p.glyph ?? '';
        if (p.label) el.title = p.label;
        markers.push(new maplibre.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(instance));
      }

      // The route line, under the pins.
      const coords: [number, number][] =
        line?.coordinates?.length
          ? line.coordinates
          : usable.length > 1
            ? [
                [first.lng, first.lat],
                [last.lng, last.lat],
              ]
            : [];

      if (coords.length > 1) {
        const isReal = !!line?.coordinates?.length;
        if (instance.getLayer('trip-line')) instance.removeLayer('trip-line');
        if (instance.getSource('trip-line')) instance.removeSource('trip-line');
        instance.addSource('trip-line', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        instance.addLayer({
          id: 'trip-line',
          type: 'line',
          source: 'trip-line',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': isReal ? '#2fd46b' : '#8e9aab',
            'line-width': isReal ? 4 : 2,
            'line-opacity': isReal ? 0.9 : 0.7,
            // Dashes are the visual signal that this is not the road.
            ...(isReal ? {} : { 'line-dasharray': [2, 2] as unknown as number[] }),
          },
        });

        // Fit to everything drawn. A single point, or two identical points, gives
        // a degenerate bounding box that fitBounds cannot use — so that case
        // centres instead.
        const bounds = new maplibre.LngLatBounds();
        for (const c of coords) bounds.extend(c);
        for (const p of usable) bounds.extend([p.lng, p.lat]);
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        if (Math.abs(sw.lng - ne.lng) < 1e-6 && Math.abs(sw.lat - ne.lat) < 1e-6) {
          instance.easeTo({ center: [first.lng, first.lat], zoom: 14, duration: 0 });
        } else {
          instance.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 0 });
        }
      } else {
        instance.easeTo({ center: [first.lng, first.lat], zoom: 15, duration: 0 });
      }
    };

    draw();
    // Redraw sources after a style swap wipes them.
    const onStyle = () => void draw();
    instance.on('styledata', onStyle);

    return () => {
      cancelled = true;
      instance.off('styledata', onStyle);
      markers.forEach((m) => m.remove());
    };
  }, [ready, JSON.stringify(points), JSON.stringify(line ?? null)]);

  if (usable.length === 0) {
    return (
      <div
        className={`grid place-items-center bg-bg-inset ${className ?? ''}`}
        style={{ height }}
      >
        <p className="t-small text-text-dim px-4 text-center">
          No coordinates were recorded for this, so there is nothing to place on a map.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={holder}
      className={`w-full bg-bg ${className ?? ''}`}
      style={{ height }}
      role="application"
      aria-label={label}
    />
  );
}
