import React, { useCallback } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { BrandIntro } from '@eyego/ui';

/**
 * The launch — the rider's intro in the driver's blue (G5). The native splash
 * is hidden on BrandIntro's first layout, not on mount: hiding it before this
 * painted anything showed a frame of nothing between the two.
 */
export function SplashAnimation({ onComplete }: { onComplete: () => void }) {
  const handoff = useCallback(() => {
    SplashScreen.setOptions?.({ fade: true, duration: 200 });
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return <BrandIntro accent="#3B82F6" aura="#0F2238" background="#0e151a" label="DRIVER" onFirstFrame={handoff} onComplete={onComplete} />;
}
