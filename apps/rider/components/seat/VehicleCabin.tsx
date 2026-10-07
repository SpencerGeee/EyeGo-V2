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
import Svg, { Circle, Defs, Ellipse, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@eyego/ui';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';

/**
 * ── THE VEHICLE, SEEN FROM ABOVE ────────────────────────────────────────────
 *
 * Drawn to the reference frame (screenshots/seat.jpg) and to the real thing a
 * Ghanaian rider boards: a Sprinter-class minibus, nose up for portrait.
 *
 *   CAB        driver on the LEFT (Ghana drives on the right), one or two
 *              passengers beside them, wheel and dash ahead of the driver.
 *   DOOR       sliding, on the RIGHT (kerb) side, just behind the cab: a lit
 *              step well opening onto the aisle.
 *   SALOON     rows of 2 + 1 — the pair on the driver's side, the single on the
 *              door side, the aisle between. The row beside the door may be a
 *              pair only, which is how real vans fit their seat count.
 *   REAR       one bench of three or four on a shared backrest.
 *
 * Seats face FORWARD: the backrest is the edge nearest the rear. (The previous
 * glyph put the headrest at the nose, which is a cabin full of rear-facing
 * seats.) Seats the vehicle has but this trip does not sell are drawn, dimmed,
 * rather than left as holes in the floor.
 *
 * Arrival: the body outline draws itself in on the UI thread and the glow
 * rises as it closes; seats fade in front to back in its wake. Nothing blocks
 * a tap. Reduced motion draws it all flat. `react-native-svg` + Reanimated
 * only — a seat map is looked at for one tap and must not cost a GL context.
 */

export type CabinSeat = {
  id: string;
  number: number;
  status: 'AVAILABLE' | 'PENDING' | 'OCCUPIED' | 'SELECTED' | 'RESERVED';
};

type Kind = 'saloon' | 'van' | 'minibus';

export interface CabinLayout {
  kind: Kind;
  label: string;
  /** Passenger seats beside the driver, left to right. */
  front: number[];
  /** Saloon rows: a pair on the driver's side, an optional single by the door. */
  rows: { pair: number[]; single: number | null }[];
  /** The rear bench, left to right. */
  bench: number[];
}

/**
 * Seats numbered in reading order — front, then each row left to right, then
 * the bench. Counts are made to fit the way real vans do: rows of 2 + 1, a
 * bench of 3 or 4, and when that does not divide, the row beside the door
 * loses its single seat (that is where the door is).
 */
export function layoutFor(count: number): CabinLayout {
  const n = Math.max(1, Math.min(count, 19));
  if (n <= 5) {
    const bench: number[] = [];
    for (let s = 2; s <= n; s += 1) bench.push(s);
    return { kind: 'saloon', label: 'Saloon', front: [1], rows: [], bench };
  }
  const f = n >= 9 ? 2 : 1;
  const r = n - f;
  let benchSize = 4;
  let m = r - benchSize;
  if (m % 3 === 1) {
    benchSize = 3;
    m = r - benchSize;
  }
  const pairOnly = m % 3 === 2;
  const fullRows = Math.floor(m / 3);

  let next = 1;
  const take = () => next++;
  const front = Array.from({ length: f }, take);
  const rows: CabinLayout['rows'] = [];
  if (pairOnly) rows.push({ pair: [take(), take()], single: null });
  for (let i = 0; i < fullRows; i += 1) rows.push({ pair: [take(), take()], single: take() });
  const bench = Array.from({ length: benchSize }, take);
  return { kind: n <= 9 ? 'van' : 'minibus', label: n <= 9 ? 'Van' : 'Minibus', front, rows, bench };
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

const GAP = 9;
const PAD_X = 26;

type Placed = { x: number; y: number; row: number; arms: boolean; bench: boolean };

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

  const layout = useMemo(
    () => layoutFor(Math.max(seatCount || 0, seats.length) || 4),
    [seatCount, seats.length],
  );
  const byNumber = useMemo(() => new Map(seats.map((s) => [s.number, s])), [seats]);
  const saloon = layout.kind === 'saloon';

  // ── Geometry ─────────────────────────────────────────────────────────────
  // Four across is the widest anything gets (the bench), and it also leaves
  // the aisle exactly one seat wide in a 2 + 1 row — which is what a real one is.
  // The body is sized FROM the seats: a body wider than four seats is a van with
  // a dance floor down the middle.
  // A car is three across (four only for a five-seater), long in the bonnet
  // and the boot; a van is four across and short in the nose.
  const across = saloon ? Math.max(3, layout.bench.length) : 4;
  const maxW = Math.min(screenW - spacing.xl * 2, 360);
  const T = Math.min(52, Math.floor((maxW - PAD_X * 2 - GAP * (across - 1)) / across));
  const W = T * across + GAP * (across - 1) + PAD_X * 2;
  const pitch = T + GAP + (saloon ? 22 : 8); // legroom
  const NOSE_H = saloon ? 170 : 104;
  // The step well behind the cab — a real gap in the seating, not painted on.
  const DOOR_GAP = saloon ? 0 : Math.round(T * 0.8);
  const REAR_H = saloon ? 118 : 40;

  const cabY = NOSE_H;
  const firstRowY = cabY + pitch + DOOR_GAP;
  const benchY = firstRowY + layout.rows.length * pitch;
  const H = benchY + T + REAR_H;

  const leftX = PAD_X;
  const rightX = W - PAD_X - T;

  /** Every passenger seat, by number. */
  const positions = useMemo(() => {
    const map = new Map<number, Placed>();
    layout.front.forEach((s, i) =>
      map.set(s, { x: rightX - (layout.front.length - 1 - i) * (T + GAP), y: cabY, row: 0, arms: true, bench: false }),
    );
    layout.rows.forEach((row, ri) => {
      const y = firstRowY + ri * pitch;
      row.pair.forEach((s, i) => map.set(s, { x: leftX + i * (T + GAP), y, row: ri + 1, arms: true, bench: false }));
      if (row.single != null) map.set(row.single, { x: rightX, y, row: ri + 1, arms: true, bench: false });
    });
    const total = layout.bench.length * T + (layout.bench.length - 1) * GAP;
    const start = (W - total) / 2;
    layout.bench.forEach((s, i) =>
      map.set(s, { x: start + i * (T + GAP), y: benchY, row: layout.rows.length + 1, arms: false, bench: true }),
    );
    return map;
  }, [layout, T, W, cabY, firstRowY, benchY, pitch, leftX, rightX]);

  // ── Body art ─────────────────────────────────────────────────────────────
  const stroke = colors.onSurface ?? '#FFFFFF';
  const led = colors.statusSuccess ?? '#22C55E';
  const amber = colors.statusWarning ?? '#F59E0B';
  const tail = '#FF4D4D';
  const bx = 10;
  const bw = W - 20;
  const cx = W / 2;
  const top = 8;
  // The nose is narrower than the body and rounds out to full width in one
  // curve — no shoulder where the bonnet meets the flank.
  const noseHalf = bw * (saloon ? 0.36 : 0.42);
  const pillarY = NOSE_H * (saloon ? 0.62 : 0.5);
  const noseR = saloon ? 30 : 22;
  const flankY = top + (saloon ? 70 : 44);
  const rearR = saloon ? 36 : 14;
  const body = [
    `M ${cx - noseHalf + noseR} ${top}`,
    `H ${cx + noseHalf - noseR}`,
    `C ${cx + noseHalf + noseR * 0.6} ${top} ${bx + bw} ${top + noseR * 0.8} ${bx + bw} ${flankY}`,
    `V ${H - 6 - rearR}`,
    `Q ${bx + bw} ${H - 6} ${bx + bw - rearR} ${H - 6}`,
    `H ${bx + rearR}`,
    `Q ${bx} ${H - 6} ${bx} ${H - 6 - rearR}`,
    `V ${flankY}`,
    `C ${bx} ${top + noseR * 0.8} ${cx - noseHalf - noseR * 0.6} ${top} ${cx - noseHalf + noseR} ${top}`,
    'Z',
  ].join(' ');
  // Over-estimate on purpose: a dash longer than the path still closes it.
  const bodyLen = 2 * (bw + H);

  const wsTop = NOSE_H * (saloon ? 0.42 : 0.24);
  const wsBottom = NOSE_H * (saloon ? 0.66 : 0.56);
  const windscreen = [
    `M ${bx + 18} ${wsBottom}`,
    `C ${bx + 20} ${wsTop + 8} ${cx - noseHalf * 0.7} ${wsTop} ${cx} ${wsTop}`,
    `C ${cx + noseHalf * 0.7} ${wsTop} ${bx + bw - 20} ${wsTop + 8} ${bx + bw - 18} ${wsBottom}`,
    `Q ${cx} ${wsBottom + 9} ${bx + 18} ${wsBottom}`,
    'Z',
  ].join(' ');
  const dashY = wsBottom + 12;

  const frontAxle = saloon ? NOSE_H * 0.36 : NOSE_H * 0.4;
  const rearAxle = saloon ? H - REAR_H - 10 : benchY - pitch * 0.35;

  const drawn = useSharedValue(reduced ? 1 : 0);
  const glow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    drawn.value = withDelay(60, withTiming(1, { duration: 950, easing: Easing.out(Easing.cubic) }));
    glow.value = withDelay(420, withSequence(withTiming(1.35, { duration: 520 }), withTiming(1, { duration: 700 })));
    // Mount only — the shell is drawn once, not on every seat tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outlineProps = useAnimatedProps(() => ({ strokeDashoffset: bodyLen * (1 - drawn.value) }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, glow.value) * 0.9 }));
  const hotGlowStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, glow.value - 1) * 1.6 }));

  const selected = seats.find((s) => s.id === selectedId) ?? null;
  const selectedPos = selected ? positions.get(selected.number) ?? null : null;

  const driverX = leftX;
  const wheelCy = cabY - T * 0.18;
  const benchW = layout.bench.length * T + (layout.bench.length - 1) * GAP;
  const aisleX = leftX + 2 * T + 2 * GAP;
  const aisleW = rightX - GAP - aisleX;
  const doorTop = cabY + T + 6;
  const doorH = firstRowY - 6 - doorTop;

  return (
    <View style={{ width: W, height: H, alignSelf: 'center' }}>
      {/* Ambient glow: a resting halo and a hotter flare as the outline closes. */}
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} pointerEvents="none">
        <Svg width={W} height={H}>
          <Path d={body} stroke={withOpacity(stroke, 0.06)} strokeWidth={18} fill="none" />
          <Path d={body} stroke={withOpacity(stroke, 0.11)} strokeWidth={8} fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, hotGlowStyle]} pointerEvents="none">
        <Svg width={W} height={H}>
          <Path d={body} stroke={withOpacity(stroke, 0.2)} strokeWidth={26} fill="none" />
        </Svg>
      </Animated.View>

      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="cabFloor" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={withOpacity(colors.surfaceContainerHigh ?? '#222', 0.7)} />
            <Stop offset="0.5" stopColor={withOpacity(colors.surfaceContainer ?? '#161616', 0.86)} />
            <Stop offset="1" stopColor={withOpacity(colors.surfaceContainerHigh ?? '#222', 0.72)} />
          </LinearGradient>
          <LinearGradient id="cabGlass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={withOpacity(stroke, 0.2)} />
            <Stop offset="1" stopColor={withOpacity(stroke, 0.03)} />
          </LinearGradient>
          <LinearGradient id="cabBench" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={withOpacity(stroke, 0.12)} />
            <Stop offset="1" stopColor={withOpacity(stroke, 0.04)} />
          </LinearGradient>
          <RadialGradient id="cabWell" cx="50%" cy="50%" r="60%">
            <Stop offset="0" stopColor={withOpacity(led, 0.22)} />
            <Stop offset="1" stopColor={withOpacity(led, 0)} />
          </RadialGradient>
        </Defs>

        {/* Tyres, just proud of the body, front and rear. */}
        {[frontAxle, rearAxle].map((ay) => (
          <React.Fragment key={ay}>
            <Rect x={bx - 4} y={ay - 17} width={8} height={34} rx={3} fill={withOpacity(stroke, 0.22)} />
            <Rect x={bx + bw - 4} y={ay - 17} width={8} height={34} rx={3} fill={withOpacity(stroke, 0.22)} />
          </React.Fragment>
        ))}

        {/* Floor pan */}
        <Path d={body} fill="url(#cabFloor)" />

        {/* ── Nose ── grille, bonnet crease, headlights, indicators. */}
        <Rect x={cx - noseHalf * 0.55} y={top + 3} width={noseHalf * 1.1} height={4} rx={2} fill={withOpacity(stroke, 0.18)} />
        <Line x1={cx - noseHalf * 0.42} y1={top + 14} x2={bx + 24} y2={wsTop + 4} stroke={withOpacity(stroke, 0.1)} strokeWidth={1} />
        <Line x1={cx + noseHalf * 0.42} y1={top + 14} x2={bx + bw - 24} y2={wsTop + 4} stroke={withOpacity(stroke, 0.1)} strokeWidth={1} />
        {[-1, 1].map((side) => {
          const ex = cx + side * (noseHalf - 6);
          return (
            <React.Fragment key={side}>
              <Path
                d={`M ${ex} ${top + 4} Q ${ex + side * 6} ${top + 10} ${ex + side * 7} ${top + noseR * 0.9}`}
                stroke={stroke}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
              />
              <Circle cx={ex - side * 16} cy={top + 6} r={2} fill={amber} opacity={0.85} />
            </React.Fragment>
          );
        })}

        {/* Windscreen, with the one diagonal reflection that makes it glass. */}
        <Path d={windscreen} fill="url(#cabGlass)" stroke={withOpacity(stroke, 0.45)} strokeWidth={1.25} />
        <Line
          x1={cx - noseHalf * 0.55}
          y1={wsBottom - 6}
          x2={cx - noseHalf * 0.25}
          y2={wsTop + 6}
          stroke={withOpacity(stroke, 0.22)}
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Mirrors on their stalks at the A-pillars. */}
        {[-1, 1].map((side) => {
          const px = side < 0 ? bx : bx + bw;
          return (
            <React.Fragment key={`m${side}`}>
              <Line x1={px} y1={pillarY - 4} x2={px + side * 9} y2={pillarY - 8} stroke={withOpacity(stroke, 0.4)} strokeWidth={2} />
              <Rect x={side < 0 ? px - 17 : px + 7} y={pillarY - 16} width={10} height={14} rx={3} fill={withOpacity(stroke, 0.32)} />
            </React.Fragment>
          );
        })}

        {/* Dashboard across the cab. */}
        <Path
          d={`M ${bx + 14} ${dashY} Q ${cx} ${dashY - 8} ${bx + bw - 14} ${dashY}`}
          stroke={withOpacity(stroke, 0.18)}
          strokeWidth={6}
          strokeLinecap="round"
          fill="none"
        />

        {/* Driver: the wheel ahead of their seat. */}
        <Circle cx={driverX + T / 2} cy={wheelCy} r={T * 0.3} stroke={withOpacity(stroke, 0.62)} strokeWidth={2.5} fill="none" />
        <Circle cx={driverX + T / 2} cy={wheelCy} r={T * 0.08} fill={withOpacity(stroke, 0.62)} />
        <Line x1={driverX + T / 2 - T * 0.3} y1={wheelCy} x2={driverX + T / 2 + T * 0.3} y2={wheelCy} stroke={withOpacity(stroke, 0.62)} strokeWidth={2} />
        <Line x1={driverX + T / 2} y1={wheelCy} x2={driverX + T / 2} y2={wheelCy + T * 0.3} stroke={withOpacity(stroke, 0.62)} strokeWidth={2} />

        {saloon ? (
          <>
            {/* Door seams, both sides — a car is boarded from either. */}
            {[cabY + T * 0.3, cabY + pitch + T * 0.3].map((y) => (
              <React.Fragment key={y}>
                <Line x1={bx} y1={y} x2={bx + 7} y2={y} stroke={withOpacity(stroke, 0.35)} strokeWidth={1.5} />
                <Line x1={bx + bw - 7} y1={y} x2={bx + bw} y2={y} stroke={withOpacity(stroke, 0.35)} strokeWidth={1.5} />
              </React.Fragment>
            ))}
            {/* Rear glass and the boot lid. */}
            <Path
              d={`M ${bx + 22} ${benchY + T + 12} Q ${cx} ${benchY + T + 4} ${bx + bw - 22} ${benchY + T + 12} L ${bx + bw - 30} ${benchY + T + 34} Q ${cx} ${benchY + T + 30} ${bx + 30} ${benchY + T + 34} Z`}
              fill="url(#cabGlass)"
              stroke={withOpacity(stroke, 0.35)}
              strokeWidth={1}
            />
            <Line x1={bx + 26} y1={H - 30} x2={bx + bw - 26} y2={H - 30} stroke={withOpacity(stroke, 0.14)} strokeWidth={1} />
          </>
        ) : (
          <>
            {/* ── The sliding door: step well, lit kerb strip, the rail it runs on. */}
            <Rect
              x={bx + bw - 30}
              y={doorTop}
              width={30}
              height={doorH}
              rx={6}
              fill="url(#cabWell)"
            />
            <Rect
              x={bx + bw - 26}
              y={doorTop + 4}
              width={22}
              height={doorH - 8}
              rx={4}
              fill={withOpacity(colors.surfaceContainerLowest ?? '#0B0B0D', 0.55)}
              stroke={withOpacity(stroke, 0.2)}
              strokeWidth={1}
            />
            <Rect x={bx + bw - 3} y={doorTop + 6} width={3} height={doorH - 12} rx={1.5} fill={led} />
            <Line
              x1={bx + bw - 1}
              y1={doorTop + doorH + 4}
              x2={bx + bw - 1}
              y2={rearAxle - 22}
              stroke={withOpacity(stroke, 0.16)}
              strokeWidth={1}
              strokeDasharray={[4, 4]}
            />

            {/* The aisle: a runway from the door to the bench, chevrons pointing
                the way out — the reference frame's arrows, turned for portrait. */}
            {layout.rows.length > 0 ? (
              <>
                <Rect
                  x={aisleX}
                  y={doorTop + doorH * 0.5}
                  width={aisleW}
                  height={benchY - GAP - (doorTop + doorH * 0.5)}
                  rx={8}
                  fill={withOpacity(stroke, 0.035)}
                />
                {layout.rows.map((_, ri) => {
                  const y = firstRowY + ri * pitch + T * 0.5;
                  const mx = aisleX + aisleW / 2;
                  return (
                    <Path
                      key={ri}
                      d={`M ${mx - 5} ${y + 3} L ${mx} ${y - 2} L ${mx + 5} ${y + 3}`}
                      stroke={withOpacity(stroke, 0.22)}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  );
                })}
              </>
            ) : null}

            {/* Split rear doors, bumper, tail lights. */}
            <Line x1={cx} y1={H - REAR_H + 14} x2={cx} y2={H - 8} stroke={withOpacity(stroke, 0.16)} strokeWidth={1} />
            <Rect x={bx + 16} y={H - 12} width={bw - 32} height={3} rx={1.5} fill={withOpacity(stroke, 0.16)} />
          </>
        )}
        {[-1, 1].map((side) => {
          const x = side < 0 ? bx + 3 : bx + bw - 3;
          return (
            <Path
              key={`t${side}`}
              d={`M ${x} ${H - 6 - rearR - 10} Q ${x} ${H - 8} ${x - side * (rearR + 2)} ${H - 7}`}
              stroke={tail}
              strokeWidth={2.5}
              strokeLinecap="round"
              fill="none"
              opacity={0.8}
            />
          );
        })}

        {/* The shared rear bench backrest — one piece of upholstery, as in a real van. */}
        {layout.bench.length > 0 ? (
          <Rect
            x={(W - benchW) / 2 - 4}
            y={benchY + T * 0.66}
            width={benchW + 8}
            height={T * 0.32}
            rx={T * 0.14}
            fill="url(#cabBench)"
            stroke={withOpacity(stroke, 0.32)}
            strokeWidth={1}
          />
        ) : null}

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

      {/* The driver's own seat — part of the vehicle, not for sale. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: driverX, top: cabY, opacity: 0.55 }}>
        <SeatShape T={T} id="driver" state="driver" arms bench={false} stroke={stroke} accent={accent} colors={colors} />
      </View>

      {Array.from(positions.entries()).map(([number, pos]) => {
        const seat = byNumber.get(number);
        if (!seat) {
          // The vehicle has it; this trip does not sell it.
          return (
            <View key={`x${number}`} pointerEvents="none" style={{ position: 'absolute', left: pos.x, top: pos.y, opacity: 0.35 }}>
              <SeatShape T={T} id={`x${number}`} state="taken" arms={pos.arms} bench={pos.bench} stroke={stroke} accent={accent} colors={colors} />
            </View>
          );
        }
        return (
          <SeatGlyph
            key={seat.id}
            seat={seat}
            size={T}
            x={pos.x}
            y={pos.y}
            arms={pos.arms}
            bench={pos.bench}
            delay={reduced ? 0 : 260 + pos.row * 60}
            selected={seat.id === selectedId}
            onSelect={onSelect}
            colors={colors}
            accent={accent}
            stroke={stroke}
          />
        );
      })}

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

// ─── The seat, as upholstery ────────────────────────────────────────────────

type SeatState = 'free' | 'selected' | 'held' | 'taken' | 'driver';

/**
 * A forward-facing seat seen from above: cushion toward the nose, backrest and
 * headrest toward the rear, armrests either side. Bench seats share one
 * backrest drawn by the cabin, so they bring only cushion and headrest.
 */
function SeatShape({
  T,
  id,
  state,
  arms,
  bench,
  stroke,
  accent,
  colors,
}: {
  T: number;
  id: string;
  state: SeatState;
  arms: boolean;
  bench: boolean;
  stroke: string;
  accent: string;
  colors: Record<string, string>;
}) {
  const sel = state === 'selected';
  const muted = state === 'taken' || state === 'driver';
  const held = state === 'held';
  const base = colors.surfaceContainer ?? '#161616';

  const line = sel
    ? withOpacity('#FFFFFF', 0.7)
    : held
      ? colors.statusWarning ?? '#F59E0B'
      : muted
        ? withOpacity(stroke, 0.18)
        : withOpacity(stroke, 0.6);
  const top = sel ? accent : muted ? withOpacity(base, 0.95) : withOpacity(stroke, 0.11);
  const bottom = sel ? withOpacity(accent, 0.78) : muted ? withOpacity(base, 0.9) : withOpacity(stroke, 0.04);
  const back = sel ? withOpacity(accent, 0.62) : muted ? withOpacity(base, 0.95) : withOpacity(stroke, 0.09);
  const gid = `cushion-${id}`;
  const dash = held ? [3, 3] : undefined;

  return (
    <Svg width={T} height={T}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={top} />
          <Stop offset="1" stopColor={bottom} />
        </LinearGradient>
      </Defs>
      {/* Backrest (bench seats share the cabin's). */}
      {!bench ? (
        <Rect x={T * 0.06} y={T * 0.64} width={T * 0.88} height={T * 0.32} rx={T * 0.14} fill={back} stroke={line} strokeWidth={1.1} strokeDasharray={dash} />
      ) : null}
      {arms ? (
        <>
          <Rect x={T * 0.01} y={T * 0.24} width={T * 0.11} height={T * 0.52} rx={T * 0.05} fill={back} stroke={line} strokeWidth={1.1} />
          <Rect x={T * 0.88} y={T * 0.24} width={T * 0.11} height={T * 0.52} rx={T * 0.05} fill={back} stroke={line} strokeWidth={1.1} />
        </>
      ) : null}
      {/* Cushion, lit from the front edge. */}
      <Rect
        x={T * 0.13}
        y={T * 0.05}
        width={T * 0.74}
        height={T * 0.66}
        rx={T * 0.17}
        fill={`url(#${gid})`}
        stroke={line}
        strokeWidth={sel ? 1.5 : 1.15}
        strokeDasharray={dash}
      />
      {/* The seam where cushion meets back. */}
      <Line x1={T * 0.22} y1={T * 0.6} x2={T * 0.78} y2={T * 0.6} stroke={withOpacity(sel ? '#FFFFFF' : stroke, sel ? 0.35 : 0.12)} strokeWidth={1} />
      {/* Headrest, sitting on the backrest. */}
      <Rect
        x={T * 0.3}
        y={T * 0.73}
        width={T * 0.4}
        height={T * 0.17}
        rx={T * 0.07}
        fill={sel ? withOpacity('#FFFFFF', 0.28) : muted ? withOpacity(stroke, 0.06) : withOpacity(stroke, 0.14)}
        stroke={line}
        strokeWidth={1}
      />
      {sel ? (
        // The light from within — a soft hotspot on the cushion.
        <Ellipse cx={T * 0.5} cy={T * 0.28} rx={T * 0.24} ry={T * 0.12} fill={withOpacity('#FFFFFF', 0.18)} />
      ) : null}
    </Svg>
  );
}

function SeatGlyph({
  seat,
  size,
  x,
  y,
  arms,
  bench,
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
  arms: boolean;
  bench: boolean;
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

  const state: SeatState = selected ? 'selected' : available ? 'free' : held ? 'held' : 'taken';

  return (
    <Animated.View
      entering={FadeInUp.delay(delay).duration(260).reduceMotion(ReduceMotion.System)}
      style={{ position: 'absolute', left: x, top: y, width: T, height: T }}
    >
      {/* Halo — the "glowing accent" of the legend. A soft disc rather than a
          shadow, because Android draws no coloured shadows. */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: -T * 0.35, top: -T * 0.35, width: T * 1.7, height: T * 1.7, borderRadius: T, backgroundColor: withOpacity(accent, 0.24) },
          haloStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: -T * 0.1, top: -T * 0.1, width: T * 1.2, height: T * 1.2, borderRadius: T * 0.38, backgroundColor: withOpacity(accent, 0.3) },
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
          available ? `Seat ${seat.number}, available` : held ? `Seat ${seat.number}, on hold` : `Seat ${seat.number}, taken`
        }
        style={{ width: T, height: T }}
      >
        <Animated.View style={[{ width: T, height: T }, bodyStyle]}>
          <SeatShape T={T} id={seat.id} state={state} arms={arms} bench={bench} stroke={stroke} accent={accent} colors={colors} />
          {/* The number sits on the cushion, not on the box. */}
          <View style={[styles.centre, { position: 'absolute', left: 0, right: 0, top: T * 0.05, height: T * 0.58 }]} pointerEvents="none">
            {available || held || selected ? (
              <Text
                style={{
                  fontFamily: fonts.semiBold,
                  fontSize: Math.max(11, T * 0.26),
                  lineHeight: Math.max(13, T * 0.31),
                  color: selected ? '#FFFFFF' : held ? colors.statusWarning : withOpacity(stroke, 0.85),
                  letterSpacing: 0.4,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {String(seat.number).padStart(2, '0')}
              </Text>
            ) : (
              <Ionicons name="person" size={Math.max(12, T * 0.3)} color={withOpacity(stroke, 0.3)} />
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
  tagFare: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: Math.round(fontSizes.titleSmall * 1.25),
    fontVariant: ['tabular-nums'],
  },
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
