import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  TouchableOpacity,
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Saved Places</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            FAVORITES
          </Text>
          
          <View style={styles.placesCard}>
            {places.map((place, index) => (
              <View key={place.id}>
                <View style={styles.placeRow}>
                  <View style={styles.placeIconContainer}>
                    <Ionicons name={place.icon} size={20} color={colors.primary} />
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setIsAdding(true);
                      setEditingId(place.id);
                      setNewName(place.name);
                      setNewAddress(place.address.startsWith('Add ') ? '' : place.address);
                    }}
                    style={styles.placeInfo}
                    activeOpacity={0.7}
                  >
                    <Text variant="bodyMedium" color={colors.onSurface}>{place.name}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>{place.address}</Text>
                  </TouchableOpacity>
                  <Pressable onPress={() => handleRemovePlace(place.id)} hitSlop={10}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
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
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.base,
  },
  placesCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  placeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.base,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.base,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    justifyContent: 'center',
  },
  addCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    marginBottom: spacing.xs,
    letterSpacing: 1,
  },
  input: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
