import React from 'react';
import { View, StyleSheet, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../utils/useColors';
import { VEHICLE_MODEL } from '../../assets/vehicle';

interface VehicleMarkerProps {
  /** Degrees clockwise from north — the smoothed bearing, not a raw GPS fix. */
  bearing: number;
  size?: number;
}

/**
 * The assigned driver's vehicle on the rider's map.
 *
 * BUGFIX ("it's not showing as the mini bus model on the map but rather the map
 * pin — check how uber does theirs"). The rider saw the same generic arrow the
 * idle nearby-driver pins use, so the one vehicle that matters looked identical
 * to the ambient ones, and nothing on the map said what was coming to collect
 * them.
 *
 * The rotation is the important half and it works regardless of the artwork:
 * the marker points along the driver's smoothed bearing, so the rider can read
 * which way the vehicle is facing and therefore which side of the road it is
 * on — which is the actual question at a kerb.
 *
 * Rendering falls back to the arrow puck while `VEHICLE_MODEL` is null. See
 * `assets/vehicle/index.ts` for the one-line switch and the spec the render has
 * to meet (top-down, nose up, centred, transparent).
 */
export function VehicleMarker({ bearing, size = 34 }: VehicleMarkerProps) {
  const colors = useColors();

  if (VEHICLE_MODEL) {
    return (
      <Image
        source={VEHICLE_MODEL}
        style={[
          styles.vehicleShadow,
          {
            width: size,
            height: size,
            transform: [{ rotate: `${bearing}deg` }],
          },
        ]}
        resizeMode="contain"
        // The vehicle is decoration for a fact the panel already states in
        // words ("your driver is 3 min away"), so it is not announced twice.
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }

  return (
    <View
      style={[
        styles.puck,
        {
          width: size * 0.76,
          height: size * 0.76,
          borderRadius: (size * 0.76) / 2,
          backgroundColor: colors.primary,
          borderColor: colors.rimLight,
          transform: [{ rotate: `${bearing}deg` }],
        },
      ]}
    >
      <Ionicons name="navigate" size={size * 0.47} color={colors.onPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The render is a pearl-white body with no contact shadow baked in, which is
  // ideal on the dark map style and weak on the light one, where a white
  // vehicle sits on near-white roads. iOS derives a shadow from the layer's
  // alpha, so this traces the vehicle's actual silhouette. Android is left
  // alone on purpose: `elevation` shadows the view's rectangular outline, not
  // the artwork, so it would draw a grey box around the bus.
  vehicleShadow: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.28,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    default: {},
  }),
  puck: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
