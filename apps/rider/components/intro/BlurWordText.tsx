import React from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { FadeOut, Keyframe } from 'react-native-reanimated';

/** Soft ease-out for entrances — the one curve the intro uses. */
export const EASE_IN_SOFT = [0.22, 1, 0.36, 1] as const;

/**
 * Words arriving one after another: each rises 8 pt, sharpens out of a slight
 * shrink and fades in, 50 ms behind the last; the previous line leaves fast.
 *
 * NOTE — real per-word BLUR is the fallback here, by design. Gaussian blur on
 * text means a Skia text layer per word re-rendered every frame of the swap,
 * which costs more than the whole particle field on a mid-range Android. The
 * scale 0.96 → 1 + opacity + rise reads as "coming into focus" at a fraction
 * of the cost. Reduce Motion: a plain 150 ms fade.
 */
const wordIn = (i: number, reduced: boolean) =>
  reduced
    ? new Keyframe({ 0: { opacity: 0 }, 100: { opacity: 1 } }).duration(150)
    : new Keyframe({
        0: { opacity: 0, transform: [{ translateY: 8 }, { scale: 0.96 }] },
        100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
      })
        .duration(400)
        .delay(i * 50);

export function BlurWordText({
  text,
  textKey,
  style,
  containerStyle,
  reduced = false,
  baseDelay = 0,
}: {
  text: string;
  /** Changing it replays the reveal (the slide index). */
  textKey: string | number;
  style: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  reduced?: boolean;
  /** Hold the first word this long (the subtitle waits for the title). */
  baseDelay?: number;
}) {
  const words = text.split(' ');
  return (
    <Animated.View
      key={String(textKey)}
      exiting={FadeOut.duration(reduced ? 120 : 140)}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }, containerStyle]}
      accessible
      accessibilityLabel={text}
    >
      {words.map((w, i) => (
        <Animated.Text key={`${i}-${w}`} entering={wordIn(i + Math.round(baseDelay / 50), reduced)} style={style}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </Animated.Text>
      ))}
    </Animated.View>
  );
}

/** Reserves the space a block of text will need so a swap never reflows the card. */
export function Reserve({ height, children }: { height: number; children: React.ReactNode }) {
  return <View style={{ minHeight: height, justifyContent: 'flex-start' }}>{children}</View>;
}
