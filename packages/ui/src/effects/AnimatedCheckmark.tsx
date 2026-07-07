import React, { useEffect } from 'react';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useSharedValue, withDelay, withTiming, Easing } from 'react-native-reanimated';

/**
 * Success moment — circle stroke draws in, then the check stroke draws
 * with a slight ease-back. Skia path trimming (`start`/`end`) driven by
 * shared values, so the draw runs on the UI thread.
 */
export interface AnimatedCheckmarkProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function AnimatedCheckmark({ size = 64, color = '#4be277', strokeWidth = 4 }: AnimatedCheckmarkProps) {
  const circleEnd = useSharedValue(0);
  const checkEnd = useSharedValue(0);

  useEffect(() => {
    circleEnd.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) });
    checkEnd.value = withDelay(350, withTiming(1, { duration: 380, easing: Easing.out(Easing.back(1.6)) }));
  }, [circleEnd, checkEnd]);

  const s = size;
  const c = s / 2;
  const r = c - strokeWidth;

  const circlePath = Skia.Path.Make();
  circlePath.addCircle(c, c, r);

  const checkPath = Skia.Path.Make();
  checkPath.moveTo(s * 0.3, s * 0.52);
  checkPath.lineTo(s * 0.45, s * 0.66);
  checkPath.lineTo(s * 0.72, s * 0.36);

  return (
    <Canvas style={{ width: s, height: s }}>
      <Path path={circlePath} color={color} style="stroke" strokeWidth={strokeWidth} strokeCap="round" start={0} end={circleEnd} />
      <Path path={checkPath} color={color} style="stroke" strokeWidth={strokeWidth} strokeCap="round" strokeJoin="round" start={0} end={checkEnd} />
    </Canvas>
  );
}
