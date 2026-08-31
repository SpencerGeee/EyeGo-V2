import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, TextInput, Alert, Image, ActivityIndicator } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mapReportsApi, type MapReportType } from '@eyego/api';
import { spacing, radii, fonts, fontSizes, withOpacity } from '@eyego/config';
import { Text, Pressable, Button, AppBackground, backgroundScrollPauseProps, GlowSearchInput, goDeeper, goBack } from '@eyego/ui';

import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';
import { useToastStore } from '../../stores/toast.store';
import { reverseGeocode, searchPlaces, type GeocodeResult } from '../../utils/geocoding';
import { consumePickedPlace } from '../../utils/placePickerResult';

/**
 * ONE FORM FOR SIX REPORT TYPES.
 *
 * The six kinds of map report share everything that matters — a location, a
 * name, some words, some photos — and differ only in a handful of structured
 * fields. Six screens would be five copies of the same location picker, the
 * same photo grid and the same submit path, drifting apart one bug fix at a
 * time. So: one screen, and the per-type fields come from the SERVER's schema
 * (`mapReportsApi.getSchema`), which is also what the server validates against.
 * Adding a seventh type is then a server change and a deploy.
 *
 * ── THE LOCATION IS THE REPORT ──────────────────────────────────────────────
 * Everything else is optional; a report with no coordinate is not actionable
 * and the server refuses one. So the screen opens by finding the rider, and the
 * pin is confirmable on the same map picker the saved-places screen uses.
 */

const TITLES: Record<MapReportType, { title: string; hint: string; notePrompt: string }> = {
  ADD_PLACE: {
    title: 'Add a place',
    hint: 'Drop the pin on the entrance, not the middle of the building — that is where a driver stops.',
    notePrompt: 'Anything else that helps us find it',
  },
  EDIT_PLACE: {
    title: 'Fix a place',
    hint: "Tell us what's wrong with it as it stands today.",
    notePrompt: "What's wrong with it?",
  },
  EDIT_ADDRESS: {
    title: 'Fix an address or pin',
    hint: 'Move the pin to where a car should actually stop.',
    notePrompt: 'What should it say instead?',
  },
  ADD_OBJECT: {
    title: 'Add something on the road',
    hint: 'Put the pin on the thing itself.',
    notePrompt: 'Describe it',
  },
  ROAD_ISSUE: {
    title: 'Report a road problem',
    hint: 'Put the pin where the problem starts.',
    notePrompt: "What's happening there?",
  },
  COMMENT: {
    title: 'Leave a comment',
    hint: 'Anything about the map around here.',
    notePrompt: 'What did you notice?',
  },
};

/** Human labels for the enum values the server accepts. */
const ENUM_LABELS: Record<string, string> = {
  // EDIT_PLACE.issue
  PERMANENTLY_CLOSED: 'Closed for good',
  TEMPORARILY_CLOSED: 'Closed for now',
  MOVED: 'It moved',
  WRONG_NAME: 'Wrong name',
  WRONG_CATEGORY: 'Wrong kind of place',
  // ADD_OBJECT.object
  ENTRANCE: 'Entrance',
  BARRIER: 'Barrier or gate',
  SPEED_BUMP: 'Speed bump',
  TRAFFIC_LIGHT: 'Traffic light',
  PARKING: 'Parking',
  STOP: 'Stop / station',
  PEDESTRIAN_CROSSING: 'Crossing',
  // ROAD_ISSUE.issue
  CLOSED: 'Road closed',
  ONE_WAY: 'One-way now',
  WRONG_DIRECTION: 'Routed the wrong way',
  FLOODED: 'Flooded',
  CONSTRUCTION: 'Under construction',
  POTHOLE: 'Bad potholes',
  NO_ENTRY: 'No entry',
  // ROAD_ISSUE.duration
  TEMPORARY: 'For now',
  PERMANENT: 'For good',
  UNKNOWN: 'Not sure',
  OTHER: 'Something else',
};

/** Human labels for the free-text payload fields. */
const FIELD_LABELS: Record<string, string> = {
  category: 'What kind of place',
  hours: 'Opening hours',
  phone: 'Phone number',
  correctName: 'Correct name',
  correctAddress: 'Correct address',
  issue: 'What is wrong',
  object: 'What is it',
  duration: 'How long',
};

export default function MapReportFormScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  /**
   * `prefillName/prefillLat/prefillLng` — arriving from a search that found nothing.
   *
   * The place picker now offers "Not seeing where you mean? Help us add it" on an
   * empty result set, and hands over what the rider had already told it: the
   * words they typed (which are the place's name) and the point they were
   * looking at. Landing on a blank form and re-typing both would waste the one
   * moment they were motivated to help.
   */
  const { type: rawType, prefillName, prefillLat, prefillLng } = useLocalSearchParams<{
    type: string;
    prefillName?: string;
    prefillLat?: string;
    prefillLng?: string;
  }>();
  const type = (rawType ?? 'COMMENT') as MapReportType;
  const copy = TITLES[type] ?? TITLES.COMMENT;

  const prefillCoords = React.useMemo(() => {
    const lat = Number(prefillLat);
    const lng = Number(prefillLng);
    return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
      ? { lat, lng }
      : null;
  }, [prefillLat, prefillLng]);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(prefillCoords);
  const [address, setAddress] = useState('');
  const [name, setName] = useState(prefillName ?? '');
  const [note, setNote] = useState('');
  /**
   * ── A PHOTO IS TWO THINGS AT ONCE ─────────────────────────────────────────
   *
   * `uri` is the local file, which is what the thumbnail can draw immediately.
   * `url` is the stored copy, which is the only thing worth putting in the
   * report — a `file://` path means nothing to the operator who opens it.
   *
   * They are held together rather than as two arrays because the gap between
   * them is the whole state a rider needs to see: picked but still uploading,
   * uploaded, or failed. An array of strings could not express "this one did
   * not go through", which is exactly the case that must not be silent.
   */
  const [photos, setPhotos] = useState<
    { uri: string; url: string | null; failed?: boolean }[]
  >([]);
  const [payload, setPayload] = useState<Record<string, string | number>>({});
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The per-type fields, from the server that validates them.
   *
   * Falls back to an empty shape rather than blocking: a rider who cannot reach
   * the schema endpoint can still file the location, the name and the note,
   * which is most of the value of any of these reports.
   */
  const { data: schema } = useQuery({
    queryKey: ['map-reports', 'schema'],
    queryFn: async () => (await mapReportsApi.getSchema()).data?.data ?? null,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const shape = schema?.payloadShapes?.[type] ?? null;
  const maxPhotos = schema?.maxPhotos ?? 4;

  /**
   * OPEN ON THE RIDER'S OWN POSITION.
   *
   * Almost every one of these reports is about somewhere the rider is standing
   * or has just been, so an empty map they have to find themselves on is a
   * screen most people close. A denied permission is not fatal — the search box
   * and the map picker both still work.
   */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setCoords((cur) => cur ?? { lat: pos.coords.latitude, lng: pos.coords.longitude });
        const place = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        if (!cancelled && place) {
          setAddress((cur) => cur || place.fullAddress);
        }
      } catch {
        // No fix available. The rider can still search or drop a pin.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A location confirmed on the shared map picker.
  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedPlace();
      if (picked) {
        setCoords({ lat: picked.latitude, lng: picked.longitude });
        setAddress(picked.fullAddress);
        setSuggestions([]);
      }
    }, []),
  );

  const searchAddress = (q: string) => {
    setAddress(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setSuggestions(await searchPlaces(q, 5, coords ? { latitude: coords.lat, longitude: coords.lng } : null));
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  /**
   * A photo of a sign settles most of these reports in one glance.
   *
   * ── UPLOADED THE MOMENT IT IS PICKED, NOT ON SUBMIT ──────────────────────
   *
   * The thumbnail appears immediately from the local file and the upload runs
   * behind it. Three things follow from that ordering, and they are the reason
   * for it:
   *
   *   - the report POST carries strings, so a photo that fails to upload cannot
   *     take the written report down with it. The words and the coordinate are
   *     the actionable part;
   *   - the rider finds out a photo did not go through WHILE THEY ARE STILL
   *     STANDING THERE and can take another. Discovering it at submit, or never,
   *     is the failure this shape exists to avoid;
   *   - Submit never has to block on the network twice.
   *
   * A failed photo stays on screen wearing its failure rather than vanishing —
   * tapping it retries.
   */
  const uploadOne = useCallback(
    async (uri: string) => {
      try {
        const url = await mapReportsApi.uploadPhoto(uri);
        setPhotos((p) => p.map((ph) => (ph.uri === uri ? { ...ph, url, failed: false } : ph)));
      } catch (err: any) {
        setPhotos((p) => p.map((ph) => (ph.uri === uri ? { ...ph, url: null, failed: true } : ph)));
        // A 503 is the server saying photo storage is not configured, which is
        // a different thing from a bad connection and is not the rider's to fix.
        const message =
          err?.response?.status === 503
            ? err?.response?.data?.message ?? 'Photos are unavailable right now — you can still send the report.'
            : "That photo didn't upload. Tap it to try again.";
        showToast(message, 'error');
      }
    },
    [showToast],
  );

  const addPhoto = async () => {
    if (photos.length >= maxPhotos) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos are off', 'Allow photo access to attach a picture, or send the report without one.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        // 0.6 against an 8 MB server cap: a modern phone's original is often
        // past that on its own, and nothing in this queue is read at full
        // resolution. The server caps the long edge at 1600 as well.
        quality: 0.6,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;
      // Drawn straight away from the local file; the URL arrives underneath it.
      setPhotos((p) => (p.length >= maxPhotos ? p : [...p, { uri, url: null }]));
      void uploadOne(uri);
    } catch {
      showToast('Could not open your photos', 'error');
    }
  };

  /** Photos still in flight — Submit waits for these rather than dropping them. */
  const uploading = photos.some((p) => p.url == null && !p.failed);

  const submit = useMutation({
    mutationFn: async () => {
      if (!coords) throw new Error('NO_LOCATION');
      return mapReportsApi.create({
        type,
        lat: coords.lat,
        lng: coords.lng,
        name: name.trim() || null,
        address: address.trim() || null,
        note: note.trim() || null,
        payload: Object.keys(payload).length > 0 ? payload : null,
        /**
         * Only the STORED copies. A `file://` path from this device means
         * nothing to the operator who opens the report, so a photo that failed
         * to upload is left behind rather than sent as a string that can never
         * resolve — and the rider was already told when it failed.
         *
         * `uploading` guards Submit, so in the ordinary case every photo here
         * already has its URL.
         */
        photos: photos.map((p) => p.url).filter((u): u is string => !!u),
      });
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ['map-reports', 'mine'] });
      showToast('Thanks — we will take a look.', 'success');
      goBack();
    },
    onError: (err: any) => {
      if (err?.message === 'NO_LOCATION') {
        Alert.alert('Where is it?', 'Pick the spot on the map first.');
        return;
      }
      const message = err?.response?.data?.message ?? 'Could not send that. Try again.';
      Alert.alert('Not sent', message);
    },
  });

  /**
   * Submit waits for photos in flight.
   *
   * Not because the report needs them — it does not, and a failed photo is
   * simply left behind — but because a rider who taps Send one second after
   * picking a picture would otherwise file a report without it and have no way
   * to tell. Waiting is a second; silently dropping it is the bug.
   */
  const canSubmit =
    !!coords && !uploading && (type !== 'COMMENT' || note.trim().length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" isDark={isDark} />

      <View style={styles.header}>
        <Pressable onPress={() => goBack()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>{copy.title}</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        {...backgroundScrollPauseProps}
      >
        <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.hint}>
          {copy.hint}
        </Text>

        {/* ── Where ── */}
        <Text variant="label" color={colors.onSurfaceVariant} style={styles.label}>WHERE</Text>
        {/**
         * THE TIP THAT MAKES THIS FIELD USABLE.
         *
         * The whole point of this screen is that the place is NOT on the map, so
         * telling the rider to search for it is telling them to search for the
         * thing they are here to add. What works is searching the nearest thing
         * that IS mapped — a junction, a school, a filling station — and walking
         * the pin from there, which is exactly how a Ghanaian address is given
         * out loud. Nothing said so, and the field read as a dead end.
         */}
        <View style={styles.tipRow}>
          <Ionicons name="bulb-outline" size={15} color={colors.primary} />
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
            Can’t find it? Search the nearest landmark — a junction, school or filling
            station — then use “{coords ? 'Adjust the pin' : 'Pick the spot on the map'}” to
            move the pin the last few metres.
          </Text>
        </View>
        <GlowSearchInput placeholder="Search an address or place" value={address} onChangeText={searchAddress} />
        {suggestions.length > 0 && (
          <View style={styles.suggestBox}>
            {suggestions.map((s, i) => (
              <Pressable
                key={s.placeId || i}
                onPress={() => {
                  setAddress(s.fullAddress);
                  setCoords({ lat: s.latitude, lng: s.longitude });
                  setSuggestions([]);
                }}
                style={[styles.suggestRow, i < suggestions.length - 1 && styles.suggestRowBorder]}
              >
                <Ionicons name="location-outline" size={16} color={colors.onSurfaceVariant} />
                <Text variant="bodySmall" color={colors.onSurface} style={{ flex: 1 }} numberOfLines={2}>
                  {s.fullAddress}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable
          style={styles.mapBtn}
          onPress={() =>
            goDeeper({
              pathname: '/profile/place-picker',
              params: {
                title: coords ? 'Adjust the pin' : 'Where is it?',
                // Seeded, so "adjust" starts from the pin the rider already set
                // rather than throwing it away and going back to GPS.
                ...(coords
                  ? {
                      initialLat: String(coords.lat),
                      initialLng: String(coords.lng),
                      initialLabel: name || address,
                      initialAddress: address,
                    }
                  : {}),
              },
            } as never)
          }
          accessibilityRole="button"
          accessibilityLabel="Pick the spot on the map"
        >
          <Ionicons name="map-outline" size={18} color={colors.primary} />
          <Text variant="bodyMedium" color={colors.primary}>
            {coords ? 'Adjust the pin' : 'Pick the spot on the map'}
          </Text>
          {coords && <Ionicons name="checkmark-circle" size={16} color={colors.primary} />}
        </Pressable>

        {/* ── Name, for the types that have one ── */}
        {type !== 'COMMENT' && type !== 'ROAD_ISSUE' && (
          <>
            <Text variant="label" color={colors.onSurfaceVariant} style={styles.label}>
              {type === 'ADD_PLACE' ? "WHAT'S IT CALLED" : 'PLACE NAME'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={type === 'ADD_PLACE' ? 'e.g. Melcom Adenta' : 'The name on the map now'}
              placeholderTextColor={colors.onSurfaceVariant}
              value={name}
              onChangeText={setName}
              maxLength={120}
            />
          </>
        )}

        {/* ── The type's own fields, from the server's schema ── */}
        {shape &&
          Object.entries(shape).map(([field, spec]) => {
            if (spec.type === 'enum' && Array.isArray(spec.values)) {
              return (
                <View key={field}>
                  <Text variant="label" color={colors.onSurfaceVariant} style={styles.label}>
                    {(FIELD_LABELS[field] ?? field).toUpperCase()}
                  </Text>
                  <View style={styles.chipWrap}>
                    {spec.values.map((value) => {
                      const active = payload[field] === value;
                      return (
                        <Pressable
                          key={value}
                          onPress={() => setPayload((p) => ({ ...p, [field]: value }))}
                          style={[
                            styles.chip,
                            {
                              borderColor: active ? colors.primary : colors.rimLight,
                              backgroundColor: active ? withOpacity(colors.primary, 0.14) : 'transparent',
                            },
                          ]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                        >
                          <Text
                            variant="bodySmall"
                            style={{ color: active ? colors.primary : colors.onSurfaceVariant }}
                          >
                            {ENUM_LABELS[value] ?? value}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            }
            // `correctedLat`/`correctedLng` are filled by the map picker, not typed.
            if (spec.type === 'number') return null;
            return (
              <View key={field}>
                <Text variant="label" color={colors.onSurfaceVariant} style={styles.label}>
                  {(FIELD_LABELS[field] ?? field).toUpperCase()}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={String(payload[field] ?? '')}
                  onChangeText={(v) => setPayload((p) => ({ ...p, [field]: v }))}
                  maxLength={spec.max ?? 120}
                />
              </View>
            );
          })}

        {/* ── The rider's own words ── */}
        <Text variant="label" color={colors.onSurfaceVariant} style={styles.label}>
          {copy.notePrompt.toUpperCase()}
        </Text>
        <TextInput
          style={[styles.input, styles.noteInput]}
          placeholder="Tell us what you saw"
          placeholderTextColor={colors.onSurfaceVariant}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={schema?.maxNoteLength ?? 1000}
        />

        {/* ── Photos ── */}
        <Text variant="label" color={colors.onSurfaceVariant} style={styles.label}>
          PHOTO (OPTIONAL)
        </Text>
        <View style={styles.photoRow}>
          {photos.map((p) => {
            const pending = p.url == null && !p.failed;
            return (
              <Pressable
                key={p.uri}
                style={styles.photo}
                // A failed photo is the only one worth tapping — it retries.
                onPress={p.failed ? () => uploadOne(p.uri) : undefined}
                accessibilityRole={p.failed ? 'button' : 'image'}
                accessibilityLabel={
                  pending ? 'Photo uploading' : p.failed ? 'Photo failed — tap to retry' : 'Attached photo'
                }
              >
                <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} />

                {/*
                  THE STATE OF THE UPLOAD, ON THE THUMBNAIL.

                  A picture that is on screen but has not reached the server is
                  the one case a rider must not mistake for done — they close
                  the app, and the photo they took was never anywhere. The scrim
                  dims it while in flight and turns red if it failed.
                */}
                {(pending || p.failed) && (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      styles.photoScrim,
                      p.failed && { backgroundColor: withOpacity(colors.statusError, 0.55) },
                    ]}
                  >
                    {pending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons name="refresh" size={18} color="#fff" />
                    )}
                  </View>
                )}

                <Pressable
                  onPress={() => setPhotos((all) => all.filter((x) => x.uri !== p.uri))}
                  style={styles.photoRemove}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <Ionicons name="close" size={13} color="#fff" />
                </Pressable>
              </Pressable>
            );
          })}
          {photos.length < maxPhotos && (
            <Pressable style={styles.photoAdd} onPress={addPhoto} accessibilityRole="button" accessibilityLabel="Add a photo">
              <Ionicons name="camera-outline" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          )}
        </View>

        <Button
          label={uploading ? 'Waiting for the photo…' : 'Send report'}
          onPress={() => submit.mutate()}
          loading={submit.isPending}
          disabled={!canSubmit}
          style={{ marginTop: spacing.xl }}
        />
        {!coords && (
          <Text variant="caption" color={colors.onSurfaceVariant} style={styles.footHint}>
            Pick where it is before sending.
          </Text>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { paddingHorizontal: spacing['2xl'], paddingBottom: spacing['4xl'] },
    hint: { lineHeight: 20, marginBottom: spacing.lg },
    label: { marginTop: spacing.lg, marginBottom: spacing.xs, letterSpacing: 0.8 },
    tipRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: withOpacity(colors.primary, 0.08),
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: withOpacity(colors.primary, 0.22),
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: colors.surfaceInput,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLight,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md,
      color: colors.onSurface,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
    },
    noteInput: { minHeight: 96, textAlignVertical: 'top' },
    suggestBox: {
      marginTop: spacing.xs,
      backgroundColor: colors.surfaceCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLight,
      overflow: 'hidden',
    },
    suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    suggestRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.rimLightSubtle },
    mapBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    photoRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    photo: {
      width: 72,
      height: 72,
      borderRadius: radii.lg,
      overflow: 'hidden',
      backgroundColor: colors.surfaceInput,
    },
    photoRemove: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    /** Dims a photo while it is in flight; red once it has failed. */
    photoScrim: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    photoAdd: {
      width: 72,
      height: 72,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footHint: { textAlign: 'center', marginTop: spacing.sm },
  });
