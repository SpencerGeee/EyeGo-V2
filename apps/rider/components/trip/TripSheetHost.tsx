import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { GlassSurface, MorphSheet } from '@eyego/ui';
import { springs, spacing } from '@eyego/config';
import { useColors } from '../../utils/useColors';
import type { TripStage } from '../../stores/tripFlow.store';
import { useSheetSlots } from './sheetSlot';

/**
 * The one sheet, hosted above every stage.
 *
 * It subscribes to the slot store; the trip surface passes it only stage NAMES,
 * which are strings and therefore stable. That asymmetry is the point: the host
 * re-renders whenever a stage republishes its panel, and the trip surface —
 * and through it the stages themselves — does not.
 *
 * The crossfade here is the second half of the transition. The trip surface
 * still crossfades the map-level chrome (headers, chips, the pieces that float
 * over the map); this crossfades the panel bodies. They run on separate springs
 * with the same token, so they stay in step without being coupled.
 */

/**
 * Per-stage sheet chrome. Only what genuinely differs between stages.
 *
 * `collapsed` is a resting height for the two stages whose panel is a summary
 * with detail underneath — it is what the old InlayPanel's first detent was,
 * and dropping it would mean the tracking panel opens at full height and buries
 * the map the rider is watching the car move across. Every other stage is
 * content-sized, which is what lets the sheet morph between them.
 */
const SHEET_STYLE: Record<
  TripStage,
  { radius: number; glass: boolean; collapsed?: number }
> = {
  // The search sheet is the tallest and the most "surface"-like — glass lets
  // the ambient shader read through the empty space below its content.
  search: { radius: 32, glass: true },
  configure: { radius: 32, glass: true },
  select: { radius: 32, glass: true },
  // Once a ride exists the panel carries money and identity: solid, so nothing
  // behind it competes with a fare or a plate number.
  request: { radius: 28, glass: false },
  assigned: { radius: 28, glass: false, collapsed: 0.44 },
  // Less than `assigned`: the map earns more room once the rider is moving
  // through it rather than waiting at a kerb.
  tracking: { radius: 28, glass: false, collapsed: 0.34 },
};

export interface TripSheetHostProps {
  current: TripStage;
  previous: TripStage | null;
  /**
   * The trip is over and the surface is being torn down. The sheet leaves
   * rather than sitting over a screen that is already navigating away.
   */
  retired?: boolean;
}

export function TripSheetHost({ current, previous, retired = false }: TripSheetHostProps) {
  const colors = useColors();
  const slots = useSheetSlots((s) => s.slots);

  const currentNode = slots[current] ?? null;
  const ghostNode = previous ? slots[previous] ?? null : null;

  const chrome = SHEET_STYLE[current] ?? SHEET_STYLE.tracking;

  // 0 → 1 across a panel swap. One value drives both bodies, so they cannot
  // drift apart and show a gap or a double-exposure.
  const swap = useSharedValue(1);
  useEffect(() => {
    if (!previous) return;
    swap.value = 0;
    swap.value = withSpring(1, springs.morph);
  }, [current, previous, swap]);

  const incomingStyle = useAnimatedStyle(() => ({ opacity: swap.value }));
  const ghostStyle = useAnimatedStyle(() => ({ opacity: 1 - swap.value }));

  const background = useMemo(
    () =>
      chrome.glass ? (
        <GlassSurface style={StyleSheet.absoluteFill} borderRadius={chrome.radius} intensity="low" />
      ) : null,
    [chrome.glass, chrome.radius],
  );

  if (retired || currentNode == null) return null;

  return (
    <MorphSheet
      radius={chrome.radius}
      collapsedHeightPct={chrome.collapsed}
      background={background}
      style={[
        styles.body,
        chrome.glass ? styles.glassBody : { backgroundColor: colors.background },
      ]}
      grabberColor="rgba(255,255,255,0.18)"
      ghost={
        ghostNode ? (
          <Animated.View style={ghostStyle}>{ghostNode}</Animated.View>
        ) : null
      }
    >
      <Animated.View style={incomingStyle}>{currentNode}</Animated.View>
    </MorphSheet>
  );
}

const styles = StyleSheet.create({
  // Vertical safe area is MorphSheet's job — see its inner wrapper. This is
  // only the design gutter.
  body: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing.md,
  },
  glassBody: { backgroundColor: 'transparent' },
});
