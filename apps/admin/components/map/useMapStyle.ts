'use client';

import { useEffect, useState } from 'react';
import type { StyleSpecification } from 'maplibre-gl';

// The SAME styles the rider and driver apps render, from the same workspace
// package. They point at OpenFreeMap, which serves planet vector tiles with no
// API key and no quota — which is why the console can have a real basemap
// without a token, and why the map was blank before: it was configured to need
// one and no one had set NEXT_PUBLIC_MAP_STYLE_URL.
//
// Using the app styles is not just convenience. An operator looking at the fleet
// map and a rider looking at their ride now see the same city rendered the same
// way, which is what "one product" means.
import darkStyle from '@eyego/map-styles/eyego-dark.json';
import lightStyle from '@eyego/map-styles/eyego-light.json';

export type ThemeMode = 'dark' | 'light';

/**
 * Which palette the console is actually rendering in, resolved the same
 * three-way as globals.css: an explicit `data-theme` on <html> wins, otherwise
 * the OS preference, otherwise dark.
 *
 * Watches the attribute, so toggling the theme restyles the map instead of
 * leaving a dark map on a light page.
 */
export function useThemeMode(): ThemeMode {
  // Server render and first paint assume dark (the console's default) so the map
  // never flashes the wrong palette before hydration.
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');

    const resolve = () => {
      const explicit = root.getAttribute('data-theme');
      if (explicit === 'light' || explicit === 'dark') return setMode(explicit);
      setMode(media.matches ? 'light' : 'dark');
    };

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    media.addEventListener('change', resolve);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', resolve);
    };
  }, []);

  return mode;
}

/**
 * An explicit style URL still wins when one is set — a deployment that has paid
 * for MapTiler or Mapbox should use it — but the default is now a real map.
 */
const OVERRIDE = process.env.NEXT_PUBLIC_MAP_STYLE_URL;

export function mapStyleFor(mode: ThemeMode): string | StyleSpecification {
  if (OVERRIDE) return OVERRIDE;
  return (mode === 'light' ? lightStyle : darkStyle) as unknown as StyleSpecification;
}
