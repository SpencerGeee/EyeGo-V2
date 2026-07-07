import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePanelMotion, type PanelState } from './usePanelMotion';
import { usePanelLifecycle } from './usePanelLifecycle';

/**
 * Gesture-driven modal bottom panel built on the `usePanelMotion` engine:
 * spring open, drag-to-dismiss with velocity snapping, backdrop opacity
 * derived from the single panel progress value, and scroll/drag ownership
 * arbitration for the inner content.
 *
 * The panel engine owns visible/expanded/dismissed; callers own only the
 * content rendered inside — swap content freely without touching motion.
 *
 * Auto-height: the sheet body is measured and the expanded stop is derived
 * from content height, capped at `maxHeightPct` of the screen.
 */

export interface PanelSheetProps {
  visible: boolean;
  /** Called after the sheet has fully animated off-screen. */
  onDismiss: () => void;
  children: React.ReactNode;
  /** Expanded height cap as a fraction of screen height. */
  maxHeightPct?: number;
  /** Mid stop height as a fraction of screen height. */
  collapsedHeightPct?: number;
  /** Peak backdrop opacity at full expansion. */
  backdropOpacity?: number;
  /** Wrap children in an arbitrated scroll view (default true). */
  scrollable?: boolean;
  /** Styles the sheet body (background, radius, padding). */
  sheetStyle?: StyleProp<ViewStyle>;
  grabberColor?: string;
  onStateChange?: (state: PanelState) => void;
}

export function PanelSheet({
  visible,
  onDismiss,
  children,
  maxHeightPct = 0.85,
  collapsedHeightPct,
  backdropOpacity = 0.65,
  scrollable = true,
  sheetStyle: sheetBodyStyle,
  grabberColor = 'rgba(255,255,255,0.18)',
  onStateChange,
}: PanelSheetProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const maxH = Math.round(screenH * maxHeightPct);

  // contentHeight is measured inline so expanded snap-point is
  // accurate BEFORE usePanelMotion initialises the spring engine.
  const [contentH, setContentH] = useState(0);
  const expanded = contentH > 0 ? screenH - Math.min(contentH, maxH) : screenH;
  const collapsed = collapsedHeightPct ? screenH - Math.min(screenH * collapsedHeightPct, maxH) : undefined;

  // Ref indirection: usePanelMotion needs onDismissed at construction time,
  // but handleDismissed comes from usePanelLifecycle which depends on
  // snapToState (returned by usePanelMotion).  The ref breaks the cycle.
  const handleDismissedRef = useRef<() => void>(() => {});

  const {
    progress,
    panGesture,
    nativeGesture,
    scrollHandler,
    sheetStyle,
    snapToState,
  } = usePanelMotion({
    snapPoints: { hidden: screenH, collapsed, expanded },
    initialState: collapsed !== undefined ? 'collapsed' : 'hidden',
    dismissible: true,
    onDismissed: () => { handleDismissedRef.current(); },
    onStateChange,
  });

  const { mounted, handleDismissed } = usePanelLifecycle({
    visible,
    contentH,
    snapToState,
    onDismiss,
    setContentH,
  });

  // Keep the ref in sync — runs after every render so by the time a spring
  // completion fires asynchronously the latest handleDismissed is always hit.
  useEffect(() => {
    handleDismissedRef.current = handleDismissed;
  });

  const dismiss = useCallback(() => snapToState('hidden'), [snapToState]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * backdropOpacity }));

  if (!mounted) return null;

  const content = scrollable ? (
    <GestureDetector gesture={nativeGesture}>
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: maxH - insets.bottom }}
      >
        {children}
      </Animated.ScrollView>
    </GestureDetector>
  ) : (
    children
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      {/* RNGH gestures inside a RN Modal need their own root view. */}
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>

        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.sheetContainer, { height: screenH }, sheetStyle]}>
            <View
              style={[styles.sheetBody, { maxHeight: maxH, paddingBottom: Math.max(insets.bottom, 16) }, sheetBodyStyle]}
              onLayout={(e) => {
                const h = Math.ceil(e.nativeEvent.layout.height);
                if (h !== contentH) setContentH(h);
              }}
            >
              <View style={[styles.grabber, { backgroundColor: grabberColor }]} />
              {content}
            </View>
            {/* Tail hides the gap when the sheet rubber-bands past fully open. */}
            <View style={[styles.tail, sheetBodyStyle, styles.tailReset]} />
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  sheetContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  sheetBody: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  tail: {
    height: 80,
    marginTop: -1,
  },
  tailReset: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 0,
    paddingBottom: 0,
    maxHeight: undefined,
  },
});
