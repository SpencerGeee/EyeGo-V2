import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { springs } from '@eyego/config';

/**
 * THREE SNAPS, THE WAY UBER DOES IT — one hook for every card that has them.
 *
 * Lifted out of the driver's DispatchOfferCard so the rider's find-your-driver
 * card is the same object ("different snap points to show appropriate details
 * per snap point"). The card follows the finger while dragged (with
 * resistance), springs back as the panel reflows to the new snap, and a strong
 * fling skips straight to the top or bottom. A tap steps up, and from the top
 * folds back to peek.
 *
 * Worklets end to end — JS only through runOnJS (a bare JS call from a
 * gesture callback aborts the app).
 */
export function useSnapCard(count: 2 | 3 = 3, initial = 0) {
  const top = count - 1;
  const [snap, setSnapState] = useState(initial);
  const snapSV = useSharedValue(initial);
  const drag = useSharedValue(0);
  useEffect(() => {
    snapSV.value = snap;
  }, [snap, snapSV]);

  const setSnap = useCallback((n: number) => {
    void Haptics.selectionAsync().catch(() => {});
    setSnapState(Math.max(0, Math.min(top, n)));
  }, [top]);

  const grab = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Pan()
          .activeOffsetY([-10, 10])
          .onUpdate((e) => {
            const y = e.translationY;
            drag.value = y < 0 ? -Math.min(56, -y * 0.45) : Math.min(90, y * 0.55);
          })
          .onEnd((e) => {
            const cur = snapSV.value;
            let next = cur;
            if (e.velocityY < -1600) next = top;
            else if (e.velocityY > 1600) next = 0;
            else if (e.translationY < -28 || e.velocityY < -450) next = cur + 1;
            else if (e.translationY > 28 || e.velocityY > 450) next = cur - 1;
            drag.value = withSpring(0, springs.standard);
            if (next !== cur) runOnJS(setSnap)(next);
          }),
        Gesture.Tap().onEnd(() => {
          runOnJS(setSnap)(snapSV.value >= top ? 0 : snapSV.value + 1);
        }),
      ),
    [drag, snapSV, setSnap, top],
  );
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  return { snap, setSnap, grab, dragStyle };
}
