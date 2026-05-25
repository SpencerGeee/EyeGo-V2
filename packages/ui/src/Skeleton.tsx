import React from 'react';
import { ViewStyle } from 'react-native';
import { MotiView } from 'moti';
import { colors, radii } from '@eyego/config';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = radii.md, style }: SkeletonProps) {
  return (
    <MotiView
      from={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{
        loop: true,
        type: 'timing',
        duration: 800,
        repeatReverse: true,
      }}
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: colors.surfaceContainerHigh,
        },
        style,
      ]}
    />
  );
}
