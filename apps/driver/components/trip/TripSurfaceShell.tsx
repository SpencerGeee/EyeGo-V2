import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, GlassSurface, InlayPanel, GradientGlowBorder } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverConnection } from '../../stores/connection.store';

/**
 * THE ONE SHELL BOTH DRIVER TRIP SCREENS WEAR.
 *
 * "The rider app tracking page feels exactly like Uber but the driver one is
 * all over the place." Both driver screens — manage (`active/[id]`) and
 * tracking (`tracking/[id]`) — draw a map with a draggable panel over it, and
 * both had built that arrangement independently: different snap points,
 * different sheet padding, different card treatments, no connection indicator
 * on either, and a different vertical rhythm inside the panel. Two screens the
 * driver moves between mid-trip that did not look like the same product, let
 * alone like the rider's.
 *
 * This is that arrangement, once. Screens supply their content; the shell owns
 * the panel geometry, the connection chip, the spacing rhythm and the card
 * ring, so the two cannot drift apart again and the rider's tracking screen is
 * the reference in exactly one place.
 *
 * DELIBERATELY NOT IN THIS FILE: the map, and anything that touches a trip.
 * The map stays with each screen because they frame different legs, and no
 * mutation, transition or socket handler moved in here — this is the visual
 * layer and nothing else.
 *
 * Geometry is matched to the rider's `TrackingStage`:
 *   snap points   0.34 / 0.66 collapsed-to-expanded, so the map keeps the room
 *                 the driver is actually navigating by. The driver screens used
 *                 0.5/0.8 and 0.55/0.85, which is why they felt heavier.
 *   card ring     `driver` palette against the rider's `brandGreen` — same
 *                 construction, each app's own colour.
 */

export interface TripSurfaceShellProps {
  /** Panel snap points. Defaults to the rider's tracking geometry. */
  snapPointsPct?: [number, number];
  /** Rendered above the panel, over the map (SOS, back, header chrome). */
  overlay?: React.ReactNode;
  /** Panel content. */
  children: React.ReactNode;
}

export function TripSurfaceShell({
  snapPointsPct = [0.34, 0.66],
  overlay,
  children,
}: TripSurfaceShellProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const connected = useDriverConnection((s) => s.connected);
  const recovering = useDriverConnection((s) => s.recovering);

  return (
    <>
      {overlay}

      {/*
        The chip the driver app did not have. The rider's tracking screen says
        "Reconnecting…" the moment its feed drops; the driver's panel just kept
        showing the last ETA it received, with nothing to say the numbers had
        stopped moving. A stale ETA that looks live is worse than a stale ETA
        that admits it.
      */}
      {(!connected || recovering) && (
        <View style={styles.chip} pointerEvents="none">
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.lg} intensity="low" />
          <Ionicons name="cloud-offline-outline" size={13} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {recovering ? 'Catching up…' : 'Reconnecting…'}
          </Text>
        </View>
      )}

      {/*
        `publishMetrics` interlocks the panel with `DriverTripMap`'s camera: the
        map pads to the window the panel is actually leaving visible, live,
        instead of to a per-screen guess that was already wrong before the panel
        finished moving. The rider's trip surface does the same thing through
        `MorphSheet`, so both halves of a trip now frame it identically while
        their sheets move — which was the point of this shell existing.
      */}
      <InlayPanel
        snapPointsPct={snapPointsPct}
        initialState="collapsed"
        sheetStyle={styles.sheet}
        grabberColor={colors.outline}
        publishMetrics
      >
        <View style={styles.sheetBody}>{children}</View>
      </InlayPanel>
    </>
  );
}

/**
 * A ringed card, matching the rider's driver/fare rows.
 *
 * Exported so the two driver screens light their content the same way instead
 * of each picking their own intensity — which is how one screen ended up
 * glowing and the other flat.
 */
export function GlowCard({
  children,
  style,
  glow = true,
}: {
  children: React.ReactNode;
  style?: any;
  glow?: boolean;
}) {
  const colors = useColors();
  return (
    <GradientGlowBorder
      palette="driver"
      fillColor={colors.surfaceContainerHigh}
      borderRadius={radii.xl}
      thickness="thin"
      glow={glow}
      glowIntensity={0.7}
      // Capped so a card sitting at the top of the sheet cannot have its halo
      // sliced by the sheet's own rounded edge — the manage screen's
      // "cut off" bug, made structurally impossible here.
      maxGlowRadius={16}
      style={style}
    >
      {children}
    </GradientGlowBorder>
  );
}

/** The panel's headline: title, subtitle, and an optional trailing badge. */
export function PanelHeadline({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string | null;
  trailing?: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.headline}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? (
          <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    /** Same placement as the rider's: top-centre, over the map, inert. */
    chip: {
      position: 'absolute',
      top: 8,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.lg,
      overflow: 'hidden',
      zIndex: 20,
    },
    sheet: { backgroundColor: colors.background },
    sheetBody: {
      paddingHorizontal: spacing['2xl'],
      /** The gap the manage screen was missing entirely, which is what let its
       *  first card's ring be cut off by the sheet edge. Structural here. */
      paddingTop: spacing.lg,
      paddingBottom: 40,
      gap: spacing.lg,
    },
    headline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      lineHeight: Math.round(fontSizes.titleMedium * 1.25),
      color: colors.onSurface,
      letterSpacing: -0.4,
    },
  });
