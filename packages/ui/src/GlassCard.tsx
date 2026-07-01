import React from 'react';
import { StyleSheet, View, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { radii } from '@eyego/config';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** BlurView intensity — iOS only (default 20) */
  intensity?: number;
  /** Blur tint — default 'dark' */
  tint?: 'dark' | 'light' | 'default' | 'extraLight' | 'regular' | 'prominent' | 'systemChromeMaterial' | 'systemChromeMaterialDark';
  /** Apply large bottom-sheet top radius (32px) */
  sheet?: boolean;
}

export function GlassCard({ children, style, intensity = 20, tint = 'dark', sheet = false }: GlassCardProps) {
  const containerStyle = [
    styles.container,
    sheet && styles.sheetRadius,
    style,
  ];

  return (
    <View style={containerStyle}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.androidFallback]} />
      )}
      <View style={styles.topHighlight} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    backgroundColor: 'rgba(22,22,24,0.80)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  sheetRadius: {
    borderTopLeftRadius: radii['4xl'],
    borderTopRightRadius: radii['4xl'],
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  androidFallback: {
    backgroundColor: 'rgba(22,22,24,0.92)',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    zIndex: 1,
  },
});
