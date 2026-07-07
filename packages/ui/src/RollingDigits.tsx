import React, { memo, useEffect, useRef } from 'react';
import { View, Text as RNText, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeOutDown,
  FadeOutUp,
  useReducedMotion,
} from 'react-native-reanimated';
import { fonts, springs } from '@eyego/config';

interface RollingDigitsProps {
  /** Pre-formatted string to render, e.g. "12m" or "1h 5m". */
  text: string;
  /**
   * Numeric value behind `text` — sets the roll direction (odometer style:
   * decreasing values roll downward, increasing roll upward). Omit for a
   * default downward roll.
   */
  value?: number;
  fontSize: number;
  color: string;
  fontFamily?: string;
  style?: StyleProp<ViewStyle>;
}

const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/**
 * Per-digit rolling number — each digit lives in a fixed-width clipped slot;
 * when it changes, the old glyph rolls out and the new one rolls in
 * (translateY + opacity only, UI-thread entering/exiting springs). Non-digit
 * characters ("m", "h", spaces) render statically so only the numbers move.
 * Fixed slots + tabular numerals mean a tick never shifts surrounding layout.
 * Honors reduce-motion by swapping instantly.
 */
export const RollingDigits = memo(function RollingDigits({
  text,
  value,
  fontSize,
  color,
  fontFamily = fonts.semiBold,
  style,
}: RollingDigitsProps) {
  const reducedMotion = useReducedMotion();

  // Direction is read during render from the previous value; the ref updates
  // after commit so the comparison always sees the value being replaced.
  const prevValueRef = useRef(value ?? 0);
  const rollingDown = (value ?? 0) <= prevValueRef.current;
  useEffect(() => {
    prevValueRef.current = value ?? 0;
  }, [value]);

  const slotH = Math.ceil(fontSize * 1.3);
  const digitW = Math.ceil(fontSize * 0.62);
  const glyphStyle: TextStyle = {
    fontFamily,
    fontSize,
    lineHeight: slotH,
    color,
    fontVariant: ['tabular-nums'],
  };

  if (reducedMotion) {
    return (
      <View style={style}>
        <RNText style={glyphStyle}>{text}</RNText>
      </View>
    );
  }

  const travel = Math.round(slotH * 0.6);
  const entering = (rollingDown ? FadeInUp : FadeInDown)
    .withInitialValues({ transform: [{ translateY: rollingDown ? -travel : travel }] })
    .springify()
    .duration(springs.snappy.duration)
    .dampingRatio(springs.snappy.dampingRatio);
  const exiting = (rollingDown ? FadeOutDown : FadeOutUp).duration(140);

  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center' }, style]}
      accessible
      accessibilityLabel={text}
    >
      {text.split('').map((ch, i) =>
        isDigit(ch) ? (
          <View key={`slot-${i}`} style={{ width: digitW, height: slotH, overflow: 'hidden' }}>
            <Animated.Text
              key={ch}
              entering={entering}
              exiting={exiting}
              style={[glyphStyle, { position: 'absolute', left: 0, right: 0, textAlign: 'center' }]}
            >
              {ch}
            </Animated.Text>
          </View>
        ) : (
          <RNText key={`static-${i}-${ch}`} style={glyphStyle}>
            {ch}
          </RNText>
        ),
      )}
    </View>
  );
});
