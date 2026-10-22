import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Rect, FractalNoise } from '@shopify/react-native-skia';

/**
 * Film grain over the splash, onboarding and auth scenes — 3.5 % fractal noise,
 * drawn ONCE. Nothing here is animated, so after the first frame it costs the
 * GPU a cached layer and the JS thread nothing.
 */
export function Grain({ opacity = 0.035 }: { opacity?: number }) {
  const { width, height } = useWindowDimensions();
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} opacity={opacity}>
        <FractalNoise freqX={0.9} freqY={0.9} octaves={2} />
      </Rect>
    </Canvas>
  );
}
