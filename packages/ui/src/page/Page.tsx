import React, { Children, cloneElement, isValidElement, useMemo, useState } from 'react';
import {
  Pressable as RNPressable,
  RefreshControlProps,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { fonts, type ColorTokens } from '@eyego/config';
import { Text } from '../Text';
import { Skeleton } from '../Skeleton';
import { useThemedColors } from '../ColorsContext';
import { goBack } from '../motion/smooth/navigation';

/**
 * THE PAGE KIT — every secondary page in both apps is built from these.
 *
 * Uber and Bolt feel uniform because a settings page, a wallet page and a
 * documents page are the same four parts: a back arrow, a large left-aligned
 * title that shrinks into the bar as you scroll, flat rows with hairlines, and
 * small caps section labels. We had 38 hand-rolled headers, each a few pixels
 * different. These parts take their colours from ColorsProvider, so the rider
 * renders green and the driver blue with no per-app code.
 *
 * Loading / error / empty is `QueryBoundary` (with `SkeletonRows` as the
 * skeleton) — not re-implemented here.
 */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const H_PAD = 20;
const BAR_HEIGHT = 52;
/** Scroll distance over which the large title hands over to the bar title. */
const COLLAPSE_FROM = 20;
const COLLAPSE_TO = 44;
const ICON_SIZE = 22;
const ICON_GAP = 16;

// ── ScreenHeader ────────────────────────────────────────────────────────────

export interface ScreenHeaderProps {
  title: string;
  /** Drives the collapse; without it the bar title shows from the start. */
  scrollY?: SharedValue<number>;
  onBack?: () => void;
  /** false hides the back arrow (a root page). */
  back?: boolean;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, scrollY, onBack, back = true, right }: ScreenHeaderProps) {
  const colors = useThemedColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const fade = useAnimatedStyle(() => ({
    opacity: scrollY ? interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [0, 1], Extrapolation.CLAMP) : 1,
  }));

  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: insets.top + BAR_HEIGHT }]}>
      <View style={styles.barSide}>
        {back ? (
          <RNPressable
            onPress={onBack ?? (() => goBack())}
            hitSlop={8}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </RNPressable>
        ) : null}
      </View>
      <Animated.Text style={[styles.barTitle, fade]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Animated.Text>
      <View style={[styles.barSide, styles.barRight]}>{right}</View>
      <Animated.View style={[styles.hairline, fade]} />
    </View>
  );
}

// ── LargeTitle ──────────────────────────────────────────────────────────────

export function LargeTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const colors = useThemedColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.largeTitleWrap}>
      <Text style={styles.largeTitle} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.largeSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export interface ScreenProps extends Omit<ScreenHeaderProps, 'scrollY'> {
  subtitle?: string;
  children: React.ReactNode;
  /** Pinned under the content (e.g. a Save button); sits above the home indicator. */
  footer?: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** A form: the focused field is kept above the keyboard. */
  keyboard?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  title,
  subtitle,
  onBack,
  back,
  right,
  children,
  footer,
  refreshControl,
  keyboard = false,
  contentContainerStyle,
}: ScreenProps) {
  const colors = useThemedColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scrollY = useSharedValue(0);

  // The UI-thread handler only works on an Animated scroll view; the keyboard
  // scroll view gets a plain JS handler (it only drives two opacities).
  const workletScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const jsScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.value = e.nativeEvent.contentOffset.y;
  };

  const content = [
    styles.content,
    { paddingBottom: (footer ? 16 : insets.bottom + 32) },
    contentContainerStyle,
  ];
  const body = (
    <>
      <LargeTitle title={title} subtitle={subtitle} />
      {children}
    </>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title={title} scrollY={scrollY} onBack={onBack} back={back} right={right} />
      {keyboard ? (
        <KeyboardAwareScrollView
          onScroll={jsScroll}
          scrollEventThrottle={16}
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          contentContainerStyle={content}
        >
          {body}
        </KeyboardAwareScrollView>
      ) : (
        <Animated.ScrollView
          onScroll={workletScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          contentContainerStyle={content}
        >
          {body}
        </Animated.ScrollView>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View> : null}
    </View>
  );
}

// ── ListSection ─────────────────────────────────────────────────────────────

export interface ListSectionProps {
  title?: string;
  /** Grey explanatory line under the rows. */
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Caps label + rows. Hands each row but the last a hairline divider. */
export function ListSection({ title, footer, children, style }: ListSectionProps) {
  const colors = useThemedColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text variant="labelCaps" style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {rows.map((row, i) => cloneElement(row as React.ReactElement<{ divider?: boolean }>, { divider: i < rows.length - 1 }))}
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

// ── ListRow ─────────────────────────────────────────────────────────────────

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  /** Replaces the icon (an avatar, a logo). */
  leading?: React.ReactNode;
  /** Short trailing text: "GH₵20.00", "On", "Expires 12 Mar". */
  value?: string;
  valueColor?: string;
  /** Trailing control (a Toggle, a badge). Replaces the chevron. */
  right?: React.ReactNode;
  onPress?: () => void;
  /** Defaults to true when the row is pressable and has no `right`. */
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  subtitleLines?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Set by ListSection. */
  divider?: boolean;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  leading,
  value,
  valueColor,
  right,
  onPress,
  chevron,
  destructive = false,
  disabled = false,
  subtitleLines = 2,
  accessibilityLabel,
  accessibilityHint,
  divider = false,
}: ListRowProps) {
  const colors = useThemedColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pressed, setPressed] = useState(false);
  const tone = destructive ? colors.error : colors.onSurface;
  const hasLeading = !!(leading || icon);
  const showChevron = chevron ?? (!!onPress && !right);

  const inner = (
    <>
      {leading ?? (icon ? <Ionicons name={icon} size={ICON_SIZE} color={iconColor ?? tone} /> : null)}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: tone }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color={colors.outline} /> : null}
      {divider ? <View style={[styles.divider, { left: hasLeading ? H_PAD + ICON_SIZE + ICON_GAP : H_PAD }]} /> : null}
    </>
  );

  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ');
  if (!onPress) {
    return (
      <View style={[styles.row, disabled && styles.disabled]} accessible accessibilityLabel={label}>
        {inner}
      </View>
    );
  }
  // Pressed state held here, not via the `({ pressed }) => style` form: a style
  // function has been dropped on this codebase before (the whole row lost its
  // layout), and an array style cannot be.
  return (
    <RNPressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      style={[styles.row, pressed && styles.rowPressed, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
    >
      {inner}
    </RNPressable>
  );
}

// ── SkeletonRows ────────────────────────────────────────────────────────────

/** The loading shape of a ListSection: same height, same rhythm, no layout jump. */
export function SkeletonRows({ count = 5, icon = true }: { count?: number; icon?: boolean }) {
  const colors = useThemedColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section} accessibilityLabel="Loading" accessible>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          {icon ? <Skeleton width={ICON_SIZE} height={ICON_SIZE} borderRadius={ICON_SIZE / 2} /> : null}
          <View style={[styles.rowText, { gap: 6 }]}>
            <Skeleton width={`${55 + ((i * 17) % 30)}%`} height={14} />
            <Skeleton width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ColorTokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      backgroundColor: c.background,
      zIndex: 2,
    },
    barSide: { width: 88, flexDirection: 'row', alignItems: 'center' },
    barRight: { justifyContent: 'flex-end', paddingRight: 8, gap: 4 },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    barTitle: {
      flex: 1,
      textAlign: 'center',
      fontFamily: fonts.semiBold,
      fontSize: 16,
      lineHeight: 20,
      color: c.onSurface,
    },
    hairline: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.outlineVariant,
    },
    content: { paddingTop: 4 },
    largeTitleWrap: { paddingHorizontal: H_PAD, paddingBottom: 8 },
    largeTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.6,
      color: c.onSurface,
    },
    largeSubtitle: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: c.onSurfaceVariant,
      marginTop: 6,
    },
    section: { marginTop: 24 },
    sectionTitle: { paddingHorizontal: H_PAD, marginBottom: 4 },
    sectionFooter: {
      paddingHorizontal: H_PAD,
      marginTop: 8,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: c.onSurfaceVariant,
    },
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: ICON_GAP,
      paddingHorizontal: H_PAD,
      paddingVertical: 12,
    },
    rowPressed: { backgroundColor: c.surfaceContainer },
    disabled: { opacity: 0.45 },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 21 },
    rowSubtitle: {
      fontFamily: fonts.regular,
      fontSize: 13.5,
      lineHeight: 18,
      color: c.onSurfaceVariant,
      marginTop: 2,
    },
    rowValue: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 20,
      color: c.onSurfaceVariant,
      maxWidth: '45%',
    },
    divider: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.outlineVariant,
    },
    footer: {
      paddingHorizontal: H_PAD,
      paddingTop: 12,
      backgroundColor: c.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.outlineVariant,
    },
  });
