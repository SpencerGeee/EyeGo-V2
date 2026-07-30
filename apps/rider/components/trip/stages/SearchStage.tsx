import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, BackHandler, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { Text, MorphTarget, useMorph, MorphBackSwipeDetector } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { useRideStore } from '../../../stores/ride.store';
import { useTripFlow, type SearchPlace } from '../../../stores/tripFlow.store';
import { haptic } from '../../../utils/haptics';
import { consumePickedPlace } from '../../../utils/placePickerResult';

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
 */
/** Horizontal inset of the floating card — must match `cardWrap`'s padding. */
const CARD_H_MARGIN = 16;
/** Must stay in sync with `floatingCard.padding`, `timeline.width`, `swapBtn.width`
 *  and `inputsSection.gap` — the field column's width is derived from them. */
const CARD_PADDING = spacing.xl;
const TIMELINE_W = 12;
const SWAP_W = 38;
const ROW_GAP = 12;

function SearchStageImpl() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // BUGFIX: the pickup/destination rows collapsed to just their two icons,
  // hugged to the left of the card. Every view between here and the screen
  // root is a stretch-width flex child *in theory*, but the card sits inside
  // MorphTarget → MorphBackSwipeDetector's GestureDetector wrapper → the
  // stage's absolutely-positioned overlay, and when that chain resolves to a
  // content-driven width the `flex: 1` on the label Text measures to zero and
  // the row shrink-wraps its icons — exactly the reported symptom. Pin the
  // card to the real window width so the rows can never be content-sized,
  // whatever the ancestors do.
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.max(240, windowWidth - CARD_H_MARGIN * 2);
  // BUGFIX (reported twice — the previous attempt pinned only the CARD width and
  // the rows still collapsed): the field column relied on `flex: 1` inside a row
  // to claim the space left over by the timeline rail and the swap button. Flex
  // distributes *free* space, so the moment any ancestor resolves to a
  // content-driven width there is no free space to distribute, the column
  // measures to its icons, and the rider sees two bare glyphs hugging the left
  // edge with no visible field at all. Deriving the width arithmetically from
  // the (already pinned) card width removes the dependency on the ancestor chain
  // entirely — see CARD_PADDING/TIMELINE_W/SWAP_W below.
  const fieldColWidth = Math.max(
    120,
    cardWidth - CARD_PADDING * 2 - TIMELINE_W - SWAP_W - ROW_GAP * 2,
  );
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
    haptic.select();
  }, [setDestination, setSearchPlace]);

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
  const handleOrderRide = useCallback(() => {
    haptic.medium();
    setRequestSeats(orderSeats, true);
    goStage('request');
  }, [goStage, orderSeats, setRequestSeats]);

  // Same choice, later departure. Everything the rider set up here — pickup,
  // destination, seat count — already lives in the ride/tripFlow stores, and
  // the schedule screen seeds itself from them, so the only thing to do before
  // navigating is commit the seat stepper (Order Ride does this too; the
  // Schedule button used to skip it and drop the rider on an empty form).
  const handleSchedule = useCallback(() => {
    haptic.light();
    setRequestSeats(orderSeats, true);
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

  return (
    <View style={styles.overlay} pointerEvents="box-none">
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

        <Text style={styles.headerTitle}>Where To</Text>

        <View style={styles.headerSpacer} />
      </View>

      {/* The dismiss gesture is scoped to the CARD, not to `flex: 1`.
          Wrapping the whole stage meant the detector also owned every pan over
          the map behind it — so panning the map dismissed the surface (and,
          before the runOnJS fix in MorphBackSwipeDetector, crashed the app). */}
      <MorphBackSwipeDetector style={styles.swipeZone} onSwipeBack={handleClose}>
        <View>
          <MorphTarget id={activeMorphId} borderRadius={24} style={{ width: cardWidth }}>
            <View style={[styles.floatingCard, { width: cardWidth }]}>

              {/* ── Dual location rows + timeline ─────────────── */}
              <View style={styles.inputsSection}>
                <View style={styles.timeline}>
                  <View style={[styles.timelineDot, styles.timelineDotOrigin]} />
                  <View style={styles.timelineLine} />
                  <View style={[styles.timelineDot, styles.timelineDotDest]} />
                </View>

                <View style={[styles.inputsCol, { width: fieldColWidth }]}>
                  {/* Pickup. The row opens the map picker, but it now LOOKS like
                      a field again: a standing caption plus its value, so it is
                      obvious which half is pickup and which is destination
                      before you tap anything. */}
                  <Pressable
                    style={({ pressed }) => [styles.fieldRow, pressed && styles.fieldRowPressed]}
                    onPress={() => openMapPicker('origin')}
                    accessibilityRole="button"
                    accessibilityLabel="Set pickup location on map"
                  >
                    <Ionicons name="locate-outline" size={16} color={colors.outline} style={styles.inputIcon} />
                    <View style={styles.fieldTextCol}>
                      <Text style={styles.fieldLabel} numberOfLines={1}>PICKUP POINT</Text>
                      <Text
                        style={[styles.fieldValue, !originText && styles.fieldPlaceholder]}
                        numberOfLines={1}
                      >
                        {originText || 'Set your pickup point'}
                      </Text>
                    </View>
                    <Ionicons name="map-outline" size={16} color={colors.outline} />
                  </Pressable>

                  {/* Destination — same behaviour, so both fields are consistent. */}
                  <Pressable
                    style={({ pressed }) => [styles.fieldRow, styles.fieldRowDest, pressed && styles.fieldRowPressed]}
                    onPress={() => openMapPicker('dest')}
                    accessibilityRole="button"
                    accessibilityLabel="Choose destination on map"
                  >
                    <Ionicons name="search-outline" size={16} color={colors.primary} style={styles.inputIcon} />
                    <View style={styles.fieldTextCol}>
                      <Text style={[styles.fieldLabel, styles.fieldLabelDest]} numberOfLines={1}>DESTINATION</Text>
                      <Text
                        style={[styles.fieldValue, !selectedPlace && styles.fieldPlaceholder]}
                        numberOfLines={1}
                      >
                        {selectedPlace?.name ?? 'Where are you going?'}
                      </Text>
                    </View>
                    <Ionicons name="map-outline" size={16} color={colors.primary} />
                  </Pressable>
                </View>

                {/* Swap — only meaningful once both ends are known. */}
                <Pressable
                  style={[styles.swapBtn, (!selectedPlace || !origin) && styles.swapBtnDisabled]}
                  onPress={handleSwap}
                  disabled={!selectedPlace || !origin}
                  accessibilityRole="button"
                  accessibilityLabel="Swap pickup and destination"
                >
                  <Ionicons name="swap-vertical-outline" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
              </View>

              {/* Seats + CTAs, once a destination is confirmed */}
              {selectedPlace && (
                <>
                  <View style={[styles.divider, { marginTop: 12 }]} />
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
                        onPress={() => setOrderSeats((n) => Math.min(8, n + 1))}
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
    </View>
  );
}

// Memoized so the outgoing stage stays static during trip.tsx crossfades.
export const SearchStage = React.memo(SearchStageImpl);

const makeStyles = (colors: Colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
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

  cardWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  /** Dismiss-gesture area: exactly the card's box. `flex: 0` is required —
   *  MorphBackSwipeDetector defaults its wrapper to `flex: 1`, which would hand
   *  the detector every pan over the map below the card. */
  swipeZone: {
    flex: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // ─── Floating Card (glass panel) ─────────────────────
  floatingCard: {
    backgroundColor: withOpacity(colors.surfaceCard, 0.92),
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.rimLight,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 14,
  },

  // ─── Dual rows + timeline ────────────────────────────
  inputsSection: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  timeline: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    gap: 0,
    width: 12,
    flexShrink: 0,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    flexShrink: 0,
  },
  timelineDotOrigin: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceVariant,
  },
  timelineDotDest: {
    backgroundColor: colors.primary,
  },
  timelineLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  inputsCol: {
    // Width is supplied inline from `fieldColWidth`; `flex: 1` is kept only as a
    // belt-and-braces fallback and must never be the sole source of width here
    // (see the fieldColWidth note above).
    flex: 1,
    gap: 8,
  },
  // Static rims instead of the rotating gradient rings that used to live here —
  // see the performance note at the top of this file.
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    // Taller than the old 48 — the row now carries a caption above its value.
    minHeight: 56,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLight,
    backgroundColor: colors.surfaceInput,
  },
  fieldRowDest: {
    borderColor: withOpacity(colors.primary, 0.55),
  },
  fieldRowPressed: { opacity: 0.72 },
  inputIcon: { flexShrink: 0 },
  fieldTextCol: {
    flex: 1,
    // Without this a long address forces the column wider than its share and
    // pushes the trailing map glyph off the row.
    minWidth: 0,
    gap: 1,
  },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: 0.8,
    color: withOpacity(colors.onSurfaceVariant, 0.75),
  },
  fieldLabelDest: {
    color: withOpacity(colors.primary, 0.9),
  },
  fieldValue: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  fieldPlaceholder: {
    color: withOpacity(colors.onSurfaceVariant, 0.65),
  },
  swapBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },
  swapBtnDisabled: { opacity: 0.4 },

  divider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginVertical: 14,
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
    color: colors.onPrimary,
  },
  ctaSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 28, paddingVertical: 14, borderWidth: 1.5, borderColor: colors.primary,
  },
  ctaSecondaryText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.primary,
  },
});
