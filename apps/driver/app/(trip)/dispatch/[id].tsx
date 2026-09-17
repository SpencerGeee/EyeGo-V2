import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { goOut } from '@eyego/ui';
import { useDriverTripStore } from '../../../stores/trip.store';
import { useDriverSurface } from '../../../components/surface/driverStage';
import { useColors } from '../../../utils/useColors';

/**
 * THE OFFER ROUTE IS A DOOR, NOT A ROOM.
 *
 * This was a thousand-line screen with its own MapView, its own countdown and
 * its own accept endpoint — the third rendering of an offer in this app, and
 * the one the driver called "dead": a row with no exclusive window drew no
 * clock and nothing ever expired it. There is ONE renderer now, the
 * root-mounted `DispatchOfferSheet`, which raises itself over any screen the
 * moment a ride is held for this driver or a board row is focused.
 *
 * The route survives because push-notification taps, deep links and the
 * legacy `trip:assigned` frame still name it. It re-reads the board so the row
 * exists, focuses it, and goes home; the sheet does the rest.
 */
export default function DispatchScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  useEffect(() => {
    let cancelled = false;
    void useDriverTripStore
      .getState()
      .hydrate()
      .finally(() => {
        if (cancelled) return;
        if (id) useDriverSurface.getState().openOffer(String(id));
        goOut('/(tabs)/home');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <View style={[styles.root, { backgroundColor: colors.backgroundDeep }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
