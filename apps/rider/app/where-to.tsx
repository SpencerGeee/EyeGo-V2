import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, fontSizes, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import MapboxGL from '../utils/mapbox';

const FREE_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const QUICK_DESTINATIONS = [
  { id: '1', name: 'Home', address: 'Your home address', icon: 'home-outline' as const },
  { id: '2', name: 'Work', address: 'Your work address', icon: 'briefcase-outline' as const },
  { id: '3', name: 'Kotoka International Airport', address: 'Airport Rd, Accra', icon: 'airplane-outline' as const },
  { id: '4', name: 'Accra Mall', address: 'Tetteh Quarshie Interchange, Accra', icon: 'storefront-outline' as const },
];

export default function WhereToScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tier, destination: prefilledDest } = useLocalSearchParams<{ tier?: string; destination?: string; type?: string }>();

  const [query, setQuery] = useState(prefilledDest ?? '');
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const cameraRef = useRef<any>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserCoords([loc.coords.longitude, loc.coords.latitude]);
        }
      } catch { /* non-fatal */ }
    })();
  }, []);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleSelectDestination = (dest: typeof QUICK_DESTINATIONS[0]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Navigate to ride selection with destination
    router.push({
      pathname: '/ride/select',
      params: { destination: dest.name, tier: tier ?? 'economy' },
    } as any);
  };

  return (
    <View style={styles.root}>
      {/* Map fills the screen */}
      <MapboxGL.MapView
        style={StyleSheet.absoluteFill}
        styleURL={FREE_MAP_STYLE}
        compassEnabled={false}
        rotateEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
      >
        {userCoords && (
          <MapboxGL.Camera
            ref={cameraRef}
            centerCoordinate={userCoords}
            zoomLevel={14}
            animationMode="flyTo"
            animationDuration={800}
          />
        )}
        {userCoords && (
          <MapboxGL.UserLocation visible={true} />
        )}
      </MapboxGL.MapView>

      {/* Top search bar overlay */}
      <SafeAreaView style={styles.topOverlay} edges={['top']}>
        <View style={styles.searchBar}>
          <Pressable onPress={handleClose} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.inputWrap}>
            <Ionicons name="search-outline" size={16} color="rgba(255,255,255,0.5)" style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Search destination..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.4)" />
              </Pressable>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom sheet with quick destinations */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomSheet}
      >
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Quick destinations</Text>
        {QUICK_DESTINATIONS.map((dest) => (
          <Pressable
            key={dest.id}
            style={({ pressed }) => [styles.destRow, pressed && { opacity: 0.7 }]}
            onPress={() => handleSelectDestination(dest)}
          >
            <View style={styles.destIcon}>
              <Ionicons name={dest.icon} size={18} color={colors.primary} />
            </View>
            <View style={styles.destInfo}>
              <Text style={styles.destName}>{dest.name}</Text>
              <Text style={styles.destAddress} numberOfLines={1}>{dest.address}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" />
          </Pressable>
        ))}
        <View style={{ height: insets.bottom + 16 }} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#091009',
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(9,16,9,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(9,16,9,0.90)',
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    height: 44,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  searchIcon: { flexShrink: 0 },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: '#fff',
    height: '100%',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10,14,10,0.96)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodySmall,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  destIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destInfo: { flex: 1 },
  destName: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: '#fff',
  },
  destAddress: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
});
