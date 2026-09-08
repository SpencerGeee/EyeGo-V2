import React, { useMemo } from 'react';
import MapboxGL from '../utils/mapbox';

/**
 * ── THE DEMAND HEAT MAP, AS ACTUAL GROUND ───────────────────────────────────
 *
 * BUGFIX ("I ordered a trip at my same location on the rider app, and the
 * driver app is showing the heatmap as km away from me — meanwhile it's
 * supposed to be here, since I'm the only one doing this").
 *
 * The server was already correct: `heatmap.service.js` reports the MEAN of the
 * real request coordinates in a cell, so one request produces a point exactly
 * on that request. The lie was drawn here.
 *
 * `circleRadius` in MapLibre is SCREEN SPACE. This asked for a flat 20–100 px
 * blob, which means the circle claims a completely different amount of ground
 * at every zoom level: at the home screen's zoom it is a few hundred metres, and
 * two pinches out it is a wash covering half of Accra. A driver reading that
 * blob has no way to tell where the demand actually is — the edge of a
 * fixed-pixel circle is kilometres from its centre the moment you zoom out,
 * which is precisely the report.
 *
 * The rider's dispatch search ring learned this already (`searchRing` in
 * TripMap.tsx): a circle that means something on the ground has to be measured
 * on the ground. So each cell now carries a real RADIUS IN METRES, converted to
 * the pixel radius it needs at two zoom stops, and interpolated between them
 * with an exponential base of 2 — which is exactly the rate a pixel covers less
 * ground as you zoom in. The blob therefore stays nailed to its patch of city.
 *
 * ── WHY THE RADIUS IS TIED TO THE CELL, NOT TO THE WEIGHT ───────────────────
 * The area a cell describes is fixed — it is an H3 cell (see `bucketKey` in
 * heatmap.service.js). Scaling the radius by demand would draw a bigger piece of
 * GROUND for a busier cell, which is a false statement about geography. Weight
 * belongs in the colour and the opacity, which is what those channels are for.
 */

interface HeatmapCell {
  lat: number;
  lng: number;
  weight: number;
  driversNearby: number;
  demandSupplyRatio: number;
}

interface DemandOverlayProps {
  cells: HeatmapCell[];
  primaryColor: string;
  visible: boolean;
}

/**
 * The ground each cell covers.
 *
 * H3 resolution 8 (what `h3-index.service` indexes demand at) has an edge of
 * roughly 460 m, so a ~600 m circle covers the cell without overstating it.
 * Cells that fell back to the 0.01° degree bucket are ~1.1 km, but drawing
 * those at the same size is the safer error: a blob that is slightly too small
 * is read as "demand around here", one that is too big is read as "demand
 * everywhere".
 */
const CELL_RADIUS_M = 600;

/** MapLibre/Mapbox web-mercator constant: metres per pixel at zoom 0, equator. */
const M_PER_PX_Z0 = 156543.03392;

/** The two zoom stops the interpolation is anchored to. */
const Z_LO = 9;
const Z_HI = 17;

/** Pixel radius that `metres` occupies at `zoom` for a given latitude. */
function pxRadius(metres: number, lat: number, zoom: number): number {
  const mPerPx = (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return metres / mPerPx;
}

const DemandOverlay: React.FC<DemandOverlayProps> = ({ cells, primaryColor, visible }) => {
  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: cells.map((cell) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [cell.lng, cell.lat] },
        properties: {
          /**
           * The same ground, expressed at both interpolation stops. With an
           * exponential base of 2 the value between them is the ground-true
           * radius at every intermediate zoom — no per-frame work, no reading
           * the camera, and correct while the driver is still pinching.
           *
           * Clamped at the low end so a cell never collapses into an
           * indistinguishable dot when the whole city is on screen, and at the
           * high end so a deep zoom does not paint the entire viewport.
           */
          rLo: Math.max(3, pxRadius(CELL_RADIUS_M, cell.lat, Z_LO)),
          rHi: Math.min(260, pxRadius(CELL_RADIUS_M, cell.lat, Z_HI)),
          /**
           * Colour and opacity carry the HEAT, which is the only thing that
           * varies per cell. `demandSupplyRatio` rather than raw weight: ten
           * requests with ten drivers already there is not a place worth
           * driving to, and the ratio is the number that says so.
           */
          opacity: Math.min(0.5, Math.max(0.12, cell.demandSupplyRatio * 0.3)),
          ratio: cell.demandSupplyRatio,
        },
      })),
    }),
    [cells],
  );

  if (!visible || cells.length === 0) return null;

  return (
    <MapboxGL.ShapeSource id="demand-heatmap" shape={geojson}>
      {/*
        A soft outer field, then a tighter core. Two layers rather than one
        because a single flat disc reads as a UI element sitting on the map; a
        core inside a halo reads as intensity, which is what a heat map is
        supposed to communicate.
      */}
      <MapboxGL.CircleLayer
        id="demand-heatmap-halo"
        style={{
          circleRadius: [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            Z_LO,
            ['get', 'rLo'],
            Z_HI,
            ['get', 'rHi'],
          ],
          circleColor: primaryColor,
          circleOpacity: ['*', ['get', 'opacity'], 0.55],
        }}
      />
      <MapboxGL.CircleLayer
        id="demand-heatmap-core"
        style={{
          circleRadius: [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            Z_LO,
            ['*', ['get', 'rLo'], 0.45],
            Z_HI,
            ['*', ['get', 'rHi'], 0.45],
          ],
          circleColor: primaryColor,
          circleOpacity: ['get', 'opacity'],
        }}
      />
    </MapboxGL.ShapeSource>
  );
};

export default React.memo(DemandOverlay);
