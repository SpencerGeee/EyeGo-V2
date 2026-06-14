import React from 'react';
import { StyleSheet, View, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** BlurView intensity — iOS only, ignored on Android (default 40) */
  intensity?: number;
  /** Blur tint — default 'dark' */
  tint?: 'dark' | 'light' | 'default' | 'extraLight' | 'regular' | 'prominent' | 'systemChromeMaterial' | 'systemChromeMaterialDark';
}

export function GlassCard({ children, style, intensity = 40, tint = 'dark' }: GlassCardProps) {
  return (
    <View style={[styles.container, style]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.androidFallback]} />
      )}
      {/* Subtle top-edge highlight — mimics glass refraction */}
      <View style={styles.topHighlight} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  androidFallback: {
    backgroundColor: 'rgba(15, 17, 24, 0.88)',
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
