import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';
import * as SplashScreen from 'expo-splash-screen';

const PRIMARY = '#3B82F6';
const BG = '#030C18';

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
      >
        <Text style={styles.wordmark}>EyeGo Driver</Text>
      </MotiView>

      <MotiView
        animate={{ opacity: showTagline ? 1 : 0 }}
        transition={{ type: 'timing', duration: 200 }}
      >
        <Text style={styles.tagline}>Drive. Earn. Thrive.</Text>
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
    backgroundColor: `${PRIMARY}18`,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 0,
  },
  logo: { width: 80, height: 80 },
  wordmark: {
    fontFamily: 'Geist_700Bold',
    fontSize: 32,
    color: '#fff',
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
    color: `${PRIMARY}CC`,
    letterSpacing: 0.5,
  },
});
