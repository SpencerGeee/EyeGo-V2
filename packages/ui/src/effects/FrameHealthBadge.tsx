import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useFrameHealth, gradeFrameHealth } from './useFrameHealth';

/**
 * ── THE SMOOTHNESS READOUT ──────────────────────────────────────────────────
 *
 * A dev-only badge showing what the UI thread is ACTUALLY doing, so "is it
 * smooth?" stops being a matter of opinion on either side of this conversation.
 *
 * Mount it once in a root layout behind `__DEV__`. It measures continuously and
 * updates once a second; tap it to reset and measure a specific interaction
 * (open the tracking screen, drag the sheet, run a dispatch) from clean.
 *
 * READ p95, NOT p50. A screen dropping one frame in twelve still shows a
 * healthy median — the stutter lives entirely in the tail, which is why an
 * average frame rate can say 58fps while the screen visibly hitches.
 *
 * The budget shown is the device's own: 16.7ms on a 60Hz panel, ~8.3ms on a
 * 120Hz one. Grading a ProMotion phone against 60Hz would call a janky screen
 * perfect, which is the mistake that makes flagship devices look fine in
 * testing and bad in hands.
 */
export function FrameHealthBadge({ compact = false }: { compact?: boolean }) {
  const { health, start, reset } = useFrameHealth();

  useEffect(() => {
    start();
    // `start` is stable (useCallback with stable deps); running once is the
    // intent — this badge measures the whole session unless tapped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grade = gradeFrameHealth(health);
  const tint =
    grade === 'janky' ? '#FF453A'
    : grade === 'occasional' ? '#FF9F0A'
    : grade === 'smooth' ? '#32D74B'
    : '#8E8E93';

  return (
    <Pressable
      onPress={() => {
        reset();
        start();
      }}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel={`Frame health: ${grade}. Tap to re-measure.`}
    >
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={styles.text}>
        {health.frames < 30
          ? 'measuring…'
          : compact
            ? `p95 ${health.p95}ms`
            : `p95 ${health.p95}ms · p50 ${health.p50}ms · drop ${(health.droppedRatio * 100).toFixed(1)}% · budget ${health.budgetMs}ms`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    // Below the status bar, above everything else. Deliberately top-left: the
    // bottom of both apps is where the real controls live.
    top: 54,
    left: 8,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { color: '#FFFFFF', fontSize: 10, fontVariant: ['tabular-nums'] },
});

export default FrameHealthBadge;
