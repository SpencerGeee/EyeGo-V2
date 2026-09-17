import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing } from '@eyego/config';
import { Text, Pressable, ChromeBlur, backgroundScrollPauseProps } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverConnection } from '../../stores/connection.store';

/**
 * ── THE SURFACE THE STOP TIMELINE LIVES ON ───────────────────────────────────
 *
 * A header, the timeline scrolling under it, and one action pinned to the
 * bottom. This is the MANAGE page — roster, PIN boarding, offline passengers,
 * seat work — and it no longer carries a map.
 *
 * ── WHY THERE IS NO MAP PANE ANY MORE ───────────────────────────────────────
 * "The map is hiding at the top and the information is there… I need a full
 * immersive view." The pane this used to draw gave the map 42 % of the screen,
 * resized a GL surface with a layout animation on every drag, and put a grab
 * strip between the map and the list that read as a broken sheet. The
 * immersive map now lives where the driving happens — the home surface, with
 * the trip as stages over a full-bleed map (see components/surface). This
 * page is the stopped-vehicle, two-handed work, and it gets the whole screen
 * for the list it exists to show.
 *
 * ── THE ACTION BAR ──────────────────────────────────────────────────────────
 * Pinned, outside the scroller, always exactly one primary action.
 */

export interface StopTimelineSurfaceProps {
  /** Floats at the top-right of the header — the SOS control. */
  mapOverlay?: React.ReactNode;
  /** The scrolling body. `StopTimeline`, plus whatever else the screen needs. */
  children: React.ReactNode;
  /** Pinned at the bottom. One action. */
  action?: React.ReactNode;
  /** Top-left control. Usually a back or close button. */
  onBack?: () => void;
  title?: string;
  subtitle?: string;
}

export function StopTimelineSurface({
  mapOverlay,
  children,
  action,
  onBack,
  title,
  subtitle,
}: StopTimelineSurfaceProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const connected = useDriverConnection((s) => s.connected);

  return (
    <View style={styles.root}>
      <View style={[styles.topChrome, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        {onBack ? (
          <Pressable
            onPress={onBack}
            style={styles.chromeBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChromeBlur style={StyleSheet.absoluteFill} fallbackColor={colors.surfaceContainerHigh} />
            <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
          </Pressable>
        ) : (
          <View style={styles.chromeBtn} />
        )}

        {title ? (
          <View style={styles.titleWrap} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        {!connected ? (
          <View style={styles.offline} pointerEvents="none">
            <ChromeBlur style={StyleSheet.absoluteFill} fallbackColor={colors.surfaceContainerHigh} />
            <Ionicons name="cloud-offline-outline" size={15} color={colors.statusWarning} />
          </View>
        ) : null}
        {mapOverlay ?? (connected ? <View style={styles.chromeBtn} /> : null)}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: (action ? 96 : 0) + insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        {...backgroundScrollPauseProps}
      >
        {children}
      </ScrollView>

      {action ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md }]}>
          {/* Opaque, not glass: the list scrolls under it and a translucent bar
              over moving text is unreadable exactly when it matters. */}
          <View style={styles.actionFill} pointerEvents="none" />
          {action}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.backgroundDeep },
    topChrome: {
      paddingHorizontal: spacing.base,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    chromeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    titleWrap: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: spacing.base,
      paddingVertical: 6,
    },
    title: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.caption,
      color: colors.onSurfaceVariant,
    },
    offline: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    list: { flex: 1 },
    listContent: {
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
    },
    actionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.md,
    },
    actionFill: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.backgroundDeep,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
    },
  });
