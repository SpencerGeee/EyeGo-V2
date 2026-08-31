# Panel Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the rider app from mixed panel implementations to a unified panel architecture using `@eyego/ui/panel` motion engine, removing `@gorhom/bottom-sheet`.

**Architecture:** Create an `InlayPanel` that uses the existing `usePanelMotion` engine but renders in the view hierarchy (not a modal) for screens that need the map to render behind the panel. Enhance `PanelSheet` to support `collapsed` snap points. Replace `@gorhom/bottom-sheet` and full-screen modals with the new custom panels.

**Tech Stack:** React Native, Reanimated v3, React Native Gesture Handler

---

### Task 1: Enhance PanelSheet to support collapsed snap point

**Files:**
- Modify: `packages/ui/src/panel/PanelSheet.tsx`

- [ ] **Step 1: Update PanelSheetProps and implementation**

```tsx
// In PanelSheetProps, add collapsedHeightPct
export interface PanelSheetProps {
  // ... existing props
  /** Mid stop height as a fraction of screen height. */
  collapsedHeightPct?: number;
  // ...
}

// In PanelSheet component, compute collapsed
export function PanelSheet({
  // ... existing props
  collapsedHeightPct,
  // ...
}: PanelSheetProps) {
  // ...
  const collapsed = collapsedHeightPct ? screenH - Math.min(screenH * collapsedHeightPct, maxH) : undefined;
  
  // Pass collapsed to usePanelMotion
  const {
    progress,
    // ...
  } = usePanelMotion({
    snapPoints: { hidden: screenH, collapsed, expanded },
    initialState: collapsed !== undefined ? 'collapsed' : 'hidden', // if collapsed exists, snap there first
    // ...
  });
  // ...
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/panel/PanelSheet.tsx
git commit -m "feat(ui): add collapsed state support to PanelSheet"
```

### Task 2: Create InlayPanel Component

**Files:**
- Create: `packages/ui/src/panel/InlayPanel.tsx`
- Modify: `packages/ui/src/panel/index.ts`

- [ ] **Step 1: Write InlayPanel implementation**

```tsx
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
```

- [ ] **Step 2: Export InlayPanel**

```typescript
// Add to packages/ui/src/panel/index.ts
export { InlayPanel } from './InlayPanel';
export type { InlayPanelProps } from './InlayPanel';
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/panel/InlayPanel.tsx packages/ui/src/panel/index.ts
git commit -m "feat(ui): add InlayPanel component for non-modal bottom sheets"
```

### Task 3: Migrate ride/[id].tsx to InlayPanel

**Files:**
- Modify: `apps/rider/app/ride/[id].tsx`

- [ ] **Step 1: Replace gorhom with InlayPanel**

Replace `@gorhom/bottom-sheet` imports and usage with `InlayPanel` from `@eyego/ui`.

```tsx
// Remove imports:
// import BottomSheet, { BottomSheetScrollView, useBottomSheetSpringConfigs } from '@gorhom/bottom-sheet';

// Add imports:
import { InlayPanel } from '@eyego/ui';

// Replace BottomSheet usage:
// Remove bottomSheetRef, snapPoints, sheetSpringConfigs

<InlayPanel
  snapPointsPct={[0.58, 0.85]}
  sheetStyle={styles.sheetBackground}
  grabberColor={colors.outline}
>
  <View style={styles.sheetContent}>
    {/* Keep the content inside but remove BottomSheetScrollView */}
    {/* Replace BottomSheetScrollView with normal View, InlayPanel handles scrolling */}
    {/* MotiViews and children remain the same */}
  </View>
</InlayPanel>
```

- [ ] **Step 2: Verify with LSP and test**

Run: `npx tsc --noEmit`
Make sure `ride/[id].tsx` has no type errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/rider/app/ride/[id].tsx"
git commit -m "refactor(rider): migrate ride details from @gorhom to InlayPanel"
```

### Task 4: Migrate ride/[id]/tracking.tsx to InlayPanel

**Files:**
- Modify: `apps/rider/app/ride/[id]/tracking.tsx`

- [ ] **Step 1: Replace gorhom with InlayPanel**

Replace `@gorhom/bottom-sheet` imports and usage with `InlayPanel` from `@eyego/ui`.

```tsx
// Remove imports:
// import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

// Add imports:
import { InlayPanel } from '@eyego/ui';

// Replace BottomSheet usage:
// Remove bottomSheetRef, snapPoints = ['44%', '65%'], SNAP_PCTS

<InlayPanel
  snapPointsPct={[0.44, 0.65]}
  sheetStyle={styles.sheetBackground}
  grabberColor={colors.outline}
>
  <View style={styles.sheetContent}>
    {/* Keep content, replace BottomSheetScrollView with View */}
  </View>
</InlayPanel>
```

- [ ] **Step 2: Update map padding logic**

Update the map padding logic that was tracking sheet index:

```tsx
// Replace frameOnTarget with static padding
const frameOnTarget = useCallback(
  (coord: [number, number], duration = 450) => {
    cameraRef.current?.setCamera({
      centerCoordinate: coord,
      zoomLevel: 14,
      animationDuration: duration,
      padding: { paddingTop: insets.top + 90, paddingBottom: screenH * 0.44 },
    });
  },
  [insets.top, screenH]
);
```

- [ ] **Step 3: Commit**

```bash
git add "apps/rider/app/ride/[id]/tracking.tsx"
git commit -m "refactor(rider): migrate ride tracking from @gorhom to InlayPanel"
```

### Task 5: Migrate profile/help.tsx to InlayPanel

**Files:**
- Modify: `apps/rider/app/profile/help.tsx`

- [ ] **Step 1: Replace gorhom with InlayPanel**

Replace `@gorhom/bottom-sheet` imports and usage with `InlayPanel`.

```tsx
// Remove imports:
// import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';

// Replace usage with InlayPanel
<InlayPanel
  snapPointsPct={[0.6, 0.9]}
  sheetStyle={{ backgroundColor: colors.surfaceCard }}
>
  {/* Content */}
</InlayPanel>
```

- [ ] **Step 2: Commit**

```bash
git add apps/rider/app/profile/help.tsx
git commit -m "refactor(rider): migrate profile help from @gorhom to InlayPanel"
```

### Task 6: Remove @gorhom/bottom-sheet dependency

**Files:**
- Modify: `apps/rider/package.json`

- [ ] **Step 1: Remove package and install**

```bash
cd apps/rider
bun remove @gorhom/bottom-sheet
```

- [ ] **Step 2: Commit**

```bash
git add apps/rider/package.json apps/rider/bun.lockb
git commit -m "chore(rider): remove @gorhom/bottom-sheet dependency"
```

### Task 7: Refactor ride/select.tsx to InlayPanel (Optional Phase)

*This is a complex phase as it replaces a full route presentation with an inline panel, changing the navigation stack. To be evaluated after Task 6.*
