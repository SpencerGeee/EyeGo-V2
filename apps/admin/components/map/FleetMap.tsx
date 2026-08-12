'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap, Marker as MlMarker, StyleSpecification } from 'maplibre-gl';

import { Icon } from '@/components/ui/Icon';

export type MapDriver = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  status: string;
  activeTripId: string | null;
  vehiclePlate: string | null;
};

/**
 * Accra. Only used as the opening view when no driver has a fix yet — as soon as
 * one does, the camera fits the fleet instead.
 */
const HOME: [number, number] = [-0.187, 5.6037];

/**
 * A basemap needs a tile provider, and every provider worth using needs a key.
 * Rather than hard-wire someone's quota or ship a provider that rate-limits in
 * production, the style URL is configuration. With it unset the map still works:
 * MapLibre renders the background layer and places every marker at its true
 * position, so relative geography, spacing and movement are all correct — you
 * just have no streets behind them. A degraded map that tells the truth beats a
 * blank panel.
 */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  // Transparent so the holder's themed background shows through and the blank
  // map is not a dark rectangle in light mode.
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } }],
};

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL;

type Payload = { drivers: MapDriver[]; at: string };

export function FleetMap({
  initial,
  initialError,
  intervalSeconds = 15,
}: {
  initial: MapDriver[];
  initialError?: string | null;
  intervalSeconds?: number;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Map<string, MlMarker>>(new Map());
  const fitted = useRef(false);

  const [drivers, setDrivers] = useState<MapDriver[]>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(initialError ? null : new Date());
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const located = useMemo(
    () => drivers.filter((d) => typeof d.lat === 'number' && typeof d.lng === 'number'),
    [drivers]
  );
  const noFix = drivers.length - located.length;

  // ── Map instance ───────────────────────────────────────────────
  // maplibre-gl touches `window` at import time, so it is imported inside the
  // effect rather than at module scope — a static import would break the
  // prerender of any route that includes this component.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (cancelled || !holder.current || map.current) return;

      const instance = new maplibre.Map({
        container: holder.current,
        style: STYLE_URL || BLANK_STYLE,
        center: HOME,
        zoom: 11,
        attributionControl: STYLE_URL ? undefined : false,
        // Rotating an ops map serves no purpose and makes north ambiguous.
        pitchWithRotate: false,
        dragRotate: false,
      });

      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        if (!cancelled) setReady(true);
      });
      // A style that 404s must not leave the operator staring at a dead panel.
      instance.on('error', (e) => {
        const message = (e as unknown as { error?: Error }).error?.message;
        if (message && /style|source|tile/i.test(message)) {
          setError((prev) => prev ?? `Basemap failed to load: ${message}`);
        }
      });

      map.current = instance;
    })();

    return () => {
      cancelled = true;
      markers.current.forEach((m) => m.remove());
      markers.current.clear();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── Polling ────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/live/drivers', { cache: 'no-store' });
      if (res.status === 401) {
        // The session died under us. Reloading lets middleware do the redirect.
        window.location.reload();
        return;
      }
      const body = (await res.json()) as Partial<Payload> & { error?: string };
      if (!res.ok || !body.drivers) throw new Error(body.error || `Request failed (${res.status})`);
      setDrivers(body.drivers);
      setUpdatedAt(new Date(body.at ?? Date.now()));
      setError(null);
    } catch (err) {
      // Keep the last known positions on screen and say they are stale. Wiping
      // the map on a single failed poll is how an operator loses the fleet.
      setError(err instanceof Error ? err.message : 'Could not refresh driver positions');
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(load, Math.max(5, intervalSeconds) * 1000);
    return () => window.clearInterval(id);
  }, [live, intervalSeconds, load]);

  // ── Markers ────────────────────────────────────────────────────
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    let mounted = true;

    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      if (!mounted) return;

      const seen = new Set<string>();

      for (const d of located) {
        seen.add(d.id);
        const busy = !!d.activeTripId;
        const existing = markers.current.get(d.id);

        if (existing) {
          existing.setLngLat([d.lng as number, d.lat as number]);
          const el = existing.getElement();
          el.dataset.busy = busy ? 'yes' : 'no';
          el.dataset.selected = selected === d.id ? 'yes' : 'no';
          const arrow = el.querySelector<HTMLElement>('[data-arrow]');
          if (arrow) arrow.style.transform = `rotate(${d.heading ?? 0}deg)`;
          continue;
        }

        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'map-pin';
        el.dataset.busy = busy ? 'yes' : 'no';
        el.dataset.selected = selected === d.id ? 'yes' : 'no';
        el.setAttribute(
          'aria-label',
          `${d.name}${d.vehiclePlate ? `, ${d.vehiclePlate}` : ''}, ${busy ? 'on a trip' : 'free'}`
        );
        el.innerHTML =
          '<span class="map-pin-dot"></span>' +
          (d.heading === null
            ? ''
            : `<span class="map-pin-arrow" data-arrow style="transform:rotate(${d.heading}deg)"></span>`);
        el.addEventListener('click', () => setSelected((cur) => (cur === d.id ? null : d.id)));

        markers.current.set(
          d.id,
          new maplibre.Marker({ element: el }).setLngLat([d.lng as number, d.lat as number]).addTo(instance)
        );
      }

      // A driver who went offline has to leave the map, or dispatch keeps
      // sending work to a car that is not there.
      for (const [id, marker] of markers.current) {
        if (!seen.has(id)) {
          marker.remove();
          markers.current.delete(id);
        }
      }

      // Fit once, on the first load that actually has positions. Refitting on
      // every poll would yank the camera away from whatever the operator is
      // looking at. A single-driver fleet gives a degenerate bounding box, so
      // that case gets an easeTo with a fixed zoom instead of fitBounds.
      const only = located.length === 1 ? located[0] : null;
      if (!fitted.current && located.length > 0) {
        fitted.current = true;
        if (only) {
          instance.easeTo({ center: [only.lng as number, only.lat as number], zoom: 13 });
        } else {
          const bounds = new maplibre.LngLatBounds();
          for (const d of located) bounds.extend([d.lng as number, d.lat as number]);
          instance.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 400 });
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [located, ready, selected]);

  const focus = useCallback((d: MapDriver) => {
    setSelected(d.id);
    if (typeof d.lat === 'number' && typeof d.lng === 'number') {
      map.current?.easeTo({ center: [d.lng, d.lat], zoom: 15, duration: 400 });
    }
  }, []);

  const chosen = drivers.find((d) => d.id === selected) || null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="card-flush relative">
        <div
          ref={holder}
          className="w-full h-[420px] lg:h-[calc(100dvh-var(--topbar-h)-190px)] min-h-[360px] bg-bg"
          role="application"
          aria-label="Live fleet map"
        />

        {!STYLE_URL ? (
          <p className="absolute bottom-2 left-2 right-2 t-small text-text-faint bg-surface/90 border border-line rounded-md px-2 py-1.5 pointer-events-none">
            No basemap configured — positions are accurate, streets are not drawn. Set
            <span className="mono"> NEXT_PUBLIC_MAP_STYLE_URL</span> to add one.
          </p>
        ) : null}

        {chosen ? (
          <div className="absolute top-2 left-2 card p-3 max-w-[260px]">
            <p className="t-heading truncate-1">{chosen.name}</p>
            <p className="t-small text-text-faint mono">
              {chosen.vehiclePlate || 'no active vehicle'}
            </p>
            <div className="flex gap-1.5 mt-2">
              <a href={`/drivers/${chosen.id}`} className="btn btn-secondary btn-sm">
                Driver
              </a>
              {chosen.activeTripId ? (
                <a href={`/trips/${chosen.activeTripId}`} className="btn btn-primary btn-sm">
                  Live trip
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 min-w-0">
        <div className="card p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 t-small">
              <span
                className={`dot ${live ? 'dot-live text-accent' : 'text-text-faint'}`}
                aria-hidden="true"
              />
              <span className={live ? 'text-text-dim' : 'text-text-faint'}>
                {live ? `every ${intervalSeconds}s` : 'paused'}
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setLive((v) => !v)}
                aria-pressed={live}
              >
                {live ? 'Pause' : 'Resume'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
                <Icon name="refresh" size={13} />
                Now
              </button>
            </div>
          </div>
          <p className="t-small text-text-faint mt-1.5" aria-live="polite">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : updatedAt ? (
              `Updated ${updatedAt.toLocaleTimeString()} · ${located.length} located${
                noFix ? `, ${noFix} without a GPS fix` : ''
              }`
            ) : (
              'Waiting for the first fix…'
            )}
          </p>
        </div>

        <div className="card-flush flex-1 min-h-0 flex flex-col">
          <div className="px-3 py-2 border-b border-line flex items-center justify-between">
            <span className="t-eyebrow">Online now</span>
            <span className="t-small text-text-faint num">{drivers.length}</span>
          </div>
          {drivers.length === 0 ? (
            <p className="p-4 t-small text-text-faint">
              No driver is online. Nothing can be dispatched right now.
            </p>
          ) : (
            /* Doubles as the non-visual alternative to the map: everything the
               markers convey is here as text, in the same order. */
            <ul className="overflow-y-auto divide-y divide-line">
              {drivers.map((d) => {
                const busy = !!d.activeTripId;
                const positioned = typeof d.lat === 'number' && typeof d.lng === 'number';
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => focus(d)}
                      disabled={!positioned}
                      aria-current={selected === d.id ? 'true' : undefined}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-2 disabled:opacity-55 disabled:cursor-not-allowed ${
                        selected === d.id ? 'bg-surface-2' : ''
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-none ${
                          busy ? 'bg-info' : 'bg-accent'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block t-body truncate-1">{d.name}</span>
                        <span className="block t-small text-text-faint truncate-1">
                          {d.vehiclePlate ? <span className="mono">{d.vehiclePlate}</span> : 'no vehicle'}
                          {' · '}
                          {busy ? 'on a trip' : 'free'}
                          {positioned ? '' : ' · no GPS'}
                        </span>
                      </span>
                      {busy ? <Icon name="route" size={13} className="text-info flex-none" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
