import { useCallback, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Sheet-aware trip camera — the imperative map-framing logic shared by the
 * assigned and tracking stages of the persistent trip surface.
 *
 * The panel (InlayPanel) covers the bottom of the screen, so the focus target
 * must sit centered in the *visible* window above it. We track the current
 * snap as bottom camera padding, and only auto-follow while the user hasn't
 * panned away — a manual pan pauses following, the recenter chip resumes it.
 *
 * The camera is driven imperatively (setCamera) rather than by re-rendering a
 * <Camera centerCoordinate> so the map glides smoothly between driver pings
 * instead of snapping on every React render.
 *
 * Extracted from app/ride/[id]/tracking.tsx (P3) so AssignedStage and
 * TrackingStage frame identically without duplicating the padding math.
 */

/** Panel snap heights as a fraction of screen height. */
export const COLLAPSED_PCT = 0.44;
export const EXPANDED_PCT = 0.65;

export type PanelState = 'collapsed' | 'expanded';

export interface TripCamera {
  /** Attach to <MapboxGL.Camera ref>. */
  cameraRef: React.MutableRefObject<any>;
  /** Panel snap points as fractions, for InlayPanel snapPointsPct. */
  snapPointsPct: [number, number];
  /** Current panel snap (drives recenter-chip offset + banner lift). */
  panelState: PanelState;
  /** True while the camera auto-follows the target (recenter chip visibility). */
  following: boolean;
  /** Live ref mirror of `following` for use inside socket callbacks. */
  followingRef: React.MutableRefObject<boolean>;
  /** Pause/resume auto-follow (pause on manual pan, resume on recenter). */
  setFollowing: (v: boolean) => void;
  /** Imperatively glide the camera to frame a coordinate above the sheet. */
  frameOnTarget: (coord: [number, number], duration?: number) => void;
  /** Sync the sheet padding + panelState when the panel snaps. */
  onPanelStateChange: (state: string) => void;
}

export function useTripCamera(): TripCamera {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const cameraRef = useRef<any>(null);
  const sheetPadRef = useRef(screenH * COLLAPSED_PCT);
  const followingRef = useRef(true);
  const [following, setFollowingState] = useState(true);
  const [panelState, setPanelState] = useState<PanelState>('collapsed');

  const setFollowing = useCallback((v: boolean) => {
    followingRef.current = v;
    setFollowingState(v);
  }, []);

  const frameOnTarget = useCallback(
    (coord: [number, number], duration = 450) => {
      cameraRef.current?.setCamera({
        centerCoordinate: coord,
        zoomLevel: 14,
        animationDuration: duration,
        padding: { paddingTop: insets.top + 90, paddingBottom: sheetPadRef.current },
      });
    },
    [insets.top],
  );

  const onPanelStateChange = useCallback(
    (state: string) => {
      if (state !== 'collapsed' && state !== 'expanded') return;
      const pct = state === 'expanded' ? EXPANDED_PCT : COLLAPSED_PCT;
      sheetPadRef.current = screenH * pct;
      setPanelState(state);
    },
    [screenH],
  );

  return {
    cameraRef,
    snapPointsPct: [COLLAPSED_PCT, EXPANDED_PCT],
    panelState,
    following,
    followingRef,
    setFollowing,
    frameOnTarget,
    onPanelStateChange,
  };
}
