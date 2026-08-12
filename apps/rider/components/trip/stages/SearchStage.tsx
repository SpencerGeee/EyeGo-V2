import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, BackHandler, ScrollView, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { userApi, queryKeys, type SavedPlace } from '@eyego/api';
import { fonts, fontSizes, radii, spacing, withOpacity , MAX_SEATS_PER_BOOKING } from '@eyego/config';
import {
  Text,
  MorphTarget,
  useMorph,
  MorphBackSwipeDetector,
  AppBackground,
  GlassSurface,
  GradientGlowBorder,
} from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { useThemeStore } from '../../../stores/theme.store';
import { useRideStore } from '../../../stores/ride.store';
import { useTripFlow, type SearchPlace } from '../../../stores/tripFlow.store';
import { useRecentPlaces } from '../../../stores/recentPlaces.store';
import { haptic } from '../../../utils/haptics';
import { consumePickedPlace } from '../../../utils/placePickerResult';
import { expectTripSurfaceReturn } from '../../../utils/tripSurfaceReturn';
import { isHomeLabel, isWorkLabel } from '../../../utils/savedPlaceSlots';

/**
 * Search stage of the persistent trip surface — the where-to card.
 *
 * ARCHITECTURE NOTE (performance): this screen used to host two focused
 * TextInputs, a debounced Nominatim autocomplete list, a KeyboardAwareScrollView
 * and a `LinearTransition` layout animation on the card — all of which ran
 * *during* the container-transform morph in from home. The keyboard raising,
 * the list mounting/remeasuring, and two `GradientGlowBorder` rings (each an
 * oversized LinearGradient rotating forever plus, with `glow`, four
 * shadow-casting layers) meant the morph never had a spare frame. That is what
 * "super laggy" was.
 *
 * It is now a static, keyboard-free surface: two rows that open the fullscreen
 * map picker (which already owns search + reverse-geocode + confirm) — the
 * Uber/Bolt/Yango model. Nothing on this screen animates except the morph
 * itself, so the morph gets the whole frame budget.
 *
 * LAYOUT CONTRACT — read this before touching any style below. This card has
 * collapsed four separate times, always the same way: something in the ancestor
 * chain (MorphTarget → MorphBackSwipeDetector's GestureDetector → the stage's
 * absolute overlay) resolves to an indefinite or zero size, and every `flex`
 * inside here inherits the zero, because `flex: n` in React Native expands to
 * `flexBasis: 0` — a *definite* zero — and `flexBasis: 'auto'` cannot override
 * it. So the rule for this subtree is absolute:
 *
 *   NOTHING between the card and the field text takes its size from a flex,
 *   from `stretch`, or from measurement. Every width and height below is either
 *   a constant or derived arithmetically from `windowWidth`.
 *
 * Keep the constants and the styles that consume them in sync; they are
 * annotated where they must agree.
 */

/** Horizontal inset of the floating card — must match `swipeZone`'s padding. */
const CARD_H_MARGIN = 16;
/** Must match `floatingCard.padding`. */
const CARD_PADDING = 18;
/** Must match `timeline.width`, `swapBtn.width` and `inputsSection.gap`. */
const TIMELINE_W = 14;
const SWAP_W = 38;
const ROW_GAP = 12;
/** Field row height and the derived column height — both EXPLICIT, never
 *  intrinsic. See the layout contract above. */
const ROW_H = 62;
const ROW_STACK_GAP = 8;
const COL_H = ROW_H * 2 + ROW_STACK_GAP;
/** Must match `fieldRow.paddingHorizontal`, `fieldRow.gap` and the trailing
 *  chevron's size — this is the chrome the text column does NOT get. */
const FIELD_PAD_H = 14;
const FIELD_TRAIL_W = 18;
const FIELD_GAP = 10;
const FIELD_CHROME_W = FIELD_PAD_H * 2 + FIELD_TRAIL_W + FIELD_GAP;

/** Timeline geometry, so the dots sit on the vertical centre of their row
 *  instead of floating wherever padding happens to leave them. */
const DOT = 12;
const TIMELINE_TOP = ROW_H / 2 - DOT / 2;
const TIMELINE_LINE_H = ROW_H + ROW_STACK_GAP - DOT;

const savedIcon = (place: SavedPlace): keyof typeof Ionicons.glyphMap => {
  const label = place.label.toLowerCase();
  if (label.includes('home')) return 'home';
  if (label.includes('work') || label.includes('office')) return 'briefcase';
  return 'bookmark';
};

/**
 * Home and Work are not "two of the saved places" — they are the two the rider
 * reaches for by name, and every ride app in this market gives them a permanent
 * slot. Saved places carry a free-text label, so this is how a label becomes a
 * slot: the FIRST place whose label reads as home claims the home slot, the
 * first that reads as work claims work, and everything else is an ordinary
 * saved place below them.
 *
 * The predicates live in utils/savedPlaceSlots so the saved-places screen and
 * this one cannot disagree about what "Home" means — which is precisely how the
 * "add home address" prompt survived the address being added.
 */

/** Metres between two coordinates — enough precision for "am I already here?". */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * How close counts as "already there". GPS in a built-up area drifts by 20–50 m
 * and a house is not a point, so 250 m is generous on purpose: offering someone
 * standing in their own doorway a ride home is worse than briefly hiding a
 * shortcut they could still reach through the search field.
 */
const AT_PLACE_RADIUS_M = 250;

function SearchStageImpl() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  // Every horizontal dimension in the card descends from this one number, so
  // no descendant ever has to ask an ancestor how wide it is allowed to be.
  const cardWidth = Math.max(240, windowWidth - CARD_H_MARGIN * 2);
  const fieldColWidth = Math.max(
    120,
    cardWidth - CARD_PADDING * 2 - TIMELINE_W - SWAP_W - ROW_GAP * 2,
  );
  const fieldTextWidth = Math.max(60, fieldColWidth - FIELD_CHROME_W);

  const { origin, setOrigin, setDestination, setRequestSeats } = useRideStore();
  const morphId = useTripFlow((s) => s.morphId);
  const selectedPlace = useTripFlow((s) => s.searchPlace);
  const setSearchPlace = useTripFlow((s) => s.setSearchPlace);
  const goStage = useTripFlow((s) => s.go);
  const [orderSeats, setOrderSeats] = useState(1);
  // The container-transform source that opened this surface. Home's search
  // pill uses 'where-to-pill'; services cards pass their own id so each
  // morphs from its own card. Falls back to the pill id for deep links.
  const activeMorphId = morphId ?? 'where-to-pill';

  const [originText, setOriginText] = useState(origin?.address ?? 'Current Location');
  const [destText, setDestText] = useState(selectedPlace?.name ?? '');

  // ── What used to be dead space ──────────────────────────────────────────
  // Saved places and recents. The region under the fields was previously blank
  // until a destination existed, which is exactly backwards: the rider needs
  // the shortcuts BEFORE they have chosen, not after.
  const recents = useRecentPlaces((s) => s.places);
  const loadRecents = useRecentPlaces((s) => s.load);
  const addRecent = useRecentPlaces((s) => s.add);
  useEffect(() => { void loadRecents(); }, [loadRecents]);

  const { data: savedPlaces = [] } = useQuery({
    queryKey: queryKeys.user.savedPlaces,
    queryFn: async () => (await userApi.getSavedPlaces()).data?.data?.places ?? [],
    staleTime: 5 * 60_000,
  });

  // BUGFIX: `origin` in the ride store was never populated from the device's
  // real GPS location — every trip search silently fell back to a hardcoded
  // Accra-center coordinate regardless of where the rider actually was. The
  // "Current Location" label promised real GPS but nothing wired it up.
  useEffect(() => {
    if (origin) return; // already set (e.g. rider picked a pickup earlier)
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== 'granted') return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) {
          setOrigin({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            address: 'Current Location',
          });
        }
      } catch {
        // No GPS — SelectStage/RequestStage surface a clear error rather than
        // searching from a fabricated coordinate, so nothing to fall back to.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which field a map-picker navigation was launched for — the picker screen
  // is a single shared route with a one-shot result slot, so this side stores
  // which of origin/dest to apply the result to on return.
  const pickingFieldRef = useRef<'origin' | 'dest' | null>(null);

  const openMapPicker = useCallback((field: 'origin' | 'dest') => {
    haptic.light();
    pickingFieldRef.current = field;
    // The trip surface owns this screen, so coming back from it must not be
    // mistaken for backing into Where-To. See utils/tripSurfaceReturn.
    expectTripSurfaceReturn();
    router.push({
      pathname: '/profile/place-picker',
      params: {
        title: field === 'origin' ? 'Set pickup' : 'Where to?',
        // Land in the search box. The picker still offers the map pin, but a
        // rider naming a business ("IPMC showroom") should be able to type it
        // the moment the screen opens.
        focusSearch: '1',
      },
    } as any);
  }, [router]);

  const commitPlace = useCallback((place: SearchPlace) => {
    setSearchPlace(place);
    setDestination({ address: place.fullAddress, latitude: place.latitude, longitude: place.longitude });
    setDestText(place.name);
    addRecent(place);
    haptic.select();
  }, [setDestination, setSearchPlace, addRecent]);

  /**
   * Which of the two fields a suggestion tap fills.
   *
   * The suggestion list used to be destination-only, so a rider whose PICKUP
   * was the thing they wanted to change — the common case when you are booking
   * from somewhere that is not where you are standing — had exactly one route
   * to it: open the map picker and search. Tapping the row you mean to fill and
   * then tapping Home is the obvious gesture, and it did nothing.
   *
   * Destination is the default because it is what an empty trip is missing:
   * pickup fills itself from GPS a moment after this screen opens.
   */
  const [focusedField, setFocusedField] = useState<'origin' | 'dest'>('dest');

  const commitToOrigin = useCallback((place: SearchPlace) => {
    setOrigin({ latitude: place.latitude, longitude: place.longitude, address: place.fullAddress });
    setOriginText(place.name);
    addRecent(place);
    haptic.select();
  }, [setOrigin, addRecent]);

  /** A suggestion tap. Fills whichever row the rider last focused. */
  const commitToFocused = useCallback((place: SearchPlace) => {
    if (focusedField === 'origin') commitToOrigin(place);
    else commitPlace(place);
  }, [focusedField, commitToOrigin, commitPlace]);

  const handleSwap = useCallback(() => {
    haptic.light();
    if (!selectedPlace || !origin) return;
    const prevOrigin = { latitude: origin.latitude, longitude: origin.longitude, address: origin.address };
    setOrigin({ latitude: selectedPlace.latitude, longitude: selectedPlace.longitude, address: selectedPlace.fullAddress });
    setOriginText(selectedPlace.name);
    commitPlace({
      name: prevOrigin.address,
      fullAddress: prevOrigin.address,
      latitude: prevOrigin.latitude,
      longitude: prevOrigin.longitude,
    });
  }, [selectedPlace, origin, setOrigin, commitPlace]);

  // Destination is confirmed by the picker, so there is no "find rides" browse
  // step — go straight to the driver-matching/dispatch stage.
  // Steps 1-2 end here. Rather than dispatching immediately, this hands over to
  // ConfigureStage for ride type, seats/extras and a review — the paged shape
  // the driver's create-trip flow already has. The seat count set on this card
  // is carried forward as the flow's starting value.
  const handleOrderRide = useCallback(() => {
    haptic.medium();
    setRequestSeats(orderSeats, true);
    goStage('configure');
  }, [goStage, orderSeats, setRequestSeats]);

  // Same choice, later departure. Everything the rider set up here — pickup,
  // destination, seat count — already lives in the ride/tripFlow stores, and
  // the schedule screen seeds itself from them, so the only thing to do before
  // navigating is commit the seat stepper (Order Ride does this too; the
  // Schedule button used to skip it and drop the rider on an empty form).
  const handleSchedule = useCallback(() => {
    haptic.light();
    setRequestSeats(orderSeats, true);
    expectTripSurfaceReturn();
    router.push('/ride/schedule' as any);
  }, [orderSeats, setRequestSeats, router]);

  // Reverse the container-transform back into the home pill. The route uses
  // animation 'none', so morphBack owns the entire exit choreography.
  const { morphBack } = useMorph();
  const handleClose = useCallback(() => {
    morphBack(() => router.back());
  }, [morphBack, router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [handleClose]);

  // Consume a location confirmed on the map picker screen.
  useFocusEffect(
    useCallback(() => {
      const field = pickingFieldRef.current;
      if (!field) return;
      const picked = consumePickedPlace();
      if (!picked) return;
      pickingFieldRef.current = null;
      if (field === 'origin') {
        setOrigin({ latitude: picked.latitude, longitude: picked.longitude, address: picked.fullAddress });
        setOriginText(picked.name);
      } else {
        commitPlace({ name: picked.name, fullAddress: picked.fullAddress, latitude: picked.latitude, longitude: picked.longitude });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // ── Home / Work slots + the rest ────────────────────────────────────────
  // One pass, so a place can only ever occupy one row: whichever slot it claims
  // first, or the "other saved" list if it claims neither. Without this a place
  // labelled "Home office" appeared twice and the rider had two identical rows.
  const { homePlace, workPlace, otherSaved } = useMemo(() => {
    let home: SavedPlace | null = null;
    let work: SavedPlace | null = null;
    const rest: SavedPlace[] = [];
    for (const p of savedPlaces) {
      if (!home && isHomeLabel(p.label)) home = p;
      else if (!work && isWorkLabel(p.label)) work = p;
      else rest.push(p);
    }
    return { homePlace: home, workPlace: work, otherSaved: rest };
  }, [savedPlaces]);

  // "dont suggest going home when im already at home." Suppress the slot the
  // rider is standing in — the address is still reachable by typing it, it just
  // stops being the first thing offered. Needs a real GPS origin: with no fix,
  // `origin` is null and nothing is suppressed, which is the safe direction.
  const atPlace = useCallback(
    (place: SavedPlace | null) => {
      if (!place || !origin) return false;
      return metresBetween(origin.latitude, origin.longitude, place.lat, place.lng) <= AT_PLACE_RADIUS_M;
    },
    [origin],
  );

  const showHome = !atPlace(homePlace);
  const showWork = !atPlace(workPlace);

  const openSavedPlaces = useCallback(() => {
    haptic.light();
    expectTripSurfaceReturn();
    router.push('/profile/saved-places' as any);
  }, [router]);

  /**
   * Recents worth offering for the field the rider is filling.
   *
   * Two filters, both of which the flat list got wrong. A place that is
   * already the OTHER end of this trip is not a suggestion — offering the
   * rider's pickup as their destination produces a zero-length trip and a
   * fare of nothing. And the place already IN the focused field is not a
   * suggestion either; tapping it is a no-op that looks broken.
   *
   * Coordinates are compared at ~11 m (5 decimal places), the same precision
   * the server signs a fare quote at, so "the same place" means the same thing
   * on both sides.
   */
  const relevantRecents = useMemo(() => {
    const at = (a: { latitude: number; longitude: number } | null | undefined,
                b: { latitude: number; longitude: number }) =>
      !!a && a.latitude.toFixed(5) === b.latitude.toFixed(5)
          && a.longitude.toFixed(5) === b.longitude.toFixed(5);
    const other = focusedField === 'origin' ? selectedPlace : origin;
    const mine = focusedField === 'origin' ? origin : selectedPlace;
    return recents.filter((p) => !at(other, p) && !at(mine, p)).slice(0, 6);
  }, [recents, focusedField, origin, selectedPlace]);

  const commitSaved = useCallback(
    (p: SavedPlace) =>
      commitToFocused({ name: p.label, fullAddress: p.address, latitude: p.lat, longitude: p.lng }),
    [commitToFocused],
  );

  /**
   * THE SCREEN IS THE SCREEN NOW.
   *
   * This stage used to be a card floating over the live map with an opaque
   * sheet slid behind it, and it read exactly like that: a black, bare panel
   * with map leaking down its edges and no relationship to the driver app's
   * create-trip screen, which is the same job done well. The rider asked for
   * that screen, so this is that screen — the shared Skia `AppBackground`, two
   * stacked location rows on glass, a glow ring around them, and suggestions
   * underneath.
   *
   * `variant="static"` is deliberate and is the "optimized" part: the animated
   * background runs a shader every frame, and this surface is reached by a
   * container-transform morph that needs the whole frame budget (see the
   * architecture note at the top of this file). The static variant paints once.
   *
   * The map is not mounted behind this at all any more, so there is no leak to
   * cover and no second opaque layer to pay for.
   */
  return (
    <View style={styles.screen}>
      <AppBackground variant="static" isDark={isDark} />

      {/* Header */}
      <View style={[styles.headerRow, { paddingTop: insets.top + 12 }]}>
        <Pressable
          style={styles.backBtn}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>

        <Text style={styles.headerTitle}>Set your trip</Text>

        {/* Steps 1-2 of the same 5-step flow ConfigureStage continues, so the
            rider can see how much is left rather than discovering it. Pickup is
            step 1; a confirmed destination is step 2. */}
        <View style={styles.stepDots} accessibilityLabel={`Step ${selectedPlace ? 2 : 1} of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View
              key={n}
              style={[
                styles.stepDot,
                n <= (selectedPlace ? 2 : 1) && {
                  backgroundColor: colors.primary,
                  width: n === (selectedPlace ? 2 : 1) ? 16 : 5,
                },
              ]}
            />
          ))}
        </View>
      </View>

      {/* The dismiss gesture is scoped to the CARD, not to `flex: 1`.
          Wrapping the whole stage meant the detector also owned every pan over
          the map behind it — so panning the map dismissed the surface (and,
          before the runOnJS fix in MorphBackSwipeDetector, crashed the app). */}
      <MorphBackSwipeDetector style={styles.swipeZone} onSwipeBack={handleClose}>
        <View>
          <MorphTarget id={activeMorphId} borderRadius={24} style={{ width: cardWidth }}>
            <View style={[styles.floatingCard, { width: cardWidth }]}>

              {/*
                ── The two fields ───────────────────────────────────────────
                Mirrors the driver's create-trip step 1: a glass row per end
                with a coloured dot, a connector between them, and the whole
                pair inside a glow ring. Same components, same geometry, so a
                driver and a rider setting up the same trip are looking at the
                same control.

                Tapping a row focuses it AND opens the fullscreen picker. The
                focus is what makes the suggestions below fill the right field
                if the rider backs out of the picker and taps Home instead.
              */}
              {/*
                `fillColor` MUST be opaque, and the palette MUST be the brand's.
                Both were wrong here and together they produced the "the glow
                border is inward, everything is bad" screenshot: a transparent
                fill means the ring's own rotating LinearGradient — which is a
                full-size sweep sitting BEHIND the punched centre — is no longer
                punched out at all, so it washes the entire inside of the card
                instead of showing as a thin edge. And with no `palette` the
                sweep defaults to the blue/orange premium arcs, which is where
                the brown/orange gradient across the pickup and destination rows
                came from on a green-brand screen.

                Opaque fill + `brandGreen` (sampled from the Skia pillar) + a
                deliberately faint intensity: the ring should read as the
                background quietly lighting the card's edge, not as a light
                source of its own.
              */}
              <GradientGlowBorder
                palette="brandGreen"
                borderRadius={radii.xl}
                thickness="thin"
                fillColor={colors.surfaceCard}
                glow
                glowIntensity={0.5}
                maxGlowRadius={12}
              >
                <View style={styles.fieldsGroup}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.locationRow,
                      focusedField === 'origin' && styles.locationRowFocused,
                      pressed && styles.fieldRowPressed,
                    ]}
                    onPress={() => { setFocusedField('origin'); openMapPicker('origin'); }}
                    accessibilityRole="button"
                    accessibilityLabel="Set pickup location"
                  >
                    <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
                    <View style={[styles.locationDot, { backgroundColor: colors.onSurfaceVariant }]} />
                    <View style={styles.locationTextCol}>
                      <Text style={styles.fieldLabel} numberOfLines={1}>PICKUP</Text>
                      <Text
                        style={[styles.locationValue, !originText && styles.fieldPlaceholder]}
                        numberOfLines={1}
                      >
                        {originText || 'Pickup point'}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={FIELD_TRAIL_W}
                      color={withOpacity(colors.onSurfaceVariant, 0.5)}
                    />
                  </Pressable>

                  {/* Connector + swap, sharing the dot's centre line so the two
                      rows read as one journey rather than two controls. */}
                  <View style={styles.connectorRow}>
                    <View style={styles.locationConnector} />
                    <Pressable
                      style={[styles.swapBtn, (!selectedPlace || !origin) && styles.swapBtnDisabled]}
                      onPress={handleSwap}
                      disabled={!selectedPlace || !origin}
                      accessibilityRole="button"
                      accessibilityLabel="Swap pickup and destination"
                      hitSlop={8}
                    >
                      <Ionicons name="swap-vertical" size={16} color={colors.onSurfaceVariant} />
                    </Pressable>
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.locationRow,
                      focusedField === 'dest' && styles.locationRowFocused,
                      pressed && styles.fieldRowPressed,
                    ]}
                    onPress={() => { setFocusedField('dest'); openMapPicker('dest'); }}
                    accessibilityRole="button"
                    accessibilityLabel="Choose destination"
                  >
                    <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii.xl} intensity="low" />
                    <View style={[styles.locationDot, { backgroundColor: colors.primary }]} />
                    <View style={styles.locationTextCol}>
                      <Text style={[styles.fieldLabel, styles.fieldLabelDest]} numberOfLines={1}>WHERE TO</Text>
                      <Text
                        style={[styles.locationValue, !destText && styles.fieldPlaceholder]}
                        numberOfLines={1}
                      >
                        {destText || 'Search a place or address'}
                      </Text>
                    </View>
                    <Ionicons name="search" size={FIELD_TRAIL_W} color={colors.primary} />
                  </Pressable>
                </View>
              </GradientGlowBorder>

              {/* Seats + CTAs, once a destination is confirmed */}
              {selectedPlace && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.seatPickerRow}>
                    <Text variant="bodySmall" color={colors.onSurfaceVariant}>Seats</Text>
                    <View style={styles.seatStepper}>
                      <Pressable
                        style={styles.seatStepperBtn}
                        onPress={() => setOrderSeats((n) => Math.max(1, n - 1))}
                        accessibilityRole="button"
                        accessibilityLabel="Decrease seat count"
                        hitSlop={8}
                      >
                        <Ionicons name="remove" size={16} color={colors.onSurface} />
                      </Pressable>
                      <Text variant="labelLarge" style={{ minWidth: 24, textAlign: 'center' }}>{orderSeats}</Text>
                      <Pressable
                        style={styles.seatStepperBtn}
                        onPress={() => setOrderSeats((n) => Math.min(MAX_SEATS_PER_BOOKING, n + 1))}
                        accessibilityRole="button"
                        accessibilityLabel="Increase seat count"
                        hitSlop={8}
                      >
                        <Ionicons name="add" size={16} color={colors.onSurface} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.ctaRow}>
                    <Pressable
                      style={styles.ctaPrimary}
                      onPress={handleOrderRide}
                      accessibilityRole="button"
                      accessibilityLabel="Order ride"
                    >
                      <Ionicons name="flash" size={18} color={colors.onPrimary} />
                      <Text style={styles.ctaPrimaryText}>Order Ride</Text>
                    </Pressable>
                    <Pressable
                      style={styles.ctaSecondary}
                      onPress={handleSchedule}
                      accessibilityRole="button"
                      accessibilityLabel="Schedule"
                    >
                      <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                      <Text style={styles.ctaSecondaryText}>Schedule</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </MorphTarget>
        </View>
      </MorphBackSwipeDetector>

      {/* ── Suggestions ────────────────────────────────────────────────────
          Underneath the two fields, and deliberately short: saved places and
          recents, nothing else. The old panel led with a full-width search
          button and then listed Home, Work, every saved place and eight
          recents — four sections of chrome above two rows anyone actually
          taps. Search already lives on the destination field itself.

          "Only the relevant ones" is literal here: rows are filtered against
          whichever end is ALREADY set, so the screen never offers a place as a
          destination when it is the pickup, and the heading says which field a
          tap will fill. */}
      <View style={[styles.suggestions, { width: cardWidth }]}>
        <Text style={styles.sectionLabel}>
          {focusedField === 'origin' ? 'Set pickup from' : 'Suggestions'}
        </Text>
        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Home + Work always have a row. A missing one is an invitation to
              add it, not an absence — and once added it IS the row, so the
              prompt can never sit next to the address it was asking for. */}
          <View style={styles.sectionCard}>
            {showHome && (
              <SlotRow
                styles={styles}
                colors={colors}
                icon="home"
                title={homePlace ? homePlace.label : 'Add home address'}
                subtitle={homePlace?.address}
                isPrompt={!homePlace}
                onPress={() => (homePlace ? commitSaved(homePlace) : openSavedPlaces())}
              />
            )}
            {showHome && showWork && <View style={styles.rowDivider} />}
            {showWork && (
              <SlotRow
                styles={styles}
                colors={colors}
                icon="briefcase"
                title={workPlace ? workPlace.label : 'Add work address'}
                subtitle={workPlace?.address}
                isPrompt={!workPlace}
                onPress={() => (workPlace ? commitSaved(workPlace) : openSavedPlaces())}
              />
            )}
          </View>

          {relevantRecents.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Recent</Text>
              <View style={styles.sectionCard}>
                {relevantRecents.map((p, i) => (
                  <React.Fragment key={`${p.latitude},${p.longitude}`}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    <SlotRow
                      styles={styles}
                      colors={colors}
                      icon="time-outline"
                      title={p.name}
                      subtitle={p.fullAddress !== p.name ? p.fullAddress : undefined}
                      onPress={() => commitToFocused(p)}
                    />
                  </React.Fragment>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * One tappable place row. Home, Work, a saved place and a recent are the same
 * gesture with a different icon, so they are the same row — the panel reads as
 * one list rather than three lists that happen to be stacked.
 *
 * `isPrompt` is the empty state: same row, muted title, a plus instead of a
 * chevron. That is deliberate — "Add home address" occupying the home row is
 * what makes the address REPLACE it once saved.
 */
function SlotRow({
  styles,
  colors,
  icon,
  title,
  subtitle,
  isPrompt,
  onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  isPrompt?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.placeRow, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isPrompt ? title : `Go to ${title}`}
    >
      <View style={[styles.placeIcon, isPrompt && styles.placeIconPrompt]}>
        <Ionicons
          name={icon}
          size={17}
          color={isPrompt ? colors.onSurfaceVariant : colors.primary}
        />
      </View>
      <View style={styles.placeTextCol}>
        <Text style={[styles.placeName, isPrompt && styles.placeNamePrompt]} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.placeAddress} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>
      <Ionicons
        name={isPrompt ? 'add' : 'chevron-forward'}
        size={16}
        color={withOpacity(colors.onSurfaceVariant, 0.5)}
      />
    </Pressable>
  );
}

// Memoized so the outgoing stage stays static during trip.tsx crossfades.
export const SearchStage = React.memo(SearchStageImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
  },

  /** The stage, full-bleed. `AppBackground` paints it; nothing shows through.
   *  `flex: 1` is safe HERE — this is the stage root and its parent is the
   *  absolutely-positioned stage container, which has a definite size. The
   *  layout contract at the top of this file applies to everything BELOW. */
  screen: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
    backgroundColor: colors.background,
  },

  /** The two location rows as one unit, inside the glow ring.
   *  Transparent on purpose: the ring's opaque `fillColor` is the surface now.
   *  A translucent colour here is what let the ring's sweep gradient tint the
   *  rows through it. */
  fieldsGroup: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  /** Mirrors the driver's `locationRow` — glass, dot, text, trailing icon. */
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radii.xl,
    paddingHorizontal: FIELD_PAD_H,
    height: ROW_H,
    overflow: 'hidden',
  },
  /** Which row a suggestion tap will fill. Without this the rider has no way
   *  to tell, and the section heading alone is easy to miss. */
  locationRowFocused: {
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.55),
  },
  locationDot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  /** No `flex`. See the layout contract at the top of this file — a flex here
   *  is a definite zero the moment any ancestor measures indefinite, and this
   *  card has collapsed that way four times. Width comes from the row's own
   *  padding instead, which is a constant. */
  locationTextCol: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0 },
  locationValue: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
    marginTop: 2,
  },
  /** Connector + swap on one line, so the swap sits ON the journey line rather
   *  than beside it the way the old right-hand column did. */
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_STACK_GAP + 14,
    paddingHorizontal: FIELD_PAD_H,
    gap: 12,
  },
  locationConnector: {
    width: 2,
    height: 14,
    marginLeft: (DOT - 2) / 2,
    backgroundColor: colors.outline,
  },

  /** The suggestion list under the fields. */
  suggestions: {
    flexGrow: 1,
    flexShrink: 1,
    alignSelf: 'center',
    marginTop: 18,
  },

  /** Opaque, edge to edge, behind everything else in the stage. See the note at
   *  its render site — this is what makes Where-To a sheet rather than a stack
   *  of cards floating on a map the rider cannot use yet. */
  sheetBackdrop: {
    // Spelled out rather than spreading `StyleSheet.absoluteFillObject` — the
    // spread widens every key to `number | undefined` inside `StyleSheet.create`
    // and takes the whole inferred style map down with it.
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background,
  },

  // ─── Header ──────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withOpacity(colors.surfaceCard, 0.8),
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  headerSpacer: { width: 44, height: 44 },
  stepDots: {
    width: 44,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  stepDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.outline },

  /** Dismiss-gesture area: exactly the card's box, never the whole screen —
   *  otherwise the detector owns every pan over the map behind the card. */
  swipeZone: {
    // Content-sized, spelled out as three longhands. `flex: 0` is NOT "size to
    // content" in React Native: it expands to `flexBasis: 0`, a definite
    // main-axis size of zero, and this is a column child of the full-screen
    // overlay.
    //
    // These longhands only actually take effect since the matching fix in
    // MorphBackSwipeDetector. It used to merge `{ flex: 1 }` UNDER this style,
    // and `flexBasis: 'auto'` cannot override a `flex` shorthand in Yoga — auto
    // is not a definite value, so basis still resolved to 0 from the `flex`,
    // while `flexGrow: 0` here won and left the zone unable to grow back. Height
    // zero, card collapsed, field rows with no box to tap.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingHorizontal: CARD_H_MARGIN,
    paddingTop: 8,
  },

  // ─── Floating Card (glass panel) ─────────────────────
  floatingCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.rimLight,
    // MUST equal CARD_PADDING — the field column width is derived from it.
    padding: CARD_PADDING,
    // Softened. A 0.5/32 drop shadow is what a card floating over a live map
    // needs to separate itself from it; on an opaque sheet the same shadow just
    // smears grey down the page under the fields.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },

  // ─── Dual rows + timeline ────────────────────────────
  // Height comes in inline (COL_H). `alignItems` is deliberately NOT 'stretch':
  // stretch pushed every child to the parent's cross size, so an indefinite
  // parent height flattened the whole card to its padding.
  inputsSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ROW_GAP,
  },
  timeline: {
    alignItems: 'center',
    // Puts the first dot on the vertical centre of the first field row rather
    // than wherever symmetric padding happens to leave it.
    paddingTop: TIMELINE_TOP,
    width: TIMELINE_W,
    flexShrink: 0,
  },
  timelineDot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    flexShrink: 0,
  },
  timelineDotOrigin: {
    borderWidth: 2,
    borderColor: colors.onSurfaceVariant,
    backgroundColor: 'transparent',
  },
  timelineDotDest: {
    // Square-cornered, the way every mapping app distinguishes "the end" from
    // "the start" without needing a legend.
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  timelineLine: {
    width: 1.5,
    // Explicit, not `flex: 1` — a flex child cannot fill a parent whose height
    // was itself indeterminate, which is how the rail used to collapse.
    height: TIMELINE_LINE_H,
    backgroundColor: colors.outlineVariant,
  },
  inputsCol: {
    // Width and height are both supplied inline. Deliberately NO `flex` here:
    // `flex: 1` expands to `flexBasis: 0`, which is what let this column
    // measure to nothing in the first place.
    gap: ROW_STACK_GAP,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // MUST match FIELD_PAD_H / FIELD_GAP / ROW_H above.
    paddingHorizontal: FIELD_PAD_H,
    gap: FIELD_GAP,
    // Explicit height, not minHeight: a `minHeight` is still a *minimum*, and a
    // stretched-to-zero cross size beat it in the collapse described above.
    height: ROW_H,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLight,
    backgroundColor: colors.surfaceInput,
  },
  fieldRowDest: {
    borderColor: withOpacity(colors.primary, 0.5),
    backgroundColor: withOpacity(colors.primary, 0.06),
  },
  fieldRowPressed: { opacity: 0.72 },
  fieldTextCol: {
    // Width comes in inline (`fieldTextWidth`). `flex: 1` used to live here and
    // is the same trap as everywhere else in this card.
    minWidth: 0,
    gap: 2,
  },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1,
    color: withOpacity(colors.onSurfaceVariant, 0.7),
  },
  fieldLabelDest: {
    color: withOpacity(colors.primary, 0.9),
  },
  fieldValue: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLarge,
    lineHeight: 21,
    color: colors.onSurface,
  },
  fieldPlaceholder: {
    fontFamily: fonts.regular,
    color: withOpacity(colors.onSurfaceVariant, 0.6),
  },
  swapBtn: {
    width: SWAP_W,
    height: SWAP_W,
    borderRadius: SWAP_W / 2,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
    // Vertically centred against the two-row column, computed rather than
    // flexed for the same reason as everything else here.
    marginTop: (COL_H - SWAP_W) / 2,
    flexShrink: 0,
  },
  swapBtnDisabled: { opacity: 0.4 },

  divider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginVertical: 14,
  },

  // ─── The places panel under the card ──────────────────
  /**
   * The one box in this file that is SUPPOSED to grow, so it is the one place
   * the no-`flex` rule does not apply — but it is still spelled out in
   * longhands rather than `flex: 1`, because the shorthand is what collapsed
   * every other box here and there is no reason to reintroduce the ambiguity.
   * `minHeight: 0` lets the ScrollView inside actually scroll instead of being
   * pushed past the bottom of the screen by its own content.
   */
  panel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    marginTop: 14,
    marginHorizontal: CARD_H_MARGIN,
  },
  panelScroll: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
  },
  panelContent: {
    gap: 10,
  },
  sectionLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: Math.round(11 * 1.3),
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: withOpacity(colors.onSurfaceVariant, 0.7),
    marginTop: 4,
    marginLeft: 4,
  },
  sectionCard: {
    borderRadius: 20,
    // Fully opaque now that it sits on the sheet rather than on the map. At
    // 0.94 every row had a faint wash of whatever was underneath it, which is
    // half of why the Home/Work block read as unfinished.
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.rimLight,
    overflow: 'hidden',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 60,
    paddingHorizontal: 14,
  },
  rowPressed: { opacity: 0.65 },
  placeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(colors.primary, 0.12),
  },
  placeIconPrompt: {
    backgroundColor: colors.surfaceVariant,
  },
  placeTextCol: {
    // Fixed-height row, truncating text — see the layout contract above.
    minWidth: 0,
    gap: 1,
    maxWidth: 230,
  },
  placeName: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
  },
  placeNamePrompt: {
    fontFamily: fonts.regular,
    color: withOpacity(colors.onSurfaceVariant, 0.85),
  },
  placeAddress: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    lineHeight: Math.round(fontSizes.caption * 1.3),
    color: withOpacity(colors.onSurfaceVariant, 0.75),
  },
  rowDivider: {
    marginLeft: 60,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rimLightSubtle,
  },
  searchWideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 18,
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.35),
  },
  searchWideText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.primary,
  },

  // ─── CTAs ─────────────────────────────────────────────
  seatPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  seatStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seatStepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ctaPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 28, paddingVertical: 14, backgroundColor: colors.primary,
  },
  ctaPrimaryText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onPrimary,
  },
  ctaSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 28, paddingVertical: 14, borderWidth: 1.5, borderColor: colors.primary,
  },
  ctaSecondaryText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.primary,
  },
});
