import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePanelMotion, type PanelState } from './usePanelMotion';

export interface InlayPanelProps {
  children: React.ReactNode;
  snapPointsPct: [number, number]; // e.g. [0.44, 0.65] for collapsed and expanded
  initialState?: PanelState;
  sheetStyle?: StyleProp<ViewStyle>;
  grabberColor?: string;
  onStateChange?: (state: PanelState) => void;
}

export function InlayPanel({
  children,
  snapPointsPct,
  initialState = 'collapsed',
  sheetStyle: sheetBodyStyle,
  grabberColor = 'rgba(255,255,255,0.18)',
  onStateChange,
}: InlayPanelProps) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  
  const collapsed = screenH * (1 - snapPointsPct[0]);
  const expanded = screenH * (1 - snapPointsPct[1]);
  const hidden = screenH;

  const {
    y,
    panGesture,
    nativeGesture,
    scrollHandler,
    sheetStyle,
  } = usePanelMotion({
    snapPoints: { hidden, collapsed, expanded },
    initialState,
    dismissible: false,
    onStateChange,
  });

  return (
    <View style={styles.absoluteOverlay} pointerEvents="box-none">
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.sheetContainer, { height: screenH }, sheetStyle]}>
          <View style={[styles.sheetBody, { paddingBottom: Math.max(insets.bottom, 16) }, sheetBodyStyle]}>
            <View style={[styles.grabber, { backgroundColor: grabberColor }]} />
            <GestureDetector gesture={nativeGesture}>
              <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                bounces={false}
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: screenH - expanded - insets.bottom }}
              >
                {children}
              </Animated.ScrollView>
            </GestureDetector>
          </View>
          <View style={[styles.tail, sheetBodyStyle, styles.tailReset]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  absoluteOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
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
    backgroundColor: '#1E1E1E', // Default fallback
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
