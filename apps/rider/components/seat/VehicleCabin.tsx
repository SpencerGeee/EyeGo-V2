import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';
import { Text } from '@eyego/ui';
import { fonts, fontSizes, radii, spacing, springs, withOpacity } from '@eyego/config';

/**
 * ── THE VEHICLE IS THE PAGE ─────────────────────────────────────────────────
 *
 * A top-down architectural view of the actual vehicle: body drawn as a lit
 * outline, seats as numbered tiles inside it, the driver's position marked so
 * the rider can orient themselves without being told which end is the front.
 *
 * NOSE-UP, NOT SIDE-ON. The reference for this design is a landscape frame, and
 * the app is portrait. Turning the vehicle 90° rather than letting the rider pan
 * a wider-than-screen canvas is what makes the whole cabin visible at once: no
 * hidden back rows behind a gesture nobody is told about, and seat numbers stay
 * upright instead of lying on their side.
 *
 * ── THE CAMERA MOVE ─────────────────────────────────────────────────────────
 *
 * On open the "camera" swings from a low three-quarter view — where the body's
 * lit edge catches and the vehicle reads as an object — up and over to flat
 * top-down, where the seats are readable and choosable. It is a perspective
 * transform on the whole canvas, not a 3D scene: it runs entirely on the UI
 * thread, adds no dependency, and cannot fail on a cheap handset the way a GL
 * context can.
 *
 * It plays ONCE, on arrival, and never on a re-render — a flourish that repeats
 * every time state changes is a flourish that stops being one. Reduced motion
 * skips it and starts flat.
 */

export type CabinSeat = {
  id: string;
  number: number;
  /**
   * The shared `Seat` union, not a narrowed copy of it. Only one distinction
   * matters to this component — AVAILABLE or not — and every other value means
   * "somebody else's", so narrowing here would buy nothing and would make the
   * screen's own seat list unassignable to it.
   */
  status: 'AVAILABLE' | 'PENDING' | 'OCCUPIED' | 'SELECTED' | 'RESERVED';
};

/**
 * How the cabin is laid out, chosen by capacity.
 *
 * `Vehicle.seaterCount` is the only shape information there is — there is no
 * body-type column — so the templates key off it. Drawing a 15-seat minibus for
 * someone who booked a saloon is the kind of wrong that makes a rider distrust
 * the whole screen, and it is avoidable with three templates.
 *
 * A row is a list of slots. `null` is the aisle: it holds real horizontal space
 * so the two banks read as two banks, which is what makes a minibus look like a
 * minibus rather than a grid.
 */
type Row = (number | null)[];

function layoutFor(count: number): { rows: Row[]; label: string } {
  if (count <= 5) {
    // Saloon: front passenger beside the driver, then the back bench.
    return {
      label: 'Saloon',
      rows: [[1], [2, null, 3], [4, null, 5]].map((r) => r.filter((s) => s === null || s <= count)),
    };
  }
  if (count <= 9) {
    // Van: front passenger, then two rows of two, then a three-across bench.
    return {
      label: 'Van',
      rows: [[1], [2, null, 3], [4, null, 5], [6, 7, 8], [9]],
    };
  }
  // Minibus / sprinter: four banks of two either side of the aisle, then a
  // three-across rear bench — the Sprinter arrangement anyone in Accra knows.
  return {
    label: 'Minibus',
    rows: [[1], [2, null, 3], [4, null, 5], [6, null, 7], [8, null, 9], [10, null, 11], [12, 13, 14], [15]],
  };
}

const TILE = 44;
const GAP = 8;
const AISLE = 26;

export function VehicleCabin({
  seats,
  seatCount,
  selectedId,
  onSelect,
  colors,
  accent,
  fareLabel,
}: {
  seats: CabinSeat[];
  seatCount: number;
  selectedId: string | null;
  onSelect: (seat: CabinSeat) => void;
  colors: Record<string, string>;
  accent: string;
  /** Shown in the tooltip above the chosen seat. Null hides the tooltip. */
  fareLabel: string | null;
}) {
  const reduced = useReducedMotion();
  const { width: screenW } = useWindowDimensions();

  const { rows } = useMemo(() => layoutFor(seatCount || seats.length || 4), [seatCount, seats.length]);
  const byNumber = useMemo(() => new Map(seats.map((s) => [s.number, s])), [seats]);

  /** 0 = the low three-quarter opening pose, 1 = flat top-down. */
  const settled = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    // A beat before it starts, so the screen is painted and the rider is looking
    // at the vehicle when it begins to move rather than mid-navigation.
    settled.value = withDelay(90, withSpring(1, springs.morph));
    // Mount only: a camera move that replays on every seat tap is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cameraStyle = useAnimatedStyle(() => {
    const t = settled.value;
    return {
      transform: [
        // Perspective must come first, and must be on the same transform list as
        // the rotations it applies to — RN silently ignores it otherwise.
        { perspective: 900 },
        { rotateX: `${62 * (1 - t)}deg` },
        { rotateZ: `${-18 * (1 - t)}deg` },
        { scale: 0.82 + 0.18 * t },
        // The low pose sits the vehicle lower in frame, so it rises as it flattens.
        { translateY: 40 * (1 - t) },
      ],
    };
  });

  // The body is drawn to fit the widest row, with room either side for the shell.
  const widest = rows.reduce(
    (max, r) => Math.max(max, r.reduce<number>((w, s) => w + (s === null ? AISLE : TILE) + GAP, -GAP)),
    0,
  );
  const bodyW = Math.min(screenW - spacing['2xl'] * 2, widest + 56);

  return (
    <Animated.View style={[styles.stage, cameraStyle]}>
      <View style={{ width: bodyW }}>
        {/* ── THE SHELL ──────────────────────────────────────────────────
            Drawn behind the seats rather than as a border around them, so the
            lit edge reads as the body of a vehicle catching light and the seats
            read as sitting inside it. */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect
            x={2}
            y={2}
            width="100%"
            height="100%"
            rx={44}
            ry={44}
            fill={withOpacity(colors.surfaceContainerHigh, 0.35)}
            stroke={withOpacity('#FFFFFF', 0.42)}
            strokeWidth={1.5}
          />
          {/* Windscreen — the cue that says which end is the front, without a label. */}
          <Path
            d={`M 26 34 Q ${bodyW / 2} 6 ${bodyW - 26} 34`}
            stroke={withOpacity('#FFFFFF', 0.5)}
            strokeWidth={2}
            fill="none"
          />
        </Svg>

        {/* ── THE CAB ─────────────────────────────────────────────────────
            The driver's wheel, so a rider can tell front from back and count
            rows from the right end. Never selectable. */}
        <View style={styles.cab}>
          <Svg width={30} height={30}>
            <Circle cx={15} cy={15} r={12} stroke={withOpacity('#FFFFFF', 0.45)} strokeWidth={2} fill="none" />
            <Line x1={3} y1={15} x2={27} y2={15} stroke={withOpacity('#FFFFFF', 0.45)} strokeWidth={2} />
          </Svg>
          <Text variant="caption" color={colors.onSurfaceVariant} style={styles.cabLabel}>
            Driver
          </Text>
        </View>

        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((slot, si) => {
              if (slot === null) return <View key={`aisle-${si}`} style={styles.aisle} />;
              const seat = byNumber.get(slot);
              if (!seat) return <View key={`empty-${si}`} style={styles.tileSpacer} />;
              return (
                <SeatTile
                  key={seat.id}
                  seat={seat}
                  selected={seat.id === selectedId}
                  onSelect={onSelect}
                  colors={colors}
                  accent={accent}
                  fareLabel={fareLabel}
                />
              );
            })}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function SeatTile({
  seat,
  selected,
  onSelect,
  colors,
  accent,
  fareLabel,
}: {
  seat: CabinSeat;
  selected: boolean;
  onSelect: (s: CabinSeat) => void;
  colors: Record<string, string>;
  accent: string;
  fareLabel: string | null;
}) {
  const taken = seat.status !== 'AVAILABLE';

  return (
    <View>
      {/* The price rides above the seat it belongs to, so the number and what it
          costs are one object rather than a tile here and a total down there. */}
      {selected && fareLabel ? (
        <View style={[styles.tooltip, { backgroundColor: colors.surfaceContainerHigh }]}>
          <Text style={[styles.tooltipFare, { color: colors.onSurface }]}>{fareLabel}</Text>
        </View>
      ) : null}

      <Pressable
        disabled={taken}
        onPress={() => onSelect(seat)}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: taken }}
        accessibilityLabel={
          taken ? `Seat ${seat.number}, taken` : `Seat ${seat.number}, available`
        }
        style={[
          styles.tile,
          {
            borderColor: selected ? accent : withOpacity('#FFFFFF', taken ? 0.08 : 0.28),
            backgroundColor: selected
              ? accent
              : taken
                ? withOpacity('#000000', 0.25)
                : 'transparent',
          },
          selected && {
            shadowColor: accent,
            shadowOpacity: 0.9,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
            elevation: 10,
          },
        ]}
      >
        {taken ? (
          // A slash, not a number: an occupied seat is not a thing to read, it is
          // a thing to skip, and a greyed number still invites a tap.
          <Svg width={18} height={18}>
            <Line
              x1={2}
              y1={16}
              x2={16}
              y2={2}
              stroke={withOpacity('#FFFFFF', 0.22)}
              strokeWidth={2}
            />
          </Svg>
        ) : (
          <Text
            style={[
              styles.tileNumber,
              { color: selected ? colors.onPrimary ?? '#0A0D14' : colors.onSurfaceVariant },
            ]}
          >
            {String(seat.number).padStart(2, '0')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', paddingVertical: spacing.xl },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: GAP,
    marginBottom: GAP,
  },
  aisle: { width: AISLE, height: TILE },
  tileSpacer: { width: TILE, height: TILE },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileNumber: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
  cab: {
    alignItems: 'center',
    gap: 2,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.md,
  },
  cabLabel: { fontSize: 10, letterSpacing: 0.6 },
  tooltip: {
    position: 'absolute',
    bottom: TILE + 8,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.md,
    minWidth: 78,
    alignItems: 'center',
    zIndex: 2,
  },
  tooltipFare: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
});
