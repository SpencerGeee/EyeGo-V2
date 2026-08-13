// Primitives
export { Text } from './Text';
export { Pressable } from './Pressable';
export type { TextVariant } from './Text';

// Theming
export { ColorsProvider, useThemedColors } from './ColorsContext';

// Inputs & Forms
export { Button } from './Button';
export { Input } from './Input';
export { OTPInput } from './OTPInput';
export type { OTPInputRef } from './OTPInput';
export type { ButtonVariant, ButtonSize } from './Button';

// Layout & Display
export { Card } from './Card';
export { GlassCard } from './GlassCard';
export { Skeleton } from './Skeleton';
// A figure that has not loaded must not render as zero — see the note in the file.
export { SkeletonValue } from './SkeletonValue';
export { Avatar } from './Avatar';
export { Toggle } from './Toggle';
export { Radio } from './Radio';
export { EmptyState } from './EmptyState';
export { Loader } from './Loader';
export { ShinyText } from './ShinyText';

// Badges & Status
export { CarMarker } from './CarMarker';
export type { CarMarkerProps } from './CarMarker';
export { SwipeToConfirm } from './SwipeToConfirm';
export type { SwipeToConfirmProps } from './SwipeToConfirm';
export { TierBadge } from './TierBadge';
export { getTierTheme, normalizeTier, tierToWire, RIDER_TIERS } from './tierTheme';
export type { TierId, TierTheme } from './tierTheme';
export { StatusBadge, BOOKING_STATUS_LABELS, bookingStatusLabel } from './StatusBadge';
export { SeatBadge } from './SeatBadge';

// Ride Components
export { SeatBar } from './SeatBar';
export { TierSelector } from './TierSelector';
export { DriverInfoCard } from './DriverInfoCard';
export { AnimatedFareText } from './AnimatedFareText';
export { RollingDigits } from './RollingDigits';
// Moti with the platform's spring instead of Reanimated 3's bouncy default —
// import from here, never from 'moti'. See Motion.tsx.
export { MotiView, MotiText, AnimatePresence } from './Motion';
export { RideCard } from './RideCard';

// Premium Effects
export { GradientGlowBorder, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS, RING_PALETTES } from './effects/GradientGlowBorder';
export type { GradientGlowBorderHandle, RingPalette } from './effects/GradientGlowBorder';
export { LightfallBackground } from './effects/LightfallBackground';
export type { LightfallBackgroundProps } from './effects/LightfallBackground';
export { CardAuroraGlow } from './effects/CardAuroraGlow';
export type { CardAuroraGlowProps } from './effects/CardAuroraGlow';
export { LightPillarBackground } from './effects/LightPillarBackground';
export type { LightPillarBackgroundProps } from './effects/LightPillarBackground';
export { AmbientRotationProvider, useAmbientRotation } from './effects/useAmbientRotation';
export { GlassSurface } from './effects/GlassSurface';
export { LensSheen } from './effects/LensSheen';
export { GlowSearchInput, GlowSearchPressable } from './effects/GlowSearchInput';
export { usePerformanceTier } from './effects/usePerformanceTier';
export type { PerformanceTier } from './effects/usePerformanceTier';
export { AppBackground } from './effects/AppBackground';
export { setBackgroundBusy, subscribeBackgroundBusy, backgroundScrollPauseProps } from './effects/backgroundActivity';
export { useShaderSlot, shaderSlotWaiters } from './effects/shaderSlot';
export { MorphProvider, MorphSource, MorphTarget, MorphBackSwipeDetector, useMorph, useMorphOptional } from './morph';
export type { MorphRect, MorphSourceHandle } from './morph';
export { PulseRing } from './effects/PulseRing';

// Animation Primitives
// The press-down scale for every touchable. Never hand-roll a withSpring for a
// press — see usePressScale.ts for what that drifted into.
export { usePressScale } from './usePressScale';
export { Entrance, StaggerList, AnimatedList } from './animations';
export type { EntranceProps, EntranceAnimation, ExitAnimation, StaggerListProps, AnimatedListProps } from './animations';
export type { PulseRingProps } from './effects/PulseRing';
export { AnimatedCheckmark } from './effects/AnimatedCheckmark';
export type { AnimatedCheckmarkProps } from './effects/AnimatedCheckmark';
export { PanelSheet, InlayPanel, usePanelMotion, usePanelLifecycle, panelSpring } from './panel';
export type { PanelSheetProps, InlayPanelProps, PanelState, PanelSnapPoints, PanelMotionOptions } from './panel';
export {
  MorphSheet,
  MORPH_SHEET_SPRING,
  SheetMetricsProvider,
  useSheetMetrics,
  useCreateSheetMetrics,
  createSheetMetrics,
} from './panel';
export type { MorphSheetProps, SheetMetrics } from './panel';
export { MorphCTA } from './MorphCTA';
export type { MorphCTAProps } from './MorphCTA';
export {
  sheetContentLayout,
  rowLayout,
  contentEnter,
  contentExit,
} from './motion/layoutTransitions';
