import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, Keyframe, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useDepthMotion } from './depth';

/**
 * ── A STAGE ASSEMBLES ITSELF ────────────────────────────────────────────────
 *
 * ("the stages should transform and move around giving off the high-tech
 * feel"). Each direct child of a `Cascade` is a row; on mount the rows fly
 * forward out of depth — tipped back, lower, smaller — and lock flat in place
 * one after another. Going back (`dir` −1) they drop down out of the depth
 * above instead. `live` (live-trip stages, glanced at while moving) is the
 * same move, shorter and tighter.
 *
 * Mount-driven: a stage swap mounts the new body, so the cascade plays on
 * every change with no trigger to wire. Keyframes are built once per
 * (row, direction, strength) and shared — never `.delay()` a shared Keyframe,
 * its builders mutate (see depth.ts).
 */
export type CascadeStrength = 'full' | 'live';

const P = 800;
const LAND = Easing.bezier(0.16, 1, 0.3, 1);
const MAX_STAGGER_ROWS = 7;
type KF = InstanceType<typeof Keyframe>;
const cache = new Map<string, KF>();

/** Entering animation for row `i`. Worklet-free, cached. */
export function stageRow(i: number, dir: 1 | -1 = 1, strength: CascadeStrength = 'full'): KF {
  const k = `${Math.min(i, MAX_STAGGER_ROWS)}|${dir}|${strength}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const live = strength === 'live';
  const y = (live ? 14 : 34) * (dir > 0 ? 1 : -0.8);
  const tilt = (live ? 8 : 22) * (dir > 0 ? -1 : 0.8);
  const kf = new Keyframe({
    0: { opacity: 0, transform: [{ perspective: P }, { translateY: y }, { rotateX: `${tilt}deg` }, { scale: live ? 0.96 : 0.88 }] },
    55: { opacity: 1 },
    100: { opacity: 1, transform: [{ perspective: P }, { translateY: 0 }, { rotateX: '0deg' }, { scale: 1 }], easing: LAND },
  })
    .duration(live ? 380 : 560)
    .delay(Math.min(i, MAX_STAGGER_ROWS) * (live ? 34 : 60));
  cache.set(k, kf);
  return kf;
}

export function Cascade({
  children,
  dir = 1,
  strength = 'full',
  style,
  rowStyle,
}: {
  children: React.ReactNode;
  dir?: 1 | -1;
  strength?: CascadeStrength;
  style?: StyleProp<ViewStyle>;
  /** Applied to every row wrapper (e.g. `{ width: '100%' }` in a centred column). */
  rowStyle?: StyleProp<ViewStyle>;
}) {
  const depthOn = useDepthMotion();
  let i = 0;
  const rows = React.Children.map(children, (child) => {
    if (child == null || child === false) return null;
    const entering = depthOn ? stageRow(i, dir, strength) : FadeIn.duration(200);
    i += 1;
    return <Animated.View entering={entering} style={rowStyle}>{child}</Animated.View>;
  });
  return style ? <View style={style}>{rows}</View> : <>{rows}</>;
}

/**
 * The light that runs along a sheet's top edge as a new stage locks in — in
 * the direction of travel, once, then gone. `trigger` is the stage key.
 */
export function StageSweep({ trigger, dir = 1, color, dim = false }: { trigger: string; dir?: 1 | -1; color: string; dim?: boolean }) {
  const depthOn = useDepthMotion();
  const [w, setW] = useState(0);
  const k = useSharedValue(1);
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // arriving is not a change
    if (!depthOn) return;
    k.value = 0;
    k.value = withTiming(1, { duration: dim ? 520 : 760, easing: Easing.inOut(Easing.cubic) });
  }, [trigger, depthOn, dim, k]);
  const head = Math.max(80, w * 0.42);
  const s = useAnimatedStyle(() => {
    const p = dir > 0 ? k.value : 1 - k.value;
    return {
      opacity: k.value >= 1 ? 0 : Math.sin(Math.PI * k.value) * (dim ? 0.5 : 0.95),
      transform: [{ translateX: -head + p * (w + head) }],
    };
  }, [w, head, dir, dim]);
  return (
    <View pointerEvents="none" style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[{ width: head, height: '100%' }, s]}>
        <LinearGradient
          colors={['transparent', color, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, overflow: 'hidden' },
});
