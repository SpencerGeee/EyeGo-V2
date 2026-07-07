import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { usePerformanceTier } from './usePerformanceTier';

/**
 * "Lightfall" premium ambient background — a GPU port of the React Bits
 * Lightfall WebGL effect (falling light streaks in a soft tunnel, tone-mapped
 * glow) rewritten as a Skia RuntimeEffect so it runs natively on iOS and
 * Android.
 *
 * Mobile optimizations vs the web original:
 * - single raymarch per pixel (the web version runs three for screen-space
 *   derivatives; we use a fixed AA width instead)
 * - raymarch capped at 30 steps, streak layers capped at 8
 * - no mouse interaction / film-grain pass
 * - `animated:false` renders one frozen frame (zero per-frame cost) — used
 *   for static screens; low performance tier forces this automatically.
 */

const SKSL = `
uniform float iTime;
uniform float2 iResolution;
uniform float3 uColor0;
uniform float3 uColor1;
uniform float3 uColor2;
uniform float3 uBgColor;
uniform float uSpeed;
uniform float uZoom;
uniform float uGlow;
uniform float uDensity;
uniform float uBgGlow;
uniform float uStreakCount;
uniform float uOpacity;

const float TAU = 6.28318530718;

float3 palette(float h) {
  if (h < 0.3333) { return uColor0; }
  if (h < 0.6667) { return uColor1; }
  return uColor2;
}

float3 tanhv(float3 x) {
  float3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

float2 sceneC(float2 frag, float2 r) {
  float2 P = (frag + frag - r) / r.x;
  float z = 0.0;
  float d = 1e3;
  float4 O = float4(0.0);
  for (int k = 0; k < 30; k++) {
    if (d <= 1e-4) { break; }
    O = z * normalize(float4(P, uZoom, 0.0)) - float4(0.0, 4.0, 1.0, 0.0) / 4.5;
    d = 1.0 - sqrt(length(O * O));
    z += d;
  }
  return float2(O.x, atan(O.z, O.y));
}

half4 main(float2 C) {
  float2 r = iResolution;
  float2 uv0 = (C + C - r) / r.x;
  float T = 0.1 * iTime * uSpeed + 9.0;
  float angRings = max(1.0, floor(TAU * max(uDensity, 0.05) + 0.5));
  float2 Y = float2(5e-3, TAU / angRings);

  float2 Cc = sceneC(C, r);

  float2 P = float2(2.0, 1.0) * uv0 - (r / r.x) * float2(0.0, 1.0);
  float3 col = uBgColor * 90.0 * uBgGlow / (1e3 * dot(P, P) + 6.0);

  float zr = 5e-4;
  float2 rr = float2(0.004);
  float tail = 19.0;

  for (int m = 0; m < 8; m++) {
    if (float(m) >= uStreakCount) { break; }
    float jf = float(m) + 1.0;
    float ic = fract(sin(dot(float2(jf, floor(Cc.x / Y.x + 0.5)), float2(7.0, 11.0)) * 73.0));
    float2 Pp = Cc - (T + T * ic) * float2(0.0, 1.0);
    Pp -= floor(Pp / Y + 0.5) * Y;
    float h = fract(8663.0 * ic);
    float weight = 1.0 + sin(T + 7.0 * h + 4.0);
    float2 inner = float2(length(max(Pp, float2(-1.0, 0.0))), length(Pp) - zr) - zr;
    float2 sm = float2(1.0) - smoothstep(-rr, rr, inner);
    col += dot(sm, float2(exp(tail * Pp.y), 3.0)) * palette(h) * weight;
    Cc.x += Y.x / 8.0;
  }

  float3 mapped = sqrt(tanhv(max(col * uGlow - float3(0.04, 0.08, 0.02), float3(0.0))));
  return half4(half3(mapped), 1.0) * uOpacity;
}
`;

// RuntimeEffect.Make throws on SkSL compile errors; a throw here happens at
// module import and kills the app on startup, so trap it and fall back.
let EFFECT: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
try {
  EFFECT = Skia.RuntimeEffect.Make(SKSL);
} catch (e) {
  console.warn('[LightfallBackground] SkSL compile failed', e);
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '').padEnd(6, '0');
  return [
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
  ];
}

export interface LightfallBackgroundProps {
  /** Up to 3 streak tint colors. */
  colors?: [string, string, string] | [string, string] | [string];
  /** Ambient glow color behind the streaks. */
  backgroundColor?: string;
  /** Falling speed multiplier. */
  speed?: number;
  /** Field-of-view into the tunnel; higher = zoomed in, calmer. */
  zoom?: number;
  /** Brightness multiplier before tone mapping. */
  glow?: number;
  /** Vertical streak frequency. */
  density?: number;
  /** Ambient background glow intensity. */
  backgroundGlow?: number;
  /** Streak layers, 1-8. */
  streakCount?: number;
  /** Overall alpha of the effect. */
  opacity?: number;
  /** false renders a single frozen frame (no per-frame work). */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LightfallBackground({
  colors = ['#1E3A5F', '#123B2E', '#2A1F4D'],
  backgroundColor = '#0A1F18',
  speed = 0.5,
  zoom = 3,
  glow = 1,
  density = 0.6,
  backgroundGlow = 0.5,
  streakCount = 4,
  opacity = 1,
  animated = true,
  style,
}: LightfallBackgroundProps) {
  const tier = usePerformanceTier();
  const isAnimated = animated && tier !== 'low';
  const { width, height } = useWindowDimensions();

  const clock = useClock();

  const staticUniforms = useMemo(() => {
    const [c0, c1, c2] = [
      hexToRgb(colors[0]),
      hexToRgb(colors[1] ?? colors[0]),
      hexToRgb(colors[2] ?? colors[1] ?? colors[0]),
    ];
    return {
      iResolution: [width, height],
      uColor0: c0,
      uColor1: c1,
      uColor2: c2,
      uBgColor: hexToRgb(backgroundColor),
      uSpeed: speed,
      uZoom: zoom,
      uGlow: glow,
      uDensity: density,
      uBgGlow: backgroundGlow,
      uStreakCount: Math.max(1, Math.min(8, Math.round(streakCount))),
      uOpacity: opacity,
    };
  }, [colors, backgroundColor, speed, zoom, glow, density, backgroundGlow, streakCount, opacity, width, height]);

  const uniforms = useDerivedValue(
    () => ({
      ...staticUniforms,
      // Frozen frame at an arbitrary pleasing phase when not animated
      iTime: isAnimated ? clock.value / 1000 : 42.0,
    }),
    [staticUniforms, isAnimated]
  );

  if (!EFFECT) {
    // RuntimeEffect failed to compile (never expected in production) — render
    // a plain tinted layer rather than crashing the whole background.
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor }, style]} />;
  }

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={EFFECT} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}
