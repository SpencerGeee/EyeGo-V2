import React from 'react';
import { ViewStyle, DimensionValue } from 'react-native';
import { MotiView } from 'moti';
import { radii } from '@eyego/config';
import { useThemedColors } from './ColorsContext';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = radii.md, style }: SkeletonProps) {
  const colors = useThemedColors();
  return (
    <MotiView
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.75 }}
      transition={{
        loop: true,
        type: 'timing',
        duration: 900,
        repeatReverse: true,
      }}
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.surfaceCard,
        },
        style,
      ]}
    />
  );
}
