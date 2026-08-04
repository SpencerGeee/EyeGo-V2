import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, BackHandler } from 'react-native';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import { withOpacity } from '@eyego/config';
import { useColors } from '../utils/useColors';
import { useTripFlow, type TripStage } from '../stores/tripFlow.store';
import { useTripStore, stageForStatus } from '../stores/trip.store';
import { TripMap } from '../components/trip/TripMap';
import { SearchStage } from '../components/trip/stages/SearchStage';
import { SelectStage } from '../components/trip/stages/SelectStage';
import { RequestStage } from '../components/trip/stages/RequestStage';

// Yango-style slow ease: 700ms with a gentle ease-out so the crossfade
// spans as a continuous, perceptible morph rather than a quick snap.
const STAGE_TRANSITION_CFG = { duration: 700, easing: Easing.out(Easing.cubic) };


/**
 * The persistent trip surface — ONE route hosting the whole booking flow as
 * stages (search → select → request → assigned → tracking) so the map and
 * panel stay mounted while only stage content changes. Route config mirrors
 * the old where-to screen: animation 'none' + transparentModal, because the
 * MorphProvider clone owns the entrance/exit choreography.
 *
 * Stage swaps crossfade through one shared progress value: the outgoing
 * stage fades/lifts away while the incoming one fades/rises in, both mounted
 * for the duration — no unmount jump-cuts, exactly the Yango morph feel.
 *
 * Stages not yet migrated (assigned/tracking) bridge to their legacy routes.
 */
function renderStage(stage: TripStage) {
  switch (stage) {
    case 'search': return <SearchStage />;
    case 'select': return <SelectStage />;
    case 'request': return <RequestStage />;
    // assigned/tracking still live on legacy routes (P3) — never reached yet.
    default: return null;
  }
}

export default function TripScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{
    stage?: string; tier?: string; type?: string; morphId?: string; bookingId?: string;
  }>();
  const stage = useTripFlow((s) => s.stage);
  const seed = useTripFlow((s) => s.seed);
  const popStage = useTripFlow((s) => s.popStage);
  const syncFromServer = useTripFlow((s) => s.syncFromServer);
  const tripStatus = useTripStore((s) => s.snapshot?.status ?? null);
  const hydrate = useTripStore((s) => s.hydrate);

  // Seed the stage machine once per surface open, from route params.
  useEffect(() => {
    seed({
      stage: (params.stage as TripStage) ?? 'search',
      tier: params.tier,
      type: params.type,
      morphId: params.morphId,
      bookingId: params.bookingId,
    });
    // ONE-CALL REHYDRATION. If a ride is already live — cold start, app killed
    // mid-trip, deep link — this is what makes the surface open on the right
    // stage instead of dropping the rider back on 'search' as though nothing
    // were happening. Neither app had an equivalent before.
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * THE PROJECTION. Once a trip exists its status decides the stage, full
   * stop. The client no longer navigates itself forward and then has to
   * defend that decision against contradicting pushes — which is what made
   * the request flow feel inconsistent.
   */
  useEffect(() => {
    const derived = stageForStatus(tripStatus);
    if (derived) syncFromServer(derived);
  }, [tripStatus, syncFromServer]);

  // Hardware back for stages past the root — the search stage registers its
  // own handler (morph-back to the home pill). Registered per-stage so the
  // search handler wins whenever search is the active stage.
  useEffect(() => {
    if (stage === 'search') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      popStage();
      return true;
    });
    return () => sub.remove();
  }, [stage, popStage]);

  // ── Stage crossfade: outgoing fades/lifts, incoming fades/rises ──
  const progress = useSharedValue(1);
  const [rendered, setRendered] = useState<{ current: TripStage; previous: TripStage | null }>(
    { current: stage, previous: null },
  );
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;

  useEffect(() => {
    if (stage === renderedRef.current.current) return;
    setRendered({ current: stage, previous: renderedRef.current.current });
    progress.value = 0;
    progress.value = withTiming(1, STAGE_TRANSITION_CFG, (finished) => {
      if (finished) runOnJS(setRendered)({ current: stage, previous: null });
    });
  }, [stage, progress]);

  const incomingStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: progress.value * -12 }],
  }));

  const mapGradient = useMemo(
    () => ({
      position: 'absolute' as const,
      top: 0, left: 0, right: 0,
      height: 220,
      backgroundColor: withOpacity(colors.backgroundDeep, 0.55),
    }),
    [colors],
  );

  return (
    // The 250ms fade used to be the loudest thing on screen: it faded the map,
    // the header AND the card in together, well before the morph clone had
    // finished travelling, so the whole transition registered as "a quick fade"
    // rather than a card growing. Stretched to roughly the morph's own travel
    // time so it reads as the background settling in behind the morph instead
    // of racing it. The card itself is no longer part of this story — its
    // reveal is driven by morph progress in MorphTarget.
    <Animated.View style={styles.root} entering={FadeIn.duration(420)}>
      {/* One persistent map for every stage */}
      <TripMap />
      <View style={mapGradient} pointerEvents="none" />

      {rendered.previous && (
        <Animated.View style={[StyleSheet.absoluteFill, outgoingStyle]} pointerEvents="none">
          {renderStage(rendered.previous)}
        </Animated.View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, incomingStyle]}>
        {renderStage(rendered.current)}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
});
