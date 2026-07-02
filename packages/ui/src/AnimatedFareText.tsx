import React, { useEffect, useRef, useState } from 'react';
import { fonts, fontSizes } from '@eyego/config';
import { Text } from './Text';
import { ShinyText } from './ShinyText';
import { useThemedColors } from './ColorsContext';
import type { TextVariant } from './Text';

const FARE_SIZE: Partial<Record<TextVariant, number>> = {
  fareLarge: fontSizes.fareLarge,
  fareMedium: fontSizes.fareMedium,
  fareSmall: fontSizes.fareSmall,
  fareInline: fontSizes.fareInline,
};

interface AnimatedFareTextProps {
  value: number;
  prefix?: string;
  variant?: TextVariant;
  color?: string;
  /** Adds a premium shine sweep — reserved for a single hero fare number
   * (e.g. ride confirmation), not every fare row in a list. */
  shiny?: boolean;
}

export function AnimatedFareText({
  value,
  prefix = 'GH₵ ',
  variant = 'fareLarge',
  color,
  shiny = false,
}: AnimatedFareTextProps) {
  const colors = useThemedColors();
  const [displayValue, setDisplayValue] = useState(value);
  // Keep a ref to the current display value so the animation effect can snapshot
  // it as the start value without adding it to the dep array (which would restart
  // the animation on every intermediate step and cause infinite re-triggering).
  const displayValueRef = useRef(displayValue);
  displayValueRef.current = displayValue;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const startValue = displayValueRef.current;
    const endValue = value;
    const steps = 20;
    const duration = 400;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = startValue + (endValue - startValue) * eased;
      setDisplayValue(Math.round(current * 100) / 100);

      if (step >= steps) {
        clearInterval(interval);
        setDisplayValue(endValue);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [value]);

  const formatted = `${prefix}${displayValue.toFixed(2)}`;

  if (shiny) {
    const fontSize = FARE_SIZE[variant] ?? fontSizes.fareLarge;
    return (
      <ShinyText
        baseColor={color ?? colors.primary}
        textStyle={{ fontFamily: fonts.monoBold, fontSize }}
      >
        {formatted}
      </ShinyText>
    );
  }

  return (
    <Text variant={variant} color={color} style={{ fontFamily: fonts.monoBold }}>
      {formatted}
    </Text>
  );
}
