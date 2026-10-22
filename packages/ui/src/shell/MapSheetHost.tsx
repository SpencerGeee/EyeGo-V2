import React, { useEffect, useMemo } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { spacing } from '@eyego/config';
import { CardAuroraGlow } from '../effects/CardAuroraGlow';
import { GlassSurface } from '../effects/GlassSurface';
import { MorphSheet } from '../panel/MorphSheet';
import { useSheetSlots, SheetSections, type SheetSectionsProps } from './sheetSlot';
import { SnapSheet } from '../panel/SnapSheet';
import { depthIncoming, depthOutgoing, useDepthMotion, type DepthDirection } from '../motion/depth';


/**
 * The one sheet, hosted above every stage.
 *
 * Lifted out of the rider's `TripSheetHost` so the driver's surface can be the
 * same object rather than a second implementation of it. The rider's file is
 * now a shim that supplies its own chrome table and renders this.
 *
 * It subscribes to the slot store; the surface passes it only stage NAMES,
 * which are strings and therefore stable. That asymmetry is the point: the host
 * re-renders whenever a stage republishes its panel, and the surface — and
 * through it the stages themselves — does not.
 *
 * The crossfade here is the second half of the transition. The surface still
 * crossfades the map-level chrome (headers, chips, the pieces that float over
 * the map); this crossfades the panel bodies. They run on separate springs with
 * the same token, so they stay in step without being coupled.
 */

/**
 * Per-stage sheet chrome. Only what genuinely differs between stages.
 *
 * `collapsed` is a resting height for stages whose panel is a summary with
 * detail underneath. Without it such a panel opens at full height and buries
 * the map the user is watching something move across. A stage that omits it is
 * content-sized, which is what lets the sheet morph between them.
 */
export interface SheetChrome {
  radius: number;
  glass: boolean;
  collapsed?: number;
  aurora?: number;
}

export interface MapSheetHostProps<TStage extends string = string> {
  current: TStage;
  previous: TStage | null;
  /** Per-stage chrome. Missing entries fall back to `fallbackChrome`. */
  chromeFor: Record<string, SheetChrome>;
  /** Used when `current` has no entry — keeps the host total. */
  fallbackChrome: SheetChrome;
  /** The aurora / glow tint. Passed in because packages/ui has no app palette. */
  auroraColor: string;
  /** The sheet's fill when a stage is NOT glass. */
  solidBackground: string;
  /**
   * The flow is over and the surface is being torn down. The sheet leaves
   * rather than sitting over a screen that is already navigating away.
   */
  retired?: boolean;
  /** Extra body style, merged after the standard gutter. */
  bodyStyle?: ViewStyle;
  grabberColor?: string;
  /** The flow's order — a swap to an EARLIER stage turns the deck backwards. */
  stageOrder?: readonly TStage[];
  /**
   * Stages read at a glance while moving (live trip): the same assembly,
   * shorter and tighter, and a dimmer edge light.
   */
  liveStages?: readonly TStage[];
}

export function MapSheetHost<TStage extends string = string>({
  current,
  previous,
  chromeFor,
  fallbackChrome,
  auroraColor,
  solidBackground,
  retired = false,
  bodyStyle,
  grabberColor = 'rgba(255,255,255,0.18)',
  stageOrder,
  liveStages,
}: MapSheetHostProps<TStage>) {
  const slots = useSheetSlots((s) => s.slots);

  const currentNode = slots[current] ?? null;
  const ghostNode = previous ? slots[previous] ?? null : null;

  const chrome = chromeFor[current] ?? fallbackChrome;

  // 0 → 1 across a panel swap. One value drives both bodies, so they cannot
  // drift apart and show a gap or a double-exposure.
  const swap = useSharedValue(1);
  const dir = useSharedValue<DepthDirection>(1);
  useEffect(() => {
    if (!previous) return;
    const a = stageOrder?.indexOf(previous) ?? -1;
    const b = stageOrder?.indexOf(current) ?? -1;
    dir.value = a >= 0 && b >= 0 && b < a ? -1 : 1;
    swap.value = 0;
    swap.value = withTiming(1, { duration: 320, easing: Easing.linear });
  }, [current, previous, swap, dir, stageOrder]);

  /**
   * ONE MOVE PER STAGE CHANGE ("the morph from driver-is-here to arriving-in
   * is bad and laggy"). The sheet resizes on its own spring (MorphSheet) while
   * the panel fades through on one axis — the old body gone in the first third,
   * the new one rising in after it. No 3D turn, no row cascade, no edge sweep.
   */
  const depthOn = useDepthMotion();
  const incomingStyle = useAnimatedStyle(
    () => (depthOn ? depthIncoming(swap.value, dir.value) : { opacity: swap.value }),
    [depthOn],
  );
  const ghostStyle = useAnimatedStyle(
    () => (depthOn ? depthOutgoing(swap.value, dir.value) : { opacity: 1 - swap.value }),
    [depthOn],
  );

  /**
   * THE SHEET'S OWN FILL — glass, and the wash where a stage asks for one.
   *
   * `background` is rendered by MorphSheet directly inside the sheet body,
   * BEFORE padding is applied to anything. That matters: in React Native an
   * `absoluteFill` child is laid out against its parent's PADDING box, not its
   * border box, so a glow rendered inside the padded body is a rectangle inset
   * from each edge — and a radial gradient painted into a rect stops dead at
   * the rect's edge, leaving two hard vertical seams up the card. Here it
   * reaches the real edges and is clipped only by the sheet's rounded corners.
   *
   * It also belongs here on the merits: the light is a property of the surface,
   * not of whichever panel is currently inside it, which is why it survives a
   * stage change instead of unmounting and repainting with the content.
   */
  const background = useMemo(
    () => (
      <>
        {chrome.glass ? (
          <GlassSurface
            style={StyleSheet.absoluteFill}
            borderRadius={chrome.radius}
            intensity="low"
          />
        ) : null}
        {chrome.aurora != null ? (
          <CardAuroraGlow color={auroraColor} intensity={chrome.aurora} reach={0.5} />
        ) : null}
      </>
    ),
    [chrome.glass, chrome.radius, chrome.aurora, auroraColor],
  );

  if (retired || currentNode == null) return null;

  /**
   * A stage that publishes `SheetSections` gets the SNAP SHEET — peek / half /
   * full measured from its own sections, finger-tracked (see SnapSheet). It is
   * one instance across every such stage, so "driver arriving" → "on the trip"
   * is the same sheet re-fitting to new detents while the rows fade through.
   */
  if (React.isValidElement(currentNode) && currentNode.type === SheetSections) {
    const sec = currentNode.props as SheetSectionsProps;
    return (
      <SnapSheet
        resetKey={String(current)}
        peek={<Animated.View style={incomingStyle}>{sec.peek}</Animated.View>}
        half={sec.half ? <Animated.View style={incomingStyle}>{sec.half}</Animated.View> : undefined}
        footer={sec.footer}
        background={background}
        backgroundColor={chrome.glass ? undefined : solidBackground}
        radius={chrome.radius}
        grabberColor={grabberColor}
        gutter={spacing['2xl']}
      >
        {sec.children ? <Animated.View style={incomingStyle}>{sec.children}</Animated.View> : undefined}
      </SnapSheet>
    );
  }

  return (
    <MorphSheet
      radius={chrome.radius}
      collapsedHeightPct={chrome.collapsed}
      background={background}
      style={[
        styles.body,
        chrome.glass ? styles.glassBody : { backgroundColor: solidBackground },
        bodyStyle,
      ]}
      grabberColor={grabberColor}
      ghost={ghostNode ? <Animated.View style={ghostStyle}>{ghostNode}</Animated.View> : null}
    >
      {/* One fade-through for the whole panel — see depth.ts. */}
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
