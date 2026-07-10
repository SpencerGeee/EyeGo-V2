import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi, queryKeys, type SavedPlace } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';
import { Text, Button, GlowSearchInput, AppBackground, backgroundScrollPauseProps } from '@eyego/ui';
import { searchPlaces, type GeocodeResult } from '../../utils/geocoding';
import { consumePickedPlace } from '../../utils/placePickerResult';
import { useToastStore } from '../../stores/toast.store';

const LEGACY_KEY = '@eyego_saved_places';

const ICON_FOR_LABEL = (label: string): string => {
  const l = label.toLowerCase();
  if (l === 'home') return 'home-outline';
  if (l === 'work') return 'briefcase-outline';
  return 'location-outline';
};

export default function SavedPlacesScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCoords, setNewCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.user.savedPlaces,
    queryFn: async () => {
      await migrateLegacyPlaces();
      const res = await userApi.getSavedPlaces();
      return res.data?.data?.places ?? [];
    },
  });
  const places = data ?? [];

  // One-time migration of pre-backend AsyncStorage places. Old entries have
  // no coordinates, so each is forward-geocoded once; unresolvable ones are
  // dropped (they were free-text anyway).
  const migrateLegacyPlaces = async () => {
    try {
      const stored = await AsyncStorage.getItem(LEGACY_KEY);
      if (!stored) return;
      const legacy: { name: string; address: string }[] = JSON.parse(stored);
      for (const p of legacy) {
        if (!p.address || p.address.startsWith('Add ')) continue;
        try {
          const results = await searchPlaces(p.address, 1);
          if (results[0]) {
            await userApi.createSavedPlace({
              label: p.name,
              address: results[0].fullAddress,
              lat: results[0].latitude,
              lng: results[0].longitude,
              icon: ICON_FOR_LABEL(p.name),
            });
          }
        } catch { /* skip unresolvable entry */ }
      }
      await AsyncStorage.removeItem(LEGACY_KEY);
    } catch { /* non-fatal */ }
  };

  const createMutation = useMutation({
    mutationFn: (place: Omit<SavedPlace, 'id'>) => userApi.createSavedPlace(place),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.savedPlaces });
      resetForm();
      showToast('Place saved', 'success');
    },
    onError: () => showToast('Could not save place', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (placeId: string) => userApi.deleteSavedPlace(placeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.savedPlaces }),
    onError: () => showToast('Could not remove place', 'error'),
  });

  // Consume a location confirmed on the map picker screen
  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedPlace();
      if (picked) {
        setIsAdding(true);
        setNewAddress(picked.fullAddress);
        setNewCoords({ lat: picked.latitude, lng: picked.longitude });
        setSuggestions([]);
        if (!newName.trim() && picked.name !== 'Dropped pin') setNewName(picked.name);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const resetForm = () => {
    setIsAdding(false);
    setNewName('');
    setNewAddress('');
    setNewCoords(null);
    setSuggestions([]);
  };

  const searchAddress = (query: string) => {
    setNewAddress(query);
    setNewCoords(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.length < 3) { setSuggestions([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        setSuggestions(await searchPlaces(query, 5));
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const selectSuggestion = (s: GeocodeResult) => {
    setNewAddress(s.fullAddress);
    setNewCoords({ lat: s.latitude, lng: s.longitude });
    setSuggestions([]);
  };

  const handleSave = () => {
    if (!newName.trim() || !newAddress.trim() || !newCoords) return;
    createMutation.mutate({
      label: newName.trim(),
      address: newAddress.trim(),
      lat: newCoords.lat,
      lng: newCoords.lng,
      icon: ICON_FOR_LABEL(newName),
    });
  };

  const hasLabel = (label: string) => places.some((p) => p.label.toLowerCase() === label);

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" isDark={isDark} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Saved Places</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        {...backgroundScrollPauseProps}
      >
        <Text variant="labelCaps" style={styles.sectionLabel}>FAVORITES</Text>

        <View style={styles.placesCard}>
          {isLoading ? (
            <View style={{ padding: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              {/* Home/Work placeholders when not yet saved */}
              {(['Home', 'Work'] as const).filter((l) => !hasLabel(l.toLowerCase())).map((label) => (
                <View key={label}>
                  <Pressable
                    style={styles.placeRow}
                    onPress={() => {
                      setIsAdding(true);
                      setNewName(label);
                      setNewAddress('');
                      setNewCoords(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${label} address`}
                  >
                    <View style={styles.placeIconContainer}>
                      <Ionicons name={ICON_FOR_LABEL(label) as any} size={20} color={colors.primary} />
                    </View>
                    <View style={styles.placeInfo}>
                      <Text variant="bodyMedium" color={colors.onSurface}>{label}</Text>
                      <Text variant="caption" style={{ color: colors.onSurfaceVariant }}>Add {label.toLowerCase()} address</Text>
                    </View>
                    <Ionicons name="add" size={18} color={colors.onSurfaceVariant} />
                  </Pressable>
                  <View style={styles.divider} />
                </View>
              ))}

              {places.map((place, index) => (
                <View key={place.id}>
                  <View style={styles.placeRow}>
                    <View style={styles.placeIconContainer}>
                      <Ionicons name={(place.icon ?? 'location-outline') as any} size={20} color={colors.primary} />
                    </View>
                    <View style={styles.placeInfo}>
                      <Text variant="bodyMedium" color={colors.onSurface}>{place.label}</Text>
                      <Text variant="caption" style={{ color: colors.onSurfaceVariant }} numberOfLines={1}>{place.address}</Text>
                    </View>
                    <Pressable
                      onPress={() => deleteMutation.mutate(place.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${place.label}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.statusError} />
                    </Pressable>
                  </View>
                  {index < places.length - 1 && <View style={styles.divider} />}
                </View>
              ))}

              {places.length === 0 && hasLabel('home') && null}
            </>
          )}
        </View>

        <View style={{ marginTop: spacing['2xl'] }}>
          {isAdding ? (
            <View style={styles.addCard}>
              <Text variant="titleSmall" style={{ marginBottom: spacing.md }}>Add New Place</Text>

              <View style={styles.inputContainer}>
                <Text variant="label" color={colors.onSurfaceVariant} style={styles.inputLabel}>NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Home, Gym, Mom's House"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={newName}
                  onChangeText={setNewName}
                />
              </View>

              <View style={styles.inputContainer}>
                <Text variant="label" color={colors.onSurfaceVariant} style={styles.inputLabel}>ADDRESS</Text>
                <GlowSearchInput
                  placeholder="Search address"
                  value={newAddress}
                  onChangeText={searchAddress}
                />
                {suggestions.length > 0 && (
                  <View style={styles.suggestBox}>
                    {suggestions.map((s, i) => (
                      <Pressable
                        key={s.placeId || i}
                        onPress={() => selectSuggestion(s)}
                        style={[styles.suggestRow, i < suggestions.length - 1 && styles.suggestRowBorder]}
                      >
                        <Ionicons name="location-outline" size={16} color={colors.onSurfaceVariant} />
                        <Text variant="bodySmall" color={colors.onSurface} style={{ flex: 1 }} numberOfLines={2}>{s.fullAddress}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {isSearching && (
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 4 }}>Searching...</Text>
                )}

                {/* Confirm the exact spot on the map */}
                <Pressable
                  style={styles.mapPickBtn}
                  onPress={() => router.push('/profile/place-picker' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Pick location on map"
                >
                  <Ionicons name="map-outline" size={18} color={colors.primary} />
                  <Text variant="bodyMedium" color={colors.primary}>
                    {newCoords ? 'Adjust on map' : 'Pick on map'}
                  </Text>
                  {newCoords && <Ionicons name="checkmark-circle" size={16} color={colors.primary} />}
                </Pressable>
                {!newCoords && newAddress.length > 0 && suggestions.length === 0 && !isSearching && (
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 4 }}>
                    Select a suggestion or confirm the spot on the map.
                  </Text>
                )}
              </View>

              <View style={styles.actionRow}>
                <Button label="Cancel" variant="secondary" onPress={resetForm} style={{ flex: 1 }} />
                <Button
                  label="Save"
                  onPress={handleSave}
                  loading={createMutation.isPending}
                  disabled={!newName.trim() || !newAddress.trim() || !newCoords}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <Pressable style={styles.addBtn} onPress={() => { setIsAdding(true); setNewName(''); setNewAddress(''); setNewCoords(null); }}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              <Text variant="bodyMedium" color={colors.primary}>Add a new place</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.4,
    color: colors.outline,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  placesCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    overflow: 'hidden',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  placeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: withOpacity(colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeInfo: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginHorizontal: spacing.base,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.base,
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.rimLight,
    borderStyle: 'dashed',
    justifyContent: 'center',
  },
  addCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceInput,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
  },
  suggestBox: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginTop: 4,
    maxHeight: 220,
    overflow: 'hidden',
  },
  suggestRow: {
    padding: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  suggestRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  mapPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: withOpacity(colors.primary, 0.4),
    backgroundColor: withOpacity(colors.primary, 0.08),
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
