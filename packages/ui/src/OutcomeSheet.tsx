import { useEffect, useMemo } from 'react';
import { BackHandler, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { fonts, fontSizes, radii, spacing, springs, withOpacity, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { useThemedColors } from './ColorsContext';

type IconName = keyof typeof Ionicons.glyphMap;

export interface OutcomeSheetProps {
  visible: boolean;
  icon: IconName;
  /** bad = somebody else's decision went against you; good = news worth having. */
  tone: 'bad' | 'neutral' | 'good';
  title: string;
  body: string;
  /** The money, on its own line — it is the question the reader is asking. */
  money?: { icon: IconName; text: string; good?: boolean } | null;
  /** One quiet line of context (where the ride was going, which trip). */
  detail?: string | null;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void } | null;
  onDismiss: () => void;
  /**
   * Mounted inside `OverlayPortal` — draw as a plain layer, never a `<Modal>`.
   *
   * BUGFIX ("the driver app freezes — the animations keep moving but nothing I
   * tap does anything, only closing the app fixes it"). On iOS the portal is a
   * FullWindowOverlay: a native modal presented from that window never
   * completes and never goes away, and the invisible presentation swallows
   * every touch in the app. The rider hit exactly this with BoardingPinSheet;
   * the driver's away-outcomes sheet reintroduced it. The portal is already
   * the top layer, so a View is all this needs there.
   */
  inline?: boolean;
  /**
   * SEVERAL THINGS HAPPENED — ONE SHEET, NOT A CHAIN OF THEM.
   *
   * BUGFIX ("it seems to be showing the same away outcome … it should've shown
   * once appropriately"). Four facts from one absence used to be four sheets in
   * a row, three of them the same headline. With `rows` the sheet is a digest:
   * the headline is the absence, each row one fact that opens where it leads.
   */
  rows?: OutcomeRow[] | null;
}

export interface OutcomeRow {
  key: string;
  icon: IconName;
  tone: 'bad' | 'neutral' | 'good';
  title: string;
  body: string;
  onPress?: () => void;
}

/**
 * NEWS THE APP OWES SOMEBODY — one sheet for both apps.
 *
 * Extracted from the rider's RideEndedSheet so a driver told "the rider
 * cancelled while you were away" and a rider told "your driver cancelled" meet
 * the same object. The composition is unchanged: a real blur (the app is still
 * there behind the news), a mark that draws ONCE and holds, the headline, the
 * money on its own line, one way forward. Nothing loops — an animation still
 * running while somebody reads bad news is the app fidgeting — and reduced
 * motion collapses every entrance to its end state.
 */
export function OutcomeSheet({
  visible,
  icon,
  tone,
  title,
  body,
  money,
  detail,
  primary,
  secondary,
  onDismiss,
  inline = false,
  rows = null,
}: OutcomeSheetProps) {
  const colors = useThemedColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const rise = useSharedValue(0);
  const ring = useSharedValue(0);
  const glyph = useSharedValue(0);

  // Re-runs per item (title changes), so a queued second notice gets its own entrance.
  useEffect(() => {
    if (!visible) {
      rise.value = 0;
      ring.value = 0;
      glyph.value = 0;
      return;
    }
    if (reducedMotion) {
      rise.value = 1;
      ring.value = 1;
      glyph.value = 1;
      return;
    }
    rise.value = 0;
    ring.value = 0;
    glyph.value = 0;
    rise.value = withSpring(1, springs.emphasized);
    ring.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
    glyph.value = withDelay(220, withSequence(withSpring(1.06, springs.standard), withSpring(1, springs.standard)));
    void Haptics.notificationAsync(
      tone === 'bad' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    return () => {
      cancelAnimation(rise);
      cancelAnimation(ring);
      cancelAnimation(glyph);
    };
  }, [visible, title, reducedMotion, rise, ring, glyph, tone]);

  // A sheet rising from the bottom edge, opaque almost at once. Fading in over
  // a 34 pt lift left the copy half-transparent on top of Home's own text for
  // most of the entrance — the "ghost" in the device recording (2026-10-30).
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, rise.value * 4),
    transform: [{ translateY: (1 - rise.value) * 440 }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: rise.value }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.15 + ring.value * 0.45,
    transform: [{ scale: 0.86 + ring.value * 0.14 }],
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, glyph.value * 1.4),
    transform: [{ scale: 0.9 + glyph.value * 0.1 }],
  }));

  // A Modal gets Android's back for free through onRequestClose; a layer does not.
  useEffect(() => {
    if (!visible || !inline) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, inline, onDismiss]);

  if (!visible) return null;

  const accent = tone === 'bad' ? colors.error : tone === 'good' ? colors.statusSuccess : colors.primary;

  const content = (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" />
      </Animated.View>

      <View style={styles.dock} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }, sheetStyle]}>
          <View style={styles.grabber} />

          <View style={styles.markWrap}>
            <Animated.View style={[styles.markRing, { borderColor: accent }, ringStyle]} pointerEvents="none" />
            <Animated.View style={[styles.markCore, { backgroundColor: withOpacity(accent, 0.14) }, glyphStyle]}>
              <Ionicons name={icon} size={26} color={accent} />
            </Animated.View>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>

          {rows?.length ? (
            <ScrollView style={styles.rows} contentContainerStyle={{ gap: spacing.xs }} bounces={false}>
              {rows.map((r) => {
                const c = r.tone === 'bad' ? colors.error : r.tone === 'good' ? colors.statusSuccess : colors.primary;
                return (
                  <Pressable
                    key={r.key}
                    onPress={r.onPress}
                    disabled={!r.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.title}. ${r.body}`}
                    style={[styles.row, { borderColor: colors.outline }]}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: withOpacity(c, 0.14) }]}>
                      <Ionicons name={r.icon} size={18} color={c} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text>
                      <Text style={styles.rowBody} numberOfLines={2}>{r.body}</Text>
                    </View>
                    {r.onPress ? <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {money ? (
            <View style={[styles.moneyRow, { borderColor: colors.outline }]}>
              <Ionicons name={money.icon} size={16} color={money.good ? colors.statusSuccess : colors.onSurfaceVariant} />
              <Text style={styles.moneyText}>{money.text}</Text>
            </View>
          ) : null}

          {detail ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={14} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant} numberOfLines={1} style={{ flex: 1 }}>
                {detail}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={primary.onPress}
            haptic="medium"
            accessibilityRole="button"
            accessibilityLabel={primary.label}
            style={[styles.primary, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.primaryText, { color: colors.onPrimary }]} numberOfLines={1}>
              {primary.label}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={colors.onPrimary} />
          </Pressable>

          <Pressable
            onPress={secondary?.onPress ?? onDismiss}
            accessibilityRole="button"
            accessibilityLabel={secondary?.label ?? 'Not now'}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, { color: colors.onSurfaceVariant }]}>{secondary?.label ?? 'Not now'}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </>
  );

  return inline ? (
    <View style={StyleSheet.absoluteFill}>{content}</View>
  ) : (
    <Modal transparent visible animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      {content}
    </Modal>
  );
}

const makeStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    dock: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surfaceContainerHigh,
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.onSurface, 0.12),
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      alignItems: 'center',
      gap: spacing.md,
    },
    grabber: {
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: withOpacity(colors.onSurface, 0.18),
      marginBottom: spacing.lg,
    },
    markWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
    markRing: { position: 'absolute', width: 84, height: 84, borderRadius: 42, borderWidth: 1.5 },
    markCore: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 23,
      lineHeight: 29,
      letterSpacing: -0.4,
      color: colors.onSurface,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      lineHeight: 21,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      maxWidth: 320,
    },
    moneyRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      alignSelf: 'stretch',
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: withOpacity(colors.onSurface, 0.04),
    },
    moneyText: { flex: 1, fontFamily: fonts.medium, fontSize: fontSizes.bodySmall, lineHeight: 18, color: colors.onSurface },
    detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch' },
    primary: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 54,
      borderRadius: radii.full,
      marginTop: spacing.sm,
    },
    primaryText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge },
    secondary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xl },
    secondaryText: { fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium },
    rows: { alignSelf: 'stretch', maxHeight: 300 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: withOpacity(colors.onSurface, 0.04),
    },
    rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    rowBody: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, lineHeight: 17, color: colors.onSurfaceVariant, marginTop: 2 },
  });
