import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, BackHandler, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { userApi, queryKeys, type SavedPlace } from '@eyego/api';
import { fonts, fontSizes, radii, withOpacity } from '@eyego/config';
import { Text, MorphTarget, useMorph, MorphBackSwipeDetector } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { useRideStore } from '../../../stores/ride.store';
import { useTripFlow, type SearchPlace } from '../../../stores/tripFlow.store';
import { useRecentPlaces } from '../../../stores/recentPlaces.store';
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

function SearchStageImpl() {
  const colors = useColors();
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

  const shortcutsVisible = !selectedPlace && (savedPlaces.length > 0 || recents.length > 0);

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
              <View style={[styles.inputsSection, { height: COL_H }]}>
                <View style={[styles.timeline, { height: COL_H }]}>
                  <View style={[styles.timelineDot, styles.timelineDotOrigin]} />
                  <View style={styles.timelineLine} />
                  <View style={[styles.timelineDot, styles.timelineDotDest]} />
                </View>

                <View style={[styles.inputsCol, { width: fieldColWidth, height: COL_H }]}>
                  {/* Pickup. Tapping ANY part of the row opens the fullscreen map
                      picker — that screen already owns search, the draggable pin
                      and reverse-geocoding, and handing the whole job to it is
                      both the nicer interaction and the reason this card can stay
                      keyboard-free during the morph (see the note at the top of
                      this file). */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.fieldRow,
                      { width: fieldColWidth },
                      pressed && styles.fieldRowPressed,
                    ]}
                    onPress={() => openMapPicker('origin')}
                    accessibilityRole="button"
                    accessibilityLabel="Set pickup location"
                  >
                    <View style={[styles.fieldTextCol, { width: fieldTextWidth }]}>
                      <Text style={styles.fieldLabel} numberOfLines={1}>PICKUP</Text>
                      <Text
                        style={[styles.fieldValue, !originText && styles.fieldPlaceholder]}
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

                  {/* Destination — identical behaviour, so both halves of the card
                      work the same way. */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.fieldRow,
                      styles.fieldRowDest,
                      { width: fieldColWidth },
                      pressed && styles.fieldRowPressed,
                    ]}
                    onPress={() => openMapPicker('dest')}
                    accessibilityRole="button"
                    accessibilityLabel="Choose destination"
                  >
                    <View style={[styles.fieldTextCol, { width: fieldTextWidth }]}>
                      <Text style={[styles.fieldLabel, styles.fieldLabelDest]} numberOfLines={1}>WHERE TO</Text>
                      <Text
                        style={[styles.fieldValue, !destText && styles.fieldPlaceholder]}
                        numberOfLines={1}
                      >
                        {destText || 'Search a place or address'}
                      </Text>
                    </View>
                    <Ionicons name="search" size={FIELD_TRAIL_W} color={colors.primary} />
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
                  <Ionicons name="swap-vertical" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
              </View>

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

      {/* ── Shortcuts: what fills the space under the card ─────────────────
          Same width and inset as the card so the two read as one column.
          `box-none` on the wrapper keeps the map pannable in the gap below. */}
      {shortcutsVisible && (
        <View style={[styles.shortcuts, { width: cardWidth }]} pointerEvents="box-none">
          {savedPlaces.length > 0 && (
            <View style={styles.chipRow}>
              {savedPlaces.slice(0, 3).map((p) => (
                <Pressable
                  key={p.id}
                  style={({ pressed }) => [styles.chip, pressed && styles.rowPressed]}
                  onPress={() =>
                    commitPlace({
                      name: p.label,
                      fullAddress: p.address,
                      latitude: p.lat,
                      longitude: p.lng,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${p.label}`}
                >
                  <Ionicons name={savedIcon(p)} size={14} color={colors.primary} />
                  <Text style={styles.chipText} numberOfLines={1}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {recents.length > 0 && (
            <View style={styles.recentCard}>
              {recents.slice(0, 4).map((p, i) => (
                <Pressable
                  key={`${p.latitude},${p.longitude}`}
                  style={({ pressed }) => [styles.recentRow, pressed && styles.rowPressed]}
                  onPress={() => commitPlace(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${p.name}`}
                >
                  <View style={styles.recentIcon}>
                    <Ionicons name="time-outline" size={16} color={colors.onSurfaceVariant} />
                  </View>
                  <View style={styles.recentTextCol}>
                    <Text style={styles.recentName} numberOfLines={1}>{p.name}</Text>
                    {!!p.fullAddress && p.fullAddress !== p.name && (
                      <Text style={styles.recentAddress} numberOfLines={1}>{p.fullAddress}</Text>
                    )}
                  </View>
                  {i < Math.min(recents.length, 4) - 1 && <View style={styles.recentDivider} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
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
    backgroundColor: withOpacity(colors.surfaceCard, 0.94),
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.rimLight,
    // MUST equal CARD_PADDING — the field column width is derived from it.
    padding: CARD_PADDING,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 32,
    elevation: 14,
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

  // ─── Shortcuts under the card ─────────────────────────
  shortcuts: {
    marginTop: 14,
    marginHorizontal: CARD_H_MARGIN,
    gap: 10,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: withOpacity(colors.surfaceCard, 0.9),
    borderWidth: 1,
    borderColor: colors.rimLight,
    maxWidth: 140,
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurface,
  },
  recentCard: {
    borderRadius: 20,
    backgroundColor: withOpacity(colors.surfaceCard, 0.9),
    borderWidth: 1,
    borderColor: colors.rimLight,
    overflow: 'hidden',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 58,
    paddingHorizontal: 14,
  },
  rowPressed: { opacity: 0.65 },
  recentIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  recentTextCol: {
    // No `flex: 1` anywhere in this file — see the layout contract. The row is
    // a fixed height and the text simply truncates.
    minWidth: 0,
    gap: 1,
    maxWidth: 240,
  },
  recentName: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  recentAddress: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: withOpacity(colors.onSurfaceVariant, 0.75),
  },
  recentDivider: {
    position: 'absolute',
    left: 58, right: 0, bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.rimLightSubtle,
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
