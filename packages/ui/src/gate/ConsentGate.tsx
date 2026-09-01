import { useEffect, useState } from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { radii, spacing, springs } from '@eyego/config';

import { Text } from '../Text';
import { Button } from '../Button';

/**
 * CONSENT, WITH A RECORD BEHIND IT.
 *
 * Both stores require a reachable privacy policy link. A dispute, a chargeback
 * or the Data Protection Commission requires something rather different: proof
 * of WHICH version this person agreed to and WHEN. A checkbox at signup that
 * leaves no row behind satisfies the first and is worthless for the second.
 *
 * So this is shown whenever the versions stamped on the user differ from the
 * ones the operator currently publishes — including when they are null, which
 * is every account created before consent was recorded at all. Accepting posts
 * to the server, which stamps its own idea of "current"; this screen never
 * tells the server what it displayed, because a client that could would also
 * be a client that could lie about it.
 *
 * It is deliberately NOT dismissible and has no "skip". It is also deliberately
 * not shown to app-review accounts — a reviewer hitting a consent wall before
 * they can test the app is a rejection, and they are not a data subject whose
 * consent means anything.
 *
 * ── ON THE PRESENTATION ─────────────────────────────────────────────────────
 * This is, for a meaningful number of people, the FIRST screen of the product
 * they are made to read. It used to be a centred title, a centred paragraph,
 * two centred links and a button — five centred elements and no hierarchy, on
 * a flat ground, appearing and vanishing on a hard cut. It read as an error
 * dialog for something the rider had done wrong.
 *
 * What it is instead: bottom-weighted so the CTA sits under the thumb and the
 * reading order runs top-down into it; left-aligned, because centred body text
 * is harder to read and centring everything is what makes a screen look
 * unconsidered; the two documents given as real rows with their own affordance
 * rather than two words floating side by side; and it enters and LEAVES on
 * springs, so agreeing hands over to the app instead of cutting to it.
 */
export interface ConsentGateProps {
  /** True when the signed-in user's accepted versions are behind the current ones. */
  required: boolean;
  termsUrl?: string | null;
  privacyUrl?: string | null;
  submitting?: boolean;
  onAccept: () => void;
  backgroundColor?: string;
  /** The link colour — passed in so this stays theme-agnostic. */
  accentColor?: string;
  /** Body/heading colour. Defaults to a near-white that suits the dark ground. */
  onSurfaceColor?: string;
  /**
   * Shown inline under the CTA when accepting failed.
   *
   * A gate with no way out MUST be able to say why it will not open. Without
   * this the only feedback for a failed accept is the button un-spinning, which
   * is indistinguishable from a button that does nothing.
   */
  errorText?: string | null;
}

/** Entry order, in ms. Small and deliberate — this is a stagger, not a show. */
const STEP_MS = 55;

export function ConsentGate({
  required,
  termsUrl,
  privacyUrl,
  submitting = false,
  onAccept,
  backgroundColor = '#0B0B0F',
  accentColor = '#4be277',
  onSurfaceColor = '#F4F4F6',
  errorText = null,
}: ConsentGateProps) {
  const reducedMotion = useReducedMotion();

  /**
   * Kept mounted for the length of the exit.
   *
   * `required` flips false the instant the server confirms, and unmounting on
   * that flip is the "super basic" hand-off: the wall is simply gone and the
   * app is simply there, one frame apart. Holding the node until the exit
   * settles is the only way a leaving animation can exist at all.
   */
  const [present, setPresent] = useState(required);
  useEffect(() => {
    if (required) setPresent(true);
  }, [required]);

  /**
   * One shared value per staggered element.
   *
   * The stagger lives in the ASSIGNMENT (`withDelay(...)` below), never in
   * `useAnimatedStyle`: a worklet that reads a shared value must not also
   * build an animation, or it re-creates one on every frame it evaluates.
   */
  const step = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const leaving = useSharedValue(0);

  useEffect(() => {
    if (required) {
      leaving.value = 0;
      step.forEach((v, i) => {
        v.value = reducedMotion
          ? 1
          : withDelay(i * STEP_MS, withSpring(1, springs.standard));
      });
      return;
    }
    if (!present) return;
    // Out on a timing curve, not a spring: an exit that overshoots draws the
    // eye back to something the rider has finished with.
    leaving.value = withTiming(1, { duration: reducedMotion ? 0 : 240 }, (done) => {
      if (done) runOnJS(setPresent)(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, present, reducedMotion]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: 1 - leaving.value }));

  /** Entry travel is 14 pt — the same distance the apps’ `Entrance` uses. */
  const titleStyle = useAnimatedStyle(() => ({
    opacity: step[0].value * (1 - leaving.value),
    transform: [
      { translateY: (1 - step[0].value) * 14 + leaving.value * -12 },
      { scale: 1 - leaving.value * 0.02 },
    ],
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: step[1].value * (1 - leaving.value),
    transform: [
      { translateY: (1 - step[1].value) * 14 + leaving.value * -12 },
      { scale: 1 - leaving.value * 0.02 },
    ],
  }));
  const linksStyle = useAnimatedStyle(() => ({
    opacity: step[2].value * (1 - leaving.value),
    transform: [
      { translateY: (1 - step[2].value) * 14 + leaving.value * -12 },
      { scale: 1 - leaving.value * 0.02 },
    ],
  }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: step[3].value * (1 - leaving.value),
    transform: [
      { translateY: (1 - step[3].value) * 14 + leaving.value * -12 },
      { scale: 1 - leaving.value * 0.02 },
    ],
  }));

  if (!present) return null;

  const open = (url?: string | null) => {
    if (!url) return;
    // A policy link that will not open leaves the screen up, which is right —
    // there is nothing else to do here and nowhere else to go.
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Animated.View
      style={[styles.root, { backgroundColor }, rootStyle]}
      accessibilityViewIsModal
    >
      {/*
        Ambient ground rather than a flat fill. Two stops of the accent at
        single-digit opacity, weighted to the top where there is no content —
        enough to stop the surface reading as a system alert, nowhere near
        enough to compete with the text.
      */}
      <LinearGradient
        colors={[withAlpha(accentColor, 0.1), withAlpha(accentColor, 0.02), 'transparent']}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.card}>
        <Animated.View style={titleStyle}>
          <Text variant="display" style={[styles.title, { color: onSurfaceColor }]}>
            Our terms have changed
          </Text>
        </Animated.View>

        <Animated.View style={bodyStyle}>
          <Text style={[styles.body, { color: onSurfaceColor }]}>
            Please read the two documents below. Agreeing records the version you
            agreed to, and the date.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.links, linksStyle]}>
          <DocRow
            label="Terms of service"
            onPress={() => open(termsUrl)}
            enabled={!!termsUrl}
            accentColor={accentColor}
            onSurfaceColor={onSurfaceColor}
          />
          <View style={[styles.rule, { backgroundColor: withAlpha(onSurfaceColor, 0.1) }]} />
          <DocRow
            label="Privacy policy"
            onPress={() => open(privacyUrl)}
            enabled={!!privacyUrl}
            accentColor={accentColor}
            onSurfaceColor={onSurfaceColor}
          />
        </Animated.View>

        <Animated.View style={actionStyle}>
          <Button
            label="I agree"
            fullWidth
            loading={submitting}
            disabled={submitting}
            onPress={onAccept}
            style={styles.action}
          />
          {!!errorText && (
            <Text style={[styles.error, { color: onSurfaceColor }]}>{errorText}</Text>
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/**
 * One document, as a row.
 *
 * Two centred underlined words gave no indication they were anything other
 * than decoration, and gave a 14 pt tap target on a screen that cannot be
 * dismissed without reading them. A full-width row with a trailing chevron is
 * the affordance every settings list in both apps already uses.
 */
function DocRow({
  label,
  onPress,
  enabled,
  accentColor,
  onSurfaceColor,
}: {
  label: string;
  onPress: () => void;
  enabled: boolean;
  accentColor: string;
  onSurfaceColor: string;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.98, springs.press);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, springs.press);
        }}
        onPress={onPress}
        disabled={!enabled}
        accessibilityRole="link"
        accessibilityLabel={`Read the ${label.toLowerCase()}`}
        style={[styles.row, { opacity: enabled ? 1 : 0.4 }]}
      >
        <Text style={[styles.rowLabel, { color: onSurfaceColor }]}>{label}</Text>
        <Text style={[styles.rowChevron, { color: accentColor }]}>›</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Hex/rgb colour at a given alpha, without pulling in a colour library. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const full =
      color.length === 4
        ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
        : color;
    const r = parseInt(full.slice(1, 3), 16);
    const g = parseInt(full.slice(3, 5), 16);
    const b = parseInt(full.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // Bottom-weighted: the reading order runs down into the CTA, which lands
    // under the thumb instead of in the middle of the screen.
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['4xl'],
    // Below the release gate (9999): an unsupported build must not be asked to
    // consent to anything, it must be told to update.
    zIndex: 9000,
    elevation: 9000,
  },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  title: {
    // Negative tracking at display size; the token sets the family and weight.
    letterSpacing: -0.8,
    marginBottom: spacing.md,
  },
  body: {
    opacity: 0.72,
    lineHeight: 22,
    // Roughly 60 characters at this size — past that the eye loses the line.
    maxWidth: 380,
    marginBottom: spacing['2xl'],
  },
  links: { marginBottom: spacing['2xl'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.base,
    borderRadius: radii.md,
  },
  rowLabel: { fontSize: 16 },
  rowChevron: { fontSize: 22, lineHeight: 22 },
  rule: { height: StyleSheet.hairlineWidth, width: '100%' },
  action: { alignSelf: 'stretch' },
  error: {
    marginTop: spacing.md,
    opacity: 0.85,
    fontSize: 13,
    textAlign: 'center',
  },
});
