import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';

type Place = {
  id: string;
  name: string;
  address: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const DEFAULT_PLACES: Place[] = [
  { id: 'home', name: 'Home', address: 'Add home address', icon: 'home-outline' },
  { id: 'work', name: 'Work', address: 'Add work address', icon: 'briefcase-outline' },
];

export default function SavedPlacesScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>(DEFAULT_PLACES);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{display_name: string; lat: string; lon: string}>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadPlaces();
  }, []);

  const loadPlaces = async () => {
    try {
      const stored = await AsyncStorage.getItem('@eyego_saved_places');
      if (stored) {
        setPlaces(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load places', e);
    }
  };

  const savePlaces = async (newPlaces: Place[]) => {
    try {
      await AsyncStorage.setItem('@eyego_saved_places', JSON.stringify(newPlaces));
      setPlaces(newPlaces);
    } catch (e) {
      console.error('Failed to save places', e);
    }
  };

  const searchAddress = async (query: string) => {
    setNewAddress(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.length < 3) { setAddressSuggestions([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=gh&limit=5&addressdetails=1`,
          { headers: { 'User-Agent': 'EyeGo/2.0 (eyego.app)' } }
        );
        const results = await res.json();
        setAddressSuggestions(results ?? []);
      } catch {
        setAddressSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const selectSuggestion = (s: {display_name: string; lat: string; lon: string}) => {
    setNewAddress(s.display_name);
    setAddressSuggestions([]);
  };

  const handleAddPlace = () => {
    if (!newName.trim() || !newAddress.trim()) return;
    
    if (editingId) {
      const updated = places.map(p =>
        p.id === editingId ? { ...p, name: newName, address: newAddress } : p
      );
      savePlaces(updated);
      setEditingId(null);
    } else {
      const newPlace: Place = {
        id: Date.now().toString(),
        name: newName,
        address: newAddress,
        icon: 'location-outline',
      };
      savePlaces([...places, newPlace]);
    }
    
    setNewName('');
    setNewAddress('');
    setIsAdding(false);
  };

  const handleRemovePlace = (id: string) => {
    if (id === 'home' || id === 'work') {
      // Just reset the address for default places
      const updated = places.map(p => p.id === id ? { ...p, address: `Add ${p.name.toLowerCase()} address` } : p);
      savePlaces(updated);
    } else {
      const updated = places.filter(p => p.id !== id);
      savePlaces(updated);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Saved Places</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <Text style={styles.sectionLabel}>FAVORITES</Text>
          
          <View style={styles.placesCard}>
            {places.map((place, index) => (
              <View key={place.id}>
                <View style={styles.placeRow}>
                  <View style={styles.placeIconContainer}>
                    <Ionicons name={place.icon} size={20} color={colors.primary} />
                  </View>
                  <Pressable
                    onPress={() => {
                      setIsAdding(true);
                      setEditingId(place.id);
                      setNewName(place.name);
                      setNewAddress(place.address.startsWith('Add ') ? '' : place.address);
                    }}
                    style={styles.placeInfo}
                  >
                    <Text variant="bodyMedium" color={colors.onSurface}>{place.name}</Text>
                    <Text variant="caption" style={{ color: colors.onSurfaceVariant }}>{place.address}</Text>
                  </Pressable>
                  <Pressable onPress={() => handleRemovePlace(place.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={18} color={colors.statusError} />
                  </Pressable>
                </View>
                {index < places.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          style={{ marginTop: spacing['2xl'] }}
        >
          {isAdding ? (
            <View style={styles.addCard}>
              <Text variant="titleSmall" style={{ marginBottom: spacing.md }}>
                {editingId ? 'Edit Place' : 'Add New Place'}
              </Text>
              
              <View style={styles.inputContainer}>
                <Text variant="label" color={colors.onSurfaceVariant} style={styles.inputLabel}>NAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Gym, Mom's House"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={newName}
                  onChangeText={setNewName}
                  editable={editingId !== 'home' && editingId !== 'work'}
                />
              </View>
              
              <View style={styles.inputContainer}>
                <Text variant="label" color={colors.onSurfaceVariant} style={styles.inputLabel}>ADDRESS</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter address"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={newAddress}
                  onChangeText={searchAddress}
                />
                {addressSuggestions.length > 0 && (
                  <View style={{ backgroundColor: colors.surfaceContainer, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.outlineVariant, marginTop: 4, maxHeight: 200, overflow: 'hidden' }}>
                    {addressSuggestions.map((s, i) => (
                      <Pressable key={i} onPress={() => selectSuggestion(s)} style={{ padding: spacing.base, borderBottomWidth: i < addressSuggestions.length - 1 ? 1 : 0, borderBottomColor: colors.outlineVariant, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Ionicons name="location-outline" size={16} color={colors.onSurfaceVariant} />
                        <Text variant="bodySmall" color={colors.onSurface} style={{ flex: 1 }} numberOfLines={2}>{s.display_name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {isSearching && (
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 4 }}>Searching...</Text>
                )}
              </View>
              
              <View style={styles.actionRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setIsAdding(false);
                    setEditingId(null);
                    setNewName('');
                    setNewAddress('');
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Save"
                  onPress={handleAddPlace}
                  disabled={!newName.trim() || !newAddress.trim()}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <Pressable style={styles.addBtn} onPress={() => {
              setIsAdding(true);
              setEditingId(null);
              setNewName('');
              setNewAddress('');
            }}>
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              <Text variant="bodyMedium" color={colors.primary}>Add a new place</Text>
            </Pressable>
          )}
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
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
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
    letterSpacing: 1.4,
    color: colors.outline,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  placesCard: {
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeInfo: {
    flex: 1,
    gap: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: spacing.base,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.base,
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    borderStyle: 'dashed',
    justifyContent: 'center',
  },
  addCard: {
    backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
    borderRadius: radii.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: '#0D0D0E',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
