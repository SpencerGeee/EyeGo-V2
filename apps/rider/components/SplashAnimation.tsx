import React, { useCallback } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { colors } from '@eyego/config';
import { BrandIntro } from '@eyego/ui';

/**
 * The launch — see BrandIntro (shared with the driver app). The first painted
 * pixel is the same near-black as the native splash, so the hand-off cannot
 * flash; whatever sits beneath takes over as it fades.
 */
export function SplashAnimation({ onComplete }: { onComplete: () => void }) {
  const handoff = useCallback(() => {
    SplashScreen.setOptions?.({ fade: true, duration: 200 });
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return <BrandIntro accent={colors.primary} aura="#0E1A13" background="#0A0A0B" onFirstFrame={handoff} onComplete={onComplete} />;
}
