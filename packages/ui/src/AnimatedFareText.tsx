import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors, fonts, fontSizes } from '@eyego/config';
import { Text } from './Text';
import type { TextVariant } from './Text';

interface AnimatedFareTextProps {
  value: number;
  prefix?: string;
  variant?: TextVariant;
  color?: string;
}

export function AnimatedFareText({
  value,
  prefix = 'GH₵ ',
  variant = 'fareLarge',
  color,
}: AnimatedFareTextProps) {
  const [displayValue, setDisplayValue] = useState(value);
  // Keep a ref to the current display value so the animation effect can snapshot
  // it as the start value without adding it to the dep array (which would restart
  // the animation on every intermediate step and cause infinite re-triggering).
  const displayValueRef = useRef(displayValue);
  displayValueRef.current = displayValue;
  const animatedValue = useRef(new Animated.Value(value)).current;
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

  return (
    <Text variant={variant} color={color} style={{ fontFamily: fonts.monoBold }}>
      {formatted}
    </Text>
  );
}
