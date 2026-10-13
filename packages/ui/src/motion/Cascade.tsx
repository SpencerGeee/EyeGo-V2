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
  const counter = { i: 0 };
  const rows = cascadeRows(children, dir, strength, depthOn, rowStyle, counter, 0);
  return style ? <View style={style}>{rows}</View> : <>{rows}</>;
}

/**
 * Wraps each row of `node` in its entering animation. A panel usually hands
 * over ONE root — a Fragment, or a column View holding the rows — so a single
 * such root is opened (twice at most) and its own children cascade, keeping
 * the root's style. Rows that would not survive a wrapper are left alone:
 * anything absolutely positioned (it would be positioned against the wrapper),
 * and a horizontal View (its children are one row together).
 */
function cascadeRows(
  node: React.ReactNode,
  dir: 1 | -1,
  strength: CascadeStrength,
  depthOn: boolean,
  rowStyle: StyleProp<ViewStyle> | undefined,
  counter: { i: number },
  depth: number,
): React.ReactNode {
  const list = React.Children.toArray(node);
  if (list.length === 1 && depth < 2 && React.isValidElement(list[0])) {
    const root = list[0] as React.ReactElement<{ children?: React.ReactNode; style?: StyleProp<ViewStyle> }>;
    const flat = StyleSheet.flatten(root.props.style) ?? {};
    const opens = root.type === React.Fragment || (root.type === View && flat.flexDirection !== 'row' && flat.flexDirection !== 'row-reverse');
    if (opens && React.Children.count(root.props.children) > 1) {
      return React.cloneElement(root, undefined, cascadeRows(root.props.children, dir, strength, depthOn, rowStyle, counter, depth + 1));
    }
  }
  return list.map((child, idx) => {
    if (!React.isValidElement(child)) return child;
    const flat = StyleSheet.flatten((child.props as { style?: StyleProp<ViewStyle> }).style) ?? {};
    if (flat.position === 'absolute') return child;
    const entering = depthOn ? stageRow(counter.i, dir, strength) : FadeIn.duration(200);
    counter.i += 1;
    // A row that fills or stretches across its column keeps doing so through the wrapper.
    const fill: ViewStyle = {};
    if (flat.flex != null) fill.flex = flat.flex;
    if (flat.flexGrow != null) fill.flexGrow = flat.flexGrow;
    if (flat.alignSelf != null) fill.alignSelf = flat.alignSelf;
    if (typeof flat.width === 'string') fill.width = flat.width;
    return (
      <Animated.View key={child.key ?? idx} entering={entering} style={[fill, rowStyle]}>
        {child}
      </Animated.View>
    );
  });
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
