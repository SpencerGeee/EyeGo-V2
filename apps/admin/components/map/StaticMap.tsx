'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';

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

const SOURCE_ID = 'trip-line';
const CASING_LAYER = 'trip-line-casing';
const LINE_LAYER = 'trip-line';

/**
 * A non-polling map for one situation: a trip's route, an SOS location, a
 * driver's last known position.
 *
 * ── WHY THE LINE HANDLING LOOKS LIKE THIS ───────────────────────────────────
 * The first version added the source and layer inside a `styledata` handler.
 * `styledata` fires many times per style load, so the add raced its own removal,
 * and MapLibre throws on a duplicate source id — an exception inside an async
 * handler that nothing awaited, which aborted the draw silently. The result was a
 * map with both pins and no line, which is exactly what was reported.
 *
 * So: layers are (re)built from ONE place, only ever after `isStyleLoaded()`, and
 * re-created on `style.load` (fires once per style) rather than `styledata`.
 * Failures are logged rather than swallowed.
 *
 * The line is drawn as two layers — a dark casing under a bright accent stroke —
 * which is how a route stays readable over both a pale road and a dark park.
 *
 * `line` is the server's road geometry when it could be had. When it could not,
 * this draws the straight line between first and last point DASHED, and the
 * caller says so in words: an admin investigating a fare must never be shown a
 * straight line that looks like the road the driver took.
 */
export function StaticMap({
  points,
  line,
  height = 320,
  label,
  className,
  animate = true,
}: {
  points: MapPoint[];
  line?: LineGeometry;
  height?: number;
  label: string;
  className?: string;
  /** Draw the route on rather than snapping it in. Ignored under reduced motion. */
  animate?: boolean;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<MlMarker[]>([]);
  const frame = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const mode = useThemeMode();

  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const pointsKey = JSON.stringify(usable);
  const lineKey = JSON.stringify(line ?? null);

  // ── The map itself ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      const first = usable[0];
      if (cancelled || !holder.current || map.current || !first) return;

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
      if (frame.current) cancelAnimationFrame(frame.current);
      map.current?.remove();
      map.current = null;
    };
    // Theme changes swap the style in place (below); re-creating the map would
    // throw away the camera the operator had set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current || !ready) return;
    map.current.setStyle(mapStyleFor(mode));
  }, [mode, ready]);

  // ── Pins ───────────────────────────────────────────────────────
  // DOM markers survive a style swap, so they are managed on their own and keyed
  // only on the points.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    let cancelled = false;

    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled) return;

      markers.current.forEach((m) => m.remove());
      markers.current = [];

      for (const p of usable) {
        const el = document.createElement('div');
        el.className = `map-pin-static tone-${p.tone ?? 'neutral'}`;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', p.label ?? 'Location');
        el.textContent = p.glyph ?? '';
        if (p.label) el.title = p.label;
        markers.current.push(
          new maplibre.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(instance),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, pointsKey]);

  // ── The route line ─────────────────────────────────────────────
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    const first = usable[0];
    const last = usable[usable.length - 1];
    if (!first || !last) return;

    const isReal = !!line?.coordinates?.length;
    const coords: [number, number][] = isReal
      ? (line as { coordinates: [number, number][] }).coordinates
      : usable.length > 1
        ? [
            [first.lng, first.lat],
            [last.lng, last.lat],
          ]
        : [];

    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const feature = (cs: [number, number][]) =>
      ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: cs },
      });

    const build = () => {
      try {
        if (!instance.isStyleLoaded()) return;

        // Rebuild from scratch: a style swap drops sources and layers, and adding
        // over an existing id throws.
        for (const id of [LINE_LAYER, CASING_LAYER]) {
          if (instance.getLayer(id)) instance.removeLayer(id);
        }
        if (instance.getSource(SOURCE_ID)) instance.removeSource(SOURCE_ID);

        if (coords.length < 2) {
          instance.easeTo({ center: [first.lng, first.lat], zoom: 15, duration: 0 });
          return;
        }

        instance.addSource(SOURCE_ID, { type: 'geojson', data: feature(coords) });

        // Casing first, so it sits under the stroke.
        instance.addLayer({
          id: CASING_LAYER,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': mode === 'light' ? '#ffffff' : '#05070a',
            'line-width': isReal ? 8 : 4,
            'line-opacity': isReal ? 0.65 : 0.4,
          },
        });
        instance.addLayer({
          id: LINE_LAYER,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': isReal ? (mode === 'light' ? '#0f9950' : '#2fd46b') : '#8e9aab',
            'line-width': isReal ? 4.5 : 2,
            'line-opacity': isReal ? 0.95 : 0.75,
            // Dashes are the visual signal that this is NOT the road.
            ...(isReal ? {} : { 'line-dasharray': [2, 2] as unknown as number[] }),
          },
        });

        // Camera: fit everything, but a degenerate bounding box (one point, or
        // two identical ones) is not something fitBounds can use.
        void (async () => {
          const maplibre = (await import('maplibre-gl')).default;
          const bounds = new maplibre.LngLatBounds();
          for (const c of coords) bounds.extend(c);
          for (const p of usable) bounds.extend([p.lng, p.lat]);
          const sw = bounds.getSouthWest();
          const ne = bounds.getNorthEast();
          if (Math.abs(sw.lng - ne.lng) < 1e-6 && Math.abs(sw.lat - ne.lat) < 1e-6) {
            instance.easeTo({ center: [first.lng, first.lat], zoom: 14, duration: 0 });
          } else {
            // The camera opens at the same pace the line draws, so the reveal
            // reads as one movement rather than two.
            instance.fitBounds(bounds, {
              padding: 56,
              maxZoom: 15,
              duration: animate && !reduceMotion ? 900 : 0,
              essential: true,
            });
          }
        })();

        // Progressive reveal. The source is re-fed a growing slice of the same
        // coordinates — no layer churn, one setData per frame, and it stops at
        // the full line. Skipped entirely under reduced motion.
        if (!animate || reduceMotion || !isReal) return;

        const source = instance.getSource(SOURCE_ID) as { setData: (d: unknown) => void } | undefined;
        if (!source) return;

        const DURATION = 850;
        const started = performance.now();
        source.setData(feature(coords.slice(0, 2)));

        const step = (now: number) => {
          const t = Math.min(1, (now - started) / DURATION);
          // Ease-out cubic: quick off the mark, settles rather than stopping.
          const eased = 1 - Math.pow(1 - t, 3);
          const upto = Math.max(2, Math.round(eased * coords.length));
          source.setData(feature(coords.slice(0, upto)));
          if (t < 1) {
            frame.current = requestAnimationFrame(step);
          } else {
            frame.current = null;
            source.setData(feature(coords));
          }
        };
        frame.current = requestAnimationFrame(step);
      } catch (err) {
        // A missing route line is a real defect, not a cosmetic one — it must not
        // fail silently the way it did before.
        console.error('[StaticMap] could not draw the route line', err);
      }
    };

    build();
    // Fires once per style load, unlike `styledata`.
    instance.on('style.load', build);

    return () => {
      instance.off('style.load', build);
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [ready, pointsKey, lineKey, mode, animate]);

  if (usable.length === 0) {
    return (
      <div className={`grid place-items-center bg-bg-inset ${className ?? ''}`} style={{ height }}>
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
