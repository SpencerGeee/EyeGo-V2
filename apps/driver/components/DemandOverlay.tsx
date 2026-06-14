import React, { useMemo } from 'react';
import { Circle, Polygon } from 'react-native-maps';

// DemandOverlay renders a set of weighted circles on the driver's map to
// visualise areas of high rider demand.  Each cell from the heatmap API
// becomes a semi-transparent Circle whose radius and opacity scale with the
// demand-supply ratio.

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

function heatColor(ratio: number, primary: string): string {
  // ratio < 0.5 → low demand → subtle 22% opacity
  // ratio ≥ 1.5 → high demand → full 55% opacity
  const alpha = Math.min(0.55, Math.max(0.10, ratio * 0.35));
  const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${primary}${hex}`;
}

const DemandOverlay: React.FC<DemandOverlayProps> = ({ cells, primaryColor, visible }) => {
  const circles = useMemo(
    () =>
      cells.map((cell, idx) => {
        const radius = 200 + Math.min(cell.demandSupplyRatio * 150, 800);
        const fillColor = heatColor(cell.demandSupplyRatio, primaryColor);
        return (
          <Circle
            key={`heat-${idx}-${cell.lat.toFixed(4)}-${cell.lng.toFixed(4)}`}
            center={{ latitude: cell.lat, longitude: cell.lng }}
            radius={radius}
            fillColor={fillColor}
            strokeColor="transparent"
          />
        );
      }),
    [cells, primaryColor]
  );

  if (!visible || cells.length === 0) return null;

  return <>{circles}</>;
};

export default React.memo(DemandOverlay);
