import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
  Modal,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radii, fonts, fontSizes, withOpacity } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { apiClient, routesApi, tripsApi } from '@eyego/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';

// Route shape returned by routesApi.getAll (subset we render here).
interface ScheduleRoute {
  id: string;
  name?: string;
  originName?: string;
  destinationName?: string;
  price?: number;
  estimatedMinutes?: number;
}

function getMinDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  return d;
}

function formatDate(date: Date) {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ScheduleRideScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date>(getMinDate());
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(getMinDate());
  const [requestMode, setRequestMode] = useState(false);
  const [requestDest, setRequestDest] = useState('');
  const [search, setSearch] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Load available routes — the backend schedules against a routeId, not free
  // text. (Previously this screen posted { origin, destination } and the backend
  // rejected every request with 400 "routeId required".)
  const { data: routes, isLoading: routesLoading } = useQuery({
    queryKey: ['routes', 'all'],
    queryFn: routesApi.getAll,
    select: (r) => ((r.data as any)?.data ?? []) as ScheduleRoute[],
  });

  // Client-side filter for the search field — matches name / origin / destination.
  const filteredRoutes = useMemo(() => {
    if (!routes) return [];
    const q = search.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter((r) =>
      [r.name, r.originName, r.destinationName].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [routes, search]);

  const scheduleMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/trips/schedule', {
        routeId: selectedRouteId,
        scheduledAt: selectedDate.toISOString(),
        seatCount,
      }),
    onSuccess: () => {
      if (!mountedRef.current) return;
      router.replace('/(tabs)/activity' as any);
    },
    onError: (err: any) => {
      Alert.alert('Scheduling Failed', err?.message || 'Could not schedule your ride. Please try again.');
    },
  });

  const requestMutation = useMutation({
    mutationFn: () =>
      tripsApi.requestTrip({
        destination: requestDest.trim(),
        scheduledAt: selectedDate.toISOString(),
        seatCount,
      }),
    onSuccess: () => {
      if (!mountedRef.current) return;
      router.replace({
        pathname: '/ride/request',
        params: { destination: requestDest.trim(), scheduledAt: selectedDate.toISOString() },
      } as any);
    },
    onError: (err: any) => {
      Alert.alert('Request Failed', err?.message || 'Could not submit your trip request. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (requestMode) {
      if (!requestDest.trim()) {
        Alert.alert('Enter a Destination', 'Please type where you want to go.');
        return;
      }
      const minDate = getMinDate();
      if (selectedDate < minDate) {
        Alert.alert('Invalid Time', 'Scheduled time must be at least 30 minutes from now.');
        return;
      }
      requestMutation.mutate();
      return;
    }
    if (!selectedRouteId) {
      Alert.alert('Select a Route', 'Please choose a route to schedule.');
      return;
    }
    const minDate = getMinDate();
    if (selectedDate < minDate) {
      Alert.alert(
        'Invalid Time',
        'Scheduled time must be at least 30 minutes from now.',
      );
      return;
    }
    scheduleMutation.mutate();
  };

  const handleDateChange = (_: any, date?: Date) => {
    if (date) {
      setTempDate(date);
      if (Platform.OS === 'android') {
        setSelectedDate(date);
        setShowPicker(false);
      }
    } else if (Platform.OS === 'android') {
      setShowPicker(false);
    }
  };

  const handleConfirmDate = () => {
    setSelectedDate(tempDate);
    setShowPicker(false);
  };

  const isPending = scheduleMutation.isPending || requestMutation.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text variant="titleSmall" style={{ color: colors.onSurface }}>Schedule Ride</Text>
          <Text style={styles.stepLabel}>Step 1 of 2</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          {/* Mode toggle */}
          <View style={styles.modeRow}>
            <Text style={styles.sectionLabel}>{requestMode ? 'NEW DESTINATION' : 'CHOOSE A ROUTE'}</Text>
            <Pressable onPress={() => setRequestMode((m) => !m)} hitSlop={8}>
              <Text style={styles.modeToggle}>
                {requestMode ? '← Pick a route' : 'Request new destination'}
              </Text>
            </Pressable>
          </View>

          {requestMode ? (
            /* Free-text destination request */
            <View style={styles.searchBar}>
              <Ionicons name="navigate-outline" size={18} color={colors.primary} />
              <TextInput
                style={styles.searchInput}
                value={requestDest}
                onChangeText={setRequestDest}
                placeholder="e.g. Madina, Lapaz, Achimota…"
                placeholderTextColor={colors.outlineVariant}
                returnKeyType="done"
                autoCorrect={false}
              />
            </View>
          ) : (
            <>
              {/* Search */}
              <View style={styles.searchBar}>
                <Ionicons name="search" size={18} color={colors.outline} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search routes…"
                  placeholderTextColor={colors.outlineVariant}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.outline} />
                  </Pressable>
                )}
              </View>

              <Text style={[styles.sectionLabel, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                Popular Routes
              </Text>

              {routesLoading ? (
                <View style={styles.placeholderCard}>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>Loading routes…</Text>
                </View>
              ) : !routes || routes.length === 0 ? (
                <Pressable onPress={() => setRequestMode(true)} style={styles.requestPromptCard}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
                  <Text variant="bodySmall" style={{ color: colors.primary, flex: 1 }}>
                    No routes available yet. Tap to request a trip to your destination — we'll find a driver.
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                </Pressable>
              ) : filteredRoutes.length === 0 ? (
                <View style={styles.placeholderCard}>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    No routes match “{search}”.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {filteredRoutes.map((route) => {
                    const selected = route.id === selectedRouteId;
                    const origin = route.originName ?? route.name ?? 'Origin';
                    const dest = route.destinationName ?? 'Destination';
                    return (
                      <Pressable
                        key={route.id}
                        onPress={() => setSelectedRouteId(route.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={[styles.routeCard, selected && styles.routeCardSelected]}
                      >
                        {selected && (
                          <LinearGradient
                            colors={[withOpacity(colors.primary, 0.05), withOpacity(colors.surfaceCard, 0.8)]}
                            style={StyleSheet.absoluteFillObject}
                            pointerEvents="none"
                          />
                        )}
                        <View style={styles.routeBody}>
                          {/* Origin → destination timeline */}
                          <View style={styles.routeRow}>
                            <View style={[styles.originDot, selected && styles.originDotActive]} />
                            <Text
                              variant="bodyLarge"
                              numberOfLines={1}
                              style={{ color: selected ? colors.onSurface : colors.onSurfaceVariant, flex: 1 }}
                            >
                              {origin}
                            </Text>
                          </View>
                          <View style={styles.routeConnector} />
                          <View style={styles.routeRow}>
                            <Ionicons name="location" size={14} color={selected ? colors.primary : colors.outline} />
                            <Text
                              variant="bodyLarge"
                              numberOfLines={1}
                              style={{ color: selected ? colors.onSurface : colors.onSurfaceVariant, flex: 1 }}
                            >
                              {dest}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.routeMeta}>
                          {typeof route.price === 'number' ? (
                            <Text style={[styles.routePrice, { color: selected ? colors.primary : colors.onSurfaceVariant }]}>
                              ₵{route.price}
                            </Text>
                          ) : null}
                          <View style={styles.etaPill}>
                            <Text style={styles.etaText}>
                              {route.estimatedMinutes ? `Est. ${route.estimatedMinutes} min` : 'Est. ride'}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {/* Seats */}
          <Text style={[styles.sectionLabel, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            SEATS
          </Text>
          <View style={styles.fieldRow}>
            <Pressable
              onPress={() => setSeatCount((s) => Math.max(1, s - 1))}
              accessibilityRole="button"
              accessibilityLabel="Decrease seats"
              hitSlop={8}
            >
              <Ionicons name="remove-circle-outline" size={26} color={seatCount > 1 ? colors.primary : colors.outline} />
            </Pressable>
            <Text variant="bodyLarge" style={{ color: colors.onSurface, flex: 1, textAlign: 'center' }}>
              {seatCount} seat{seatCount > 1 ? 's' : ''}
            </Text>
            <Pressable
              onPress={() => setSeatCount((s) => Math.min(4, s + 1))}
              accessibilityRole="button"
              accessibilityLabel="Increase seats"
              hitSlop={8}
            >
              <Ionicons name="add-circle-outline" size={26} color={seatCount < 4 ? colors.primary : colors.outline} />
            </Pressable>
          </View>

          {/* Pickup Time */}
          <View style={[styles.modeRow, { marginTop: spacing.xl }]}>
            <Text style={styles.sectionLabel}>PICKUP TIME</Text>
            <View style={styles.noticePill}>
              <Ionicons name="information-circle-outline" size={13} color={colors.primary} />
              <Text style={styles.noticeText}>Min. 30m notice</Text>
            </View>
          </View>
          <Pressable
            onPress={() => {
              setTempDate(selectedDate);
              setShowPicker(true);
            }}
            style={({ pressed }) => [styles.fieldRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <Text variant="bodyLarge" style={{ color: colors.onSurface, flex: 1 }}>
              {formatDate(selectedDate)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        </MotiView>
      </ScrollView>

      {/* Fixed bottom confirm */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleSubmit}
          disabled={isPending}
          style={({ pressed }) => [
            styles.confirmBtn,
            isPending && { opacity: 0.5 },
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <Ionicons name="calendar" size={20} color={colors.onPrimary} />
          <Text style={styles.confirmText}>
            {requestMode
              ? (requestMutation.isPending ? 'Requesting…' : 'Request Trip')
              : (scheduleMutation.isPending ? 'Scheduling…' : 'Confirm Schedule')}
          </Text>
        </Pressable>
      </View>

      {/* iOS Modal Picker */}
      {Platform.OS === 'ios' && showPicker && (
        <Modal
          transparent
          animationType="slide"
          visible={showPicker}
          onRequestClose={() => setShowPicker(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { backgroundColor: colors.surfaceCard ?? colors.surfaceContainer }]}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text variant="bodyMedium" style={{ color: colors.statusError }}>Cancel</Text>
                </TouchableOpacity>
                <Text variant="titleSmall">Select Date & Time</Text>
                <TouchableOpacity onPress={handleConfirmDate}>
                  <Text variant="bodyMedium" style={{ color: colors.primary }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="datetime"
                display="spinner"
                minimumDate={getMinDate()}
                onChange={handleDateChange}
                textColor={colors.onSurface}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Android inline picker */}
      {Platform.OS === 'android' && showPicker && (
        <DateTimePicker
          value={tempDate}
          mode="datetime"
          display="default"
          minimumDate={getMinDate()}
          onChange={handleDateChange}
        />
      )}
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
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: `${colors.primary}B3`,
      marginTop: 2,
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.sm,
      paddingBottom: 140,
    },
    modeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 11,
      lineHeight: 15,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.outline,
    },
    modeToggle: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
      color: colors.primary,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      paddingHorizontal: spacing.base,
      height: 52,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyLarge,
      color: colors.onSurface,
      height: '100%',
    },
    placeholderCard: {
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      padding: spacing.lg,
      alignItems: 'center',
    },
    requestPromptCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.primary}10`,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: `${colors.primary}30`,
      padding: spacing.base,
    },
    routeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      padding: spacing.base,
      gap: spacing.base,
      overflow: 'hidden',
    },
    routeCardSelected: {
      borderColor: colors.primary,
      transform: [{ scale: 1.02 }],
    },
    routeBody: { flex: 1 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    originDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.outline,
    },
    originDotActive: {
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
    },
    routeConnector: {
      width: 2,
      height: 14,
      backgroundColor: colors.outlineVariant,
      marginLeft: 3,
      marginVertical: 2,
    },
    routeMeta: { alignItems: 'flex-end', gap: spacing.sm },
    routePrice: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleMedium,
      lineHeight: fontSizes.titleMedium * 1.3,
      letterSpacing: -0.3,
    },
    etaPill: {
      backgroundColor: `${colors.surfaceVariant ?? colors.outlineVariant}80`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    etaText: {
      fontFamily: fonts.monoRegular,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.4,
      color: colors.onSurfaceVariant,
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.rimLightSubtle,
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      padding: spacing.base,
      height: 56,
    },
    noticePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: `${colors.statusWarning}26`,
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    noticeText: {
      fontFamily: fonts.monoRegular,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.4,
      color: colors.statusWarning,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.surfaceCard,
      borderTopWidth: 1,
      borderTopColor: colors.rimLight,
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['2xl'],
    },
    confirmBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: radii.full,
      paddingVertical: spacing.base + 2,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 18,
    },
    confirmText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: fontSizes.titleSmall * 1.3,
      color: colors.onPrimary,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    modalSheet: {
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingBottom: spacing['3xl'],
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
  });
