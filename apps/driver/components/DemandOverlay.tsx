import React, { useMemo } from 'react';
import MapboxGL from '../utils/mapbox';

// DemandOverlay renders a set of weighted circles on the driver's map to
// visualise areas of high rider demand. Each cell from the heatmap API
// becomes a point feature whose circle radius/opacity scale with the
// demand-supply ratio, rendered as a single data-driven circle layer.

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

const DemandOverlay: React.FC<DemandOverlayProps> = ({ cells, primaryColor, visible }) => {
  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: cells.map((cell) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [cell.lng, cell.lat] },
        properties: {
          // Pixel radius (MapLibre circle-radius is screen-space, not meters)
          radiusPx: 20 + Math.min(cell.demandSupplyRatio * 15, 80),
          // ratio < 0.5 → low demand → subtle opacity; ratio >= 1.5 → high demand → full opacity
          opacity: Math.min(0.55, Math.max(0.1, cell.demandSupplyRatio * 0.35)),
        },
      })),
    }),
    [cells],
  );

  if (!visible || cells.length === 0) return null;

  return (
    <MapboxGL.ShapeSource id="demand-heatmap" shape={geojson}>
      <MapboxGL.CircleLayer
        id="demand-heatmap-circles"
        style={{
          circleRadius: ['get', 'radiusPx'],
          circleColor: primaryColor,
          circleOpacity: ['get', 'opacity'],
        }}
      />
    </MapboxGL.ShapeSource>
  );
};

export default React.memo(DemandOverlay);
