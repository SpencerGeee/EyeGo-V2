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
  backdropOpacity = 0.65,
  scrollable = true,
  sheetStyle: sheetBodyStyle,
  grabberColor = 'rgba(255,255,255,0.18)',
  onStateChange,
}: PanelSheetProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [contentH, setContentH] = useState(0);

  const maxH = Math.round(screenH * maxHeightPct);
  const expanded = contentH > 0 ? screenH - Math.min(contentH, maxH) : screenH;

  // Ref so a re-render mid-dismissal can't swap the callback under the spring.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const handleDismissed = useCallback(() => {
    setMounted(false);
    setContentH(0);
    onDismissRef.current();
  }, []);

  const {
    progress,
    panGesture,
    nativeGesture,
    scrollHandler,
    sheetStyle,
    snapToState,
  } = usePanelMotion({
    snapPoints: { hidden: screenH, expanded },
    initialState: 'hidden',
    dismissible: true,
    onDismissed: handleDismissed,
    onStateChange,
  });

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (mounted && visible && contentH > 0) snapToState('expanded');
  }, [mounted, visible, contentH, snapToState]);

  useEffect(() => {
    if (!visible && mounted && contentH > 0) snapToState('hidden');
  }, [visible, mounted, contentH, snapToState]);

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
