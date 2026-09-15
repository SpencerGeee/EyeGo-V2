import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@eyego/ui';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';

/**
 * ── THE VEHICLE, SEEN FROM ABOVE ────────────────────────────────────────────
 *
 * A replica of the reference frame (screenshots/seat.jpg): the van as a lit
 * white outline on a dark ground, the windscreen and headlights at the nose,
 * the sliding door with its green kerb strip, the driver's wheel, and seats as
 * seat-shaped glyphs — headrest, cushion, armrests — rather than numbered
 * squares. Available is a clean outline, selected is the accent lit from
 * within, occupied is muted with a crossed-out figure.
 *
 * NOSE-UP. The reference is a landscape frame and the phone is portrait, so the
 * vehicle is turned 90°: the nose is at the top, the driver on the LEFT (Ghana
 * drives on the right, so the wheel is on the left), the sliding door on the
 * RIGHT, which is the kerb side a rider actually boards from. Numbers stay
 * upright — turning them with the body, as the reference does, costs
 * readability for no gain on a screen that is already the right way up.
 *
 * ── HOW IT ARRIVES ──────────────────────────────────────────────────────────
 *
 * The body outline DRAWS itself — a stroke-dashoffset sweep around the shell
 * over ~900 ms on the UI thread — and the glow rises behind it as it closes.
 * Seats fade in a row at a time, front to back, in the wake of the stroke.
 * Nothing here blocks a tap: the seats are pressable from their first frame,
 * the animation is decoration around a choice, not a gate in front of it.
 * Reduced motion draws everything flat.
 *
 * Everything is `react-native-svg` plus Reanimated. No Skia, no GL: a seat map
 * is looked at for one tap and must not cost a context to render.
 */

export type CabinSeat = {
  id: string;
  number: number;
  status: 'AVAILABLE' | 'PENDING' | 'OCCUPIED' | 'SELECTED' | 'RESERVED';
};

/**
 * How the cabin is laid out, chosen by capacity. `null` is the aisle.
 *
 * Every template is: the front passenger seat beside the driver, rows of one
 * either side of the aisle, and a rear bench of up to four across — the
 * Sprinter arrangement anyone who has ridden a trotro knows. A row of three or
 * four with no aisle is the bench, and it is always the last row.
 */
type Row = (number | null)[];

export function layoutFor(count: number): { rows: Row[]; label: string } {
  const n = Math.max(1, Math.min(count, 19));
  if (n <= 5) {
    // Saloon: the seat beside the driver, then the back bench.
    const bench = [2, 3, 4, 5].filter((s) => s <= n);
    return { label: 'Saloon', rows: bench.length ? [[1], bench] : [[1]] };
  }
  const label = n <= 9 ? 'Van' : 'Minibus';
  // Rows of two either side of the aisle until at most four remain for the bench.
  const rows: Row[] = [[1]];
  let next = 2;
  while (n - next + 1 > 4) {
    rows.push([next, null, next + 1]);
    next += 2;
  }
  const bench: number[] = [];
  for (let s = next; s <= n; s += 1) bench.push(s);
  if (bench.length) rows.push(bench);
  return { label, rows };
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The seat glyph's box is square; the headrest lives in its top fifth. */
const GAP = 10;
const BODY_PAD_X = 30;
const NOSE_H = 96;
const REAR_PAD = 28;
const DOOR_W = 7;

export function VehicleCabin({
  seats,
  seatCount,
  selectedId,
  onSelect,
  colors,
  accent,
  fareLabel,
  tierLabel = 'Standard',
}: {
  seats: CabinSeat[];
  seatCount: number;
  selectedId: string | null;
  onSelect: (seat: CabinSeat) => void;
  colors: Record<string, string>;
  accent: string;
  /** Shown in the tooltip above the chosen seat. Null hides the tooltip. */
  fareLabel: string | null;
  tierLabel?: string;
}) {
  const reduced = useReducedMotion();
  const { width: screenW } = useWindowDimensions();

  const { rows } = useMemo(() => layoutFor(seatCount || seats.length || 4), [seatCount, seats.length]);
  const byNumber = useMemo(() => new Map(seats.map((s) => [s.number, s])), [seats]);

  // ── Geometry ─────────────────────────────────────────────────────────────
  const W = Math.min(screenW - spacing.xl * 2, 380);
  const innerW = W - BODY_PAD_X * 2;
  const widestCount = rows.reduce((m, r) => Math.max(m, r.filter((s) => s !== null).length), 1);
  const across = Math.max(4, widestCount);
  const T = Math.min(50, Math.floor((innerW - GAP * (across - 1)) / across));
  const rowH = T + GAP + 4;
  const H = NOSE_H + rows.length * rowH + REAR_PAD;

  /** Where each seat number sits, in canvas coordinates (top-left of its box). */
  const positions = useMemo(() => {
    const map = new Map<number, { x: number; y: number; row: number }>();
    rows.forEach((row, ri) => {
      const y = NOSE_H + ri * rowH;
      const tiles = row.filter((s) => s !== null).length;
      if (ri === 0) {
        // Front row: the passenger seat(s) sit to the RIGHT of the driver.
        const rightEdge = W - BODY_PAD_X;
        row.forEach((slot, i) => {
          if (slot !== null) map.set(slot, { x: rightEdge - (tiles - i) * (T + GAP) + GAP, y, row: ri });
        });
        return;
      }
      if (row.includes(null)) {
        // One either side of the aisle, hugging the walls like the real thing.
        const [left, , right] = row;
        if (left != null) map.set(left, { x: BODY_PAD_X, y, row: ri });
        if (right != null) map.set(right, { x: W - BODY_PAD_X - T, y, row: ri });
        return;
      }
      // The bench: centred, packed.
      const total = tiles * T + (tiles - 1) * GAP;
      const start = (W - total) / 2;
      row.forEach((slot, i) => {
        if (slot !== null) map.set(slot, { x: start + i * (T + GAP), y, row: ri });
      });
    });
    return map;
  }, [rows, rowH, T, W]);

  // ── Body art ─────────────────────────────────────────────────────────────
  const stroke = colors.onSurface ?? '#FFFFFF';
  const led = colors.statusSuccess ?? '#22C55E';
  const bx = 8;
  const bw = W - 16;
  const noseR = Math.min(bw * 0.34, 120);
  const rearR = 22;
  // Nose-up van silhouette: a broad rounded bonnet, straight flanks, a squarer rear.
  const body = [
    `M ${bx + noseR} 6`,
    `H ${bx + bw - noseR}`,
    `Q ${bx + bw} 6 ${bx + bw} ${6 + noseR}`,
    `V ${H - 6 - rearR}`,
    `Q ${bx + bw} ${H - 6} ${bx + bw - rearR} ${H - 6}`,
    `H ${bx + rearR}`,
    `Q ${bx} ${H - 6} ${bx} ${H - 6 - rearR}`,
    `V ${6 + noseR}`,
    `Q ${bx} 6 ${bx + noseR} 6`,
    'Z',
  ].join(' ');
  // Perimeter of the rounded shape, close enough to sweep a dash across.
  const bodyLen = 2 * (bw + (H - 12)) - 4 * noseR - 4 * rearR + Math.PI * (noseR + rearR);

  const windscreenTop = 30;
  const windscreenBottom = 68;
  const windscreen = [
    `M ${bx + 26} ${windscreenBottom}`,
    `Q ${W / 2} ${windscreenTop - 14} ${bx + bw - 26} ${windscreenBottom}`,
    `Q ${W / 2} ${windscreenBottom + 10} ${bx + 26} ${windscreenBottom}`,
    'Z',
  ].join(' ');

  const drawn = useSharedValue(reduced ? 1 : 0);
  const glow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    drawn.value = withDelay(60, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    glow.value = withDelay(
      420,
      withSequence(withTiming(1.35, { duration: 520 }), withTiming(1, { duration: 700 })),
    );
    // Mount only — the shell is drawn once, not on every seat tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outlineProps = useAnimatedProps(() => ({
    strokeDashoffset: bodyLen * (1 - drawn.value),
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, glow.value) * 0.9 }));
  const hotGlowStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, glow.value - 1) * 1.6 }));

  const selected = seats.find((s) => s.id === selectedId) ?? null;
  const selectedPos = selected ? positions.get(selected.number) ?? null : null;

  // Driver's position: left of the front passenger seat, on the same row.
  const driverX = BODY_PAD_X + T / 2;
  const driverY = NOSE_H + T / 2;

  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }}>
      {/* ── Ambient glow behind the shell. Two layers: the resting halo and
          a hotter one that flares as the outline closes, then settles. */}
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} pointerEvents="none">
        <Svg width={W} height={H}>
          <Path d={body} stroke={withOpacity(stroke, 0.07)} strokeWidth={18} fill="none" />
          <Path d={body} stroke={withOpacity(stroke, 0.12)} strokeWidth={8} fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, hotGlowStyle]} pointerEvents="none">
        <Svg width={W} height={H}>
          <Path d={body} stroke={withOpacity(stroke, 0.22)} strokeWidth={26} fill="none" />
        </Svg>
      </Animated.View>

      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="cabinFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={withOpacity(colors.surfaceContainerHigh ?? '#222', 0.62)} />
            <Stop offset="1" stopColor={withOpacity(colors.surfaceContainer ?? '#161616', 0.85)} />
          </LinearGradient>
          <LinearGradient id="glassFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={withOpacity(stroke, 0.16)} />
            <Stop offset="1" stopColor={withOpacity(stroke, 0.03)} />
          </LinearGradient>
        </Defs>

        {/* Floor pan */}
        <Path d={body} fill="url(#cabinFill)" />

        {/* Windscreen */}
        <Path d={windscreen} fill="url(#glassFill)" stroke={withOpacity(stroke, 0.45)} strokeWidth={1.25} />

        {/* Headlights — the two hottest strokes on the body. */}
        <Path
          d={`M ${bx + 14} ${6 + noseR * 0.55} Q ${bx + 18} ${6 + noseR * 0.2} ${bx + noseR * 0.55} 9`}
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={`M ${bx + bw - 14} ${6 + noseR * 0.55} Q ${bx + bw - 18} ${6 + noseR * 0.2} ${bx + bw - noseR * 0.55} 9`}
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />

        {/* Wing mirrors */}
        <Rect x={bx - 7} y={windscreenBottom - 6} width={9} height={16} rx={3} fill={withOpacity(stroke, 0.35)} />
        <Rect x={bx + bw - 2} y={windscreenBottom - 6} width={9} height={16} rx={3} fill={withOpacity(stroke, 0.35)} />

        {/* Wheel arches, front and rear */}
        {[NOSE_H + 4, H - REAR_PAD - rowH - 4].map((cy, i) => (
          <React.Fragment key={i}>
            <Path
              d={`M ${bx} ${cy - 22} q 10 22 0 44`}
              stroke={withOpacity(stroke, 0.3)}
              strokeWidth={1.5}
              fill="none"
            />
            <Path
              d={`M ${bx + bw} ${cy - 22} q -10 22 0 44`}
              stroke={withOpacity(stroke, 0.3)}
              strokeWidth={1.5}
              fill="none"
            />
          </React.Fragment>
        ))}

        {/* Sliding door on the kerb side, with the lit step strip. */}
        <Rect
          x={bx + bw - DOOR_W - 3}
          y={NOSE_H + rowH - 4}
          width={DOOR_W}
          height={rowH * 2 - 6}
          rx={3}
          fill={withOpacity(stroke, 0.08)}
          stroke={withOpacity(stroke, 0.35)}
          strokeWidth={1}
        />
        <Rect
          x={bx + bw - DOOR_W - 1}
          y={NOSE_H + rowH + 2}
          width={3}
          height={rowH * 2 - 18}
          rx={1.5}
          fill={led}
        />
        <Rect
          x={bx + bw - DOOR_W - 5}
          y={NOSE_H + rowH - 2}
          width={11}
          height={rowH * 2 - 10}
          rx={5}
          fill={withOpacity(led, 0.16)}
        />

        {/* Aisle — a faint runway between the banks, so the gap reads as a gap. */}
        {rows.length > 2 ? (
          <Rect
            x={BODY_PAD_X + T + GAP * 1.5}
            y={NOSE_H + rowH - 2}
            width={W - 2 * (BODY_PAD_X + T + GAP * 1.5)}
            height={(rows.length - 2) * rowH}
            rx={10}
            fill={withOpacity(stroke, 0.035)}
          />
        ) : null}

        {/* Driver: wheel, hub and three spokes. */}
        <Circle cx={driverX} cy={driverY} r={T * 0.36} stroke={withOpacity(stroke, 0.6)} strokeWidth={2.5} fill="none" />
        <Circle cx={driverX} cy={driverY} r={T * 0.09} fill={withOpacity(stroke, 0.6)} />
        <Line x1={driverX} y1={driverY} x2={driverX} y2={driverY + T * 0.36} stroke={withOpacity(stroke, 0.6)} strokeWidth={2.5} />
        <Line x1={driverX} y1={driverY} x2={driverX - T * 0.31} y2={driverY - T * 0.18} stroke={withOpacity(stroke, 0.6)} strokeWidth={2.5} />
        <Line x1={driverX} y1={driverY} x2={driverX + T * 0.31} y2={driverY - T * 0.18} stroke={withOpacity(stroke, 0.6)} strokeWidth={2.5} />

        {/* The outline itself, drawn in. */}
        <AnimatedPath
          d={body}
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={[bodyLen, bodyLen]}
          animatedProps={outlineProps}
        />
      </Svg>

      {rows.flatMap((row, ri) =>
        row.map((slot) => {
          if (slot === null) return null;
          const seat = byNumber.get(slot);
          const pos = positions.get(slot);
          if (!seat || !pos) return null;
          return (
            <SeatGlyph
              key={seat.id}
              seat={seat}
              size={T}
              x={pos.x}
              y={pos.y}
              delay={reduced ? 0 : 260 + ri * 55}
              selected={seat.id === selectedId}
              onSelect={onSelect}
              colors={colors}
              accent={accent}
              stroke={stroke}
            />
          );
        }),
      )}

      {selected && selectedPos && fareLabel ? (
        <PriceTag
          key={selected.id}
          x={selectedPos.x + T / 2}
          y={selectedPos.y}
          canvasW={W}
          fareLabel={fareLabel}
          tierLabel={tierLabel}
          colors={colors}
        />
      ) : null}
    </View>
  );
}

// ─── One seat ───────────────────────────────────────────────────────────────

function SeatGlyph({
  seat,
  size,
  x,
  y,
  delay,
  selected,
  onSelect,
  colors,
  accent,
  stroke,
}: {
  seat: CabinSeat;
  size: number;
  x: number;
  y: number;
  delay: number;
  selected: boolean;
  onSelect: (seat: CabinSeat) => void;
  colors: Record<string, string>;
  accent: string;
  stroke: string;
}) {
  const available = seat.status === 'AVAILABLE';
  const held = seat.status === 'PENDING';
  const T = size;

  const press = useSharedValue(1);
  const lit = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    lit.value = withSpring(selected ? 1 : 0, springs.standard);
    if (selected) {
      // The chosen seat takes a breath: up, then settles — one spring, no loop.
      press.value = withSequence(withSpring(1.1, springs.standard), withSpring(1, springs.standard));
    }
  }, [selected, lit, press]);

  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: lit.value,
    transform: [{ scale: 0.8 + 0.5 * lit.value }],
  }));

  const line = available ? withOpacity(stroke, 0.62) : held ? colors.statusWarning : withOpacity(stroke, 0.18);
  const fill = selected ? accent : available ? withOpacity(stroke, 0.06) : withOpacity(colors.surfaceContainer ?? '#161616', 0.9);
  const trim = selected ? withOpacity('#FFFFFF', 0.55) : line;

  return (
    <Animated.View
      entering={FadeInUp.delay(delay).duration(260).reduceMotion(ReduceMotion.System)}
      style={{ position: 'absolute', left: x, top: y, width: T, height: T }}
    >
      {/* Halo — the "glowing accent" of the legend. A soft disc under the seat
          rather than a shadow, because Android draws no coloured shadows. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: -T * 0.35,
            top: -T * 0.35,
            width: T * 1.7,
            height: T * 1.7,
            borderRadius: T,
            backgroundColor: withOpacity(accent, 0.28),
          },
          haloStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: -T * 0.12,
            top: -T * 0.12,
            width: T * 1.24,
            height: T * 1.24,
            borderRadius: T * 0.4,
            backgroundColor: withOpacity(accent, 0.34),
          },
          haloStyle,
        ]}
      />

      <Pressable
        onPressIn={() => {
          if (available) press.value = withSpring(0.92, springs.standard);
        }}
        onPressOut={() => {
          if (available) press.value = withSpring(1, springs.standard);
        }}
        onPress={() => onSelect(seat)}
        disabled={!available}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !available }}
        accessibilityLabel={
          available
            ? `Seat ${seat.number}, available`
            : held
              ? `Seat ${seat.number}, on hold`
              : `Seat ${seat.number}, taken`
        }
        style={{ width: T, height: T }}
      >
        <Animated.View style={[{ width: T, height: T }, bodyStyle]}>
          <Svg width={T} height={T} style={StyleSheet.absoluteFill}>
            {/* Headrest */}
            <Rect x={T * 0.26} y={T * 0.02} width={T * 0.48} height={T * 0.15} rx={T * 0.06} fill={fill} stroke={trim} strokeWidth={1.25} />
            {/* Armrests */}
            <Rect x={T * 0.02} y={T * 0.3} width={T * 0.12} height={T * 0.5} rx={T * 0.05} fill={fill} stroke={trim} strokeWidth={1.25} />
            <Rect x={T * 0.86} y={T * 0.3} width={T * 0.12} height={T * 0.5} rx={T * 0.05} fill={fill} stroke={trim} strokeWidth={1.25} />
            {/* Cushion */}
            <Rect
              x={T * 0.15}
              y={T * 0.2}
              width={T * 0.7}
              height={T * 0.68}
              rx={T * 0.14}
              fill={fill}
              stroke={selected ? withOpacity('#FFFFFF', 0.7) : line}
              strokeWidth={selected ? 1.5 : 1.25}
              strokeDasharray={held ? [3, 3] : undefined}
            />
          </Svg>
          <View style={[StyleSheet.absoluteFill, styles.centre, { paddingTop: T * 0.16 }]} pointerEvents="none">
            {available || held ? (
              <Text
                style={{
                  fontFamily: fonts.semiBold,
                  fontSize: Math.max(11, T * 0.27),
                  lineHeight: Math.max(13, T * 0.32),
                  color: selected ? '#FFFFFF' : held ? colors.statusWarning : withOpacity(stroke, 0.82),
                  letterSpacing: 0.4,
                }}
              >
                {String(seat.number).padStart(2, '0')}
              </Text>
            ) : (
              <Ionicons name="person-remove-outline" size={Math.max(12, T * 0.3)} color={withOpacity(stroke, 0.28)} />
            )}
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// ─── The price, above the chosen seat ───────────────────────────────────────

function PriceTag({
  x,
  y,
  canvasW,
  fareLabel,
  tierLabel,
  colors,
}: {
  x: number;
  y: number;
  canvasW: number;
  fareLabel: string;
  tierLabel: string;
  colors: Record<string, string>;
}) {
  const TAG_W = 124;
  const TAG_H = 50;
  const left = Math.max(4, Math.min(canvasW - TAG_W - 4, x - TAG_W / 2));
  const top = y - TAG_H - 12;
  // The pointer follows the seat even when the tag itself has been clamped.
  const pointerLeft = Math.max(10, Math.min(TAG_W - 22, x - left - 6));
  return (
    <Animated.View
      entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
      pointerEvents="none"
      style={[
        styles.tag,
        {
          left,
          top,
          width: TAG_W,
          height: TAG_H,
          backgroundColor: withOpacity(colors.surfaceContainerHighest ?? '#2C2C30', 0.96),
          borderColor: withOpacity(colors.onSurface ?? '#FFFFFF', 0.14),
        },
      ]}
    >
      <Text style={[styles.tagFare, { color: colors.onSurface }]}>{fareLabel}</Text>
      <Text style={[styles.tagTier, { color: colors.onSurfaceVariant }]}>{tierLabel}</Text>
      <View
        style={[
          styles.tagPointer,
          {
            left: pointerLeft,
            backgroundColor: withOpacity(colors.surfaceContainerHighest ?? '#2C2C30', 0.96),
            borderColor: withOpacity(colors.onSurface ?? '#FFFFFF', 0.14),
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
  tag: {
    position: 'absolute',
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tagFare: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.titleSmall, lineHeight: Math.round(fontSizes.titleSmall * 1.25) },
  tagTier: { fontFamily: fonts.medium, fontSize: fontSizes.caption, lineHeight: Math.round(fontSizes.caption * 1.3), marginTop: 1 },
  tagPointer: {
    position: 'absolute',
    bottom: -6,
    width: 12,
    height: 12,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    transform: [{ rotate: '45deg' }],
  },
});
