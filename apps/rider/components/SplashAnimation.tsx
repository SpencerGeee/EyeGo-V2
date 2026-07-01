import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';
import * as SplashScreen from 'expo-splash-screen';
import { fonts, colors, withOpacity } from '@eyego/config';
import { Text } from '@eyego/ui';

const PRIMARY = colors.primary;
const BG = colors.backgroundDeep;

interface Props { onComplete: () => void; }

export function SplashAnimation({ onComplete }: Props) {
  const [showText, setShowText] = useState(false);
  const [showTagline, setShowTagline] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    const t1 = setTimeout(() => setShowText(true), 500);
    const t2 = setTimeout(() => setShowTagline(true), 800);
    const t3 = setTimeout(() => setFadeOut(true), 1400);
    const t4 = setTimeout(() => onComplete(), 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onComplete]);

  return (
    <MotiView
      style={styles.container}
      animate={{ opacity: fadeOut ? 0 : 1 }}
      transition={{ type: 'timing', duration: 300 }}
      pointerEvents="none"
    >
      <MotiView
        from={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 14 }}
        style={styles.logoWrapper}
      >
        <View style={styles.glowRing} />
        <Image
          source={require('../assets/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </MotiView>

      <MotiView
        animate={{ opacity: showText ? 1 : 0, translateY: showText ? 0 : 20 }}
        transition={{ type: 'timing', duration: 300 }}
        style={styles.wordmarkRow}
      >
        <Text style={styles.wordmark}>EyeGo</Text>
      </MotiView>

      <MotiView
        animate={{ opacity: showTagline ? 1 : 0 }}
        transition={{ type: 'timing', duration: 200 }}
      >
        <Text style={styles.tagline}>Move Smarter.</Text>
      </MotiView>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    gap: 16,
  },
  logoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
  },
  glowRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: withOpacity(PRIMARY, 0.1),
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 0,
  },
  logo: { width: 80, height: 80 },
  wordmarkRow: { alignItems: 'center' },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 36,
    lineHeight: 44,
    color: colors.onSurface,
    letterSpacing: -1,
  },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: withOpacity(PRIMARY, 0.8),
    letterSpacing: 0.5,
  },
});
