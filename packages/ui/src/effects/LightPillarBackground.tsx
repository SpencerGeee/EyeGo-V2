import React, { useMemo, useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { usePerformanceTier } from './usePerformanceTier';

/**
 * "LightPillar" premium ambient background — a GPU port of the React Bits
 * LightPillar Three.js/WebGL effect (vertical rotating light beam with
 * wave distortion, tone-mapped glow, film grain noise) rewritten as a Skia
 * RuntimeEffect so it runs natively on iOS and Android.
 *
 * Mobile optimizations vs the web original:
 * - Capped raymarch iterations (30 low / 40 mid-high vs 80 in the original)
 * - Wave iterations unrolled (1 low / 2 mid-high vs 4 in the original)
 * - No mouse interaction
 * - `animated:false` renders one frozen frame — low performance tier forces
 *   this automatically.
 *
 * Colors: brand-green gradient — top = colors.primary (#4be277), bottom = a
 * deep emerald (#005321) so it reads on-brand, not purple/pink.
 */

const SKSL = `
uniform float iTime;
uniform float2 iResolution;
uniform float3 uTopColor;
uniform float3 uBottomColor;
uniform float uIntensity;
uniform float uGlowAmount;
uniform float uPillarWidth;
uniform float uPillarHeight;
uniform float uNoiseIntensity;
uniform float uRotationSpeed;
uniform float uOpacity;

const float STEP_MULT = 1.2;
const int MAX_ITER = 40;
const int WAVE_ITER = 2;

float3 tanhv(float3 x) {
  float3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

float hash(float2 p) {
  return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

half4 main(float2 C) {
  float2 r = iResolution;
  float2 uv = (C * 2.0 - r) / r.x;

  // Initial pillar rotation (static, configurable)
  // Skipped — we keep the beam centered and rotating via rotC/rotS below

  float3 ro = float3(0.0, 0.0, -10.0);
  float3 rd = normalize(float3(uv, 1.0));

  // Rotation driven by clock — continuous beam rotation
  float rotC = cos(iTime * 0.3 * uRotationSpeed);
  float rotS = sin(iTime * 0.3 * uRotationSpeed);

  float3 col = float3(0.0);
  float t = 0.1;

  for (int i = 0; i < MAX_ITER; i++) {
    float3 p = ro + rd * t;
    p.xz = float2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);

    float3 q = p;
    q.y = p.y * uPillarHeight + iTime;

    float freq = 1.0;
    float amp = 1.0;

    // Wave iteration 1
    q.xz = float2(0.921 * q.x - 0.389 * q.z, 0.389 * q.x + 0.921 * q.z);
    q += cos(q.zxy * freq - iTime * 0.0) * amp;
    freq *= 2.0;
    amp *= 0.5;

    // Wave iteration 2
    q.xz = float2(0.921 * q.x - 0.389 * q.z, 0.389 * q.x + 0.921 * q.z);
    q += cos(q.zxy * freq - iTime * 2.0) * amp;

    float d = length(cos(q.xz)) - 0.2;
    float bound = length(p.xz) - uPillarWidth;
    float k = 4.0;
    float h = max(k - abs(d - bound), 0.0);
    d = max(d, bound) + h * h * 0.0625 / k;
    d = abs(d) * 0.15 + 0.01;

    float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
    col += mix(uBottomColor, uTopColor, grad) / d;

    t += d * STEP_MULT;
    if (t > 50.0) break;
  }

  float widthNorm = uPillarWidth / 3.0;
  col = tanhv(col * uGlowAmount / widthNorm);

  // Film grain noise
  col -= hash(C) / 15.0 * uNoiseIntensity;

  return half4(half3(col * uIntensity), 1.0) * uOpacity;
}
`;

// Low-tier variant with fewer iterations for older devices
const SKSL_LOW = `
uniform float iTime;
uniform float2 iResolution;
uniform float3 uTopColor;
uniform float3 uBottomColor;
uniform float uIntensity;
uniform float uGlowAmount;
uniform float uPillarWidth;
uniform float uPillarHeight;
uniform float uNoiseIntensity;
uniform float uRotationSpeed;
uniform float uOpacity;

const float STEP_MULT = 1.5;
const int MAX_ITER = 24;
const int WAVE_ITER = 1;

float3 tanhv(float3 x) {
  float3 e = exp(-2.0 * x);
  return (1.0 - e) / (1.0 + e);
}

half4 main(float2 C) {
  float2 r = iResolution;
  float2 uv = (C * 2.0 - r) / r.x;

  float3 ro = float3(0.0, 0.0, -10.0);
  float3 rd = normalize(float3(uv, 1.0));

  float rotC = cos(iTime * 0.3 * uRotationSpeed);
  float rotS = sin(iTime * 0.3 * uRotationSpeed);

  float3 col = float3(0.0);
  float t = 0.1;

  for (int i = 0; i < MAX_ITER; i++) {
    float3 p = ro + rd * t;
    p.xz = float2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);

    float3 q = p;
    q.y = p.y * uPillarHeight + iTime;

    // Single wave iteration
    q.xz = float2(0.921 * q.x - 0.389 * q.z, 0.389 * q.x + 0.921 * q.z);
    q += cos(q.zxy - iTime) * 0.5;

    float d = length(cos(q.xz)) - 0.2;
    float bound = length(p.xz) - uPillarWidth;
    float k = 4.0;
    float h = max(k - abs(d - bound), 0.0);
    d = max(d, bound) + h * h * 0.0625 / k;
    d = abs(d) * 0.15 + 0.01;

    float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
    col += mix(uBottomColor, uTopColor, grad) / d;

    t += d * STEP_MULT;
    if (t > 50.0) break;
  }

  float widthNorm = uPillarWidth / 3.0;
  col = tanhv(col * uGlowAmount / widthNorm);

  return half4(half3(col * uIntensity), 1.0) * uOpacity;
}
`;

// RuntimeEffect.Make throws on SkSL compile errors; a throw here happens at
// module import and kills the app on startup, so trap it and use the
// tinted-layer fallback instead.
function makeEffect(sksl: string) {
  try {
    return Skia.RuntimeEffect.Make(sksl);
  } catch (e) {
    console.warn('[LightPillarBackground] SkSL compile failed', e);
    return null;
  }
}

const EFFECT_HIGH = makeEffect(SKSL);
const EFFECT_LOW = makeEffect(SKSL_LOW);

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '').padEnd(6, '0');
  return [
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
  ];
}

export interface LightPillarBackgroundProps {
  /** Top gradient color of the light pillar (default: brand green #4be277). */
  topColor?: string;
  /** Bottom gradient color of the light pillar (default: deep emerald). */
  bottomColor?: string;
  /** Overall brightness and intensity multiplier. */
  intensity?: number;
  /** Speed multiplier for the pillar rotation animation. */
  rotationSpeed?: number;
  /** Glow intensity and spread of the light effect. */
  glowAmount?: number;
  /** Width/radius of the light pillar. */
  pillarWidth?: number;
  /** Height scaling factor for the pillar wave distortion. */
  pillarHeight?: number;
  /** Intensity of film grain noise. */
  noiseIntensity?: number;
  /** Overall alpha of the effect. */
  opacity?: number;
  /** false renders a single frozen frame (no per-frame work). */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LightPillarBackground({
  topColor = '#4be277',
  bottomColor = '#005321',
  intensity = 1.0,
  rotationSpeed = 0.3,
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  opacity = 1,
  animated = true,
  style,
}: LightPillarBackgroundProps) {
  const tier = usePerformanceTier();
  const isAnimated = animated && tier !== 'low';
  const { width, height } = useWindowDimensions();

  // 30fps clock instead of Skia's useClock() (60fps) — half the GPU work
  // for an ambient background that nobody pixel-peeps.
  const clock = useSharedValue(0);
  const startTimeRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAnimated) return;
    const tick = () => { clock.value = (Date.now() - startTimeRef.current) / 1000; };
    tick();
    intervalRef.current = setInterval(tick, 33); // ≈30 fps
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isAnimated, clock]);

  const EFFECT = tier === 'low' ? EFFECT_LOW : EFFECT_HIGH;

  const staticUniforms = useMemo(() => {
    return {
      iResolution: [width, height],
      uTopColor: hexToRgb(topColor),
      uBottomColor: hexToRgb(bottomColor),
      uIntensity: intensity,
      uGlowAmount: glowAmount,
      uPillarWidth: pillarWidth,
      uPillarHeight: pillarHeight,
      uNoiseIntensity: tier === 'low' ? 0 : noiseIntensity,
      uRotationSpeed: rotationSpeed,
      uOpacity: opacity,
    };
  }, [topColor, bottomColor, intensity, glowAmount, pillarWidth, pillarHeight, noiseIntensity, rotationSpeed, opacity, width, height, tier]);

  const uniforms = useDerivedValue(
    () => ({
      ...staticUniforms,
      // Frozen frame at an arbitrary pleasing phase when not animated
      iTime: isAnimated ? clock.value : 0.0,
    }),
    [staticUniforms, isAnimated]
  );

  if (!EFFECT) {
    // RuntimeEffect failed to compile — fallback tinted layer
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#060607' }, style]} />;
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
