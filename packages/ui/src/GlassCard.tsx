import React from 'react';
import { StyleSheet, View, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { radii, withOpacity } from '@eyego/config';
import { useThemedColors } from './ColorsContext';
import { isLightColor } from './effects/GlassSurface';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** BlurView intensity — iOS only (default 20) */
  intensity?: number;
  /** Blur tint — omit to auto-detect from the active theme (dark theme ->
   *  dark glass, light theme -> light glass), matching GlassSurface's
   *  default behavior. Every current call site relies on this auto-detect;
   *  pass explicitly only to force a tint regardless of theme. */
  tint?: 'dark' | 'light' | 'default' | 'extraLight' | 'regular' | 'prominent' | 'systemChromeMaterial' | 'systemChromeMaterialDark' | 'systemChromeMaterialLight';
  /** Apply large bottom-sheet top radius (32px) */
  sheet?: boolean;
}

export function GlassCard({ children, style, intensity = 20, tint, sheet = false }: GlassCardProps) {
  const colors = useThemedColors();
  // Previously hardcoded to a dark tint/panel regardless of theme — on a
  // light theme this rendered a near-black glass panel on top of a white
  // background instead of a light, translucent one. Auto-detect from the
  // active color scheme like GlassSurface does, unless a caller explicitly
  // forces a tint.
  const dark = tint
    ? tint === 'dark' || tint === 'systemChromeMaterialDark'
    : !isLightColor(colors.background);
  const effectiveTint = tint ?? (dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight');
  const panelColor = dark ? '#161618' : '#FFFFFF';
  const rimColor = dark ? '#FFFFFF' : '#000000';

  const containerStyle = [
    styles.container,
    {
      backgroundColor: withOpacity(panelColor, dark ? 0.8 : 0.72),
      borderColor: withOpacity(rimColor, dark ? 0.1 : 0.08),
    },
    sheet && styles.sheetRadius,
    style,
  ];

  return (
    <View style={containerStyle}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={intensity} tint={effectiveTint} style={StyleSheet.absoluteFill} />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: withOpacity(panelColor, dark ? 0.92 : 0.85) }]}
        />
      )}
      <View style={[styles.topHighlight, { backgroundColor: withOpacity(rimColor, dark ? 0.18 : 0.1) }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderWidth: 1,
  },
  sheetRadius: {
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    zIndex: 1,
  },
});
