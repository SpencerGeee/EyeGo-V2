import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  Linking,
  Alert,
  Platform,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, userApi, socketEvents, connectSocket, disconnectSocket } from '@eyego/api';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../../stores/auth.store';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text } from '@eyego/ui';

export default function SOSScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { driverLocation } = useRideStore();

  const [alertSent, setAlertSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passengerLocation, setPassengerLocation] = useState<Location.LocationObject | null>(null);
  const [shareTripStatus, setShareTripStatus] = useState(false);
  const [rideCheckActive, setRideCheckActive] = useState(false);
  const [nightSafetyActive, setNightSafetyActive] = useState(false);
  const rideCheckAnsweredRef = useRef(true);
  const rideCheckEscalateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // JS timers are throttled/frozen while backgrounded (especially iOS), so a
  // plain setTimeout can silently never fire — exactly the distraction/coercion
  // scenario this escalation exists to catch. Track the real deadline and
  // re-check it on foreground resume as a backstop.
  const rideCheckDeadlineRef = useRef<number | null>(null);

  // Initialize RideCheck from the rider's actually-saved preference (profile/safety.tsx)
  // instead of always defaulting off — previously this reset to off on every mount
  // regardless of what the rider had saved, so the persisted setting was functionally
  // inert.
  useEffect(() => {
    userApi.getSafetySettings()
      .then((res: any) => {
        const settings = res?.data?.data?.settings;
        if (typeof settings?.rideCheck === 'boolean') setRideCheckActive(settings.rideCheck);
        if (typeof settings?.nightSafety === 'boolean') setNightSafetyActive(settings.nightSafety);
      })
      .catch(async () => {
        // Server unreachable — fall back to the safety screen's local cache so
        // saved protections don't silently arrive switched OFF during an
        // active trip (the worst possible moment for them to be off).
        try {
          const raw = await AsyncStorage.getItem('eyego_safety_settings');
          if (raw) {
            const cached = JSON.parse(raw);
            if (typeof cached?.rideCheck === 'boolean') setRideCheckActive(cached.rideCheck);
            if (typeof cached?.nightSafety === 'boolean') setNightSafetyActive(cached.nightSafety);
          }
        } catch {
          // no cache either — defaults stay off, switches remain visible
        }
      });
  }, []);
  // Ref keeps the latest location for the stream interval (avoids stale closure over `initial`)
  const locationRef = useRef<Location.LocationObject | null>(null);

  // Emergency contact: read from the synced EmergencyContact[] relation (what the
  // emergency-contacts screen now writes). Falls back to the legacy singular
  // user.emergencyContact for older accounts. Previously SOS only read the legacy
  // field, so contacts saved via the new screen never reached SOS.
  const { data: emergencyContacts } = useQuery({
    queryKey: ['user', 'emergency-contacts'],
    queryFn: () => userApi.getEmergencyContacts(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.contacts ?? r.data?.data ?? [],
    staleTime: 60_000,
  });
  const contactsList: { phone?: string; name?: string }[] = Array.isArray(emergencyContacts)
    ? emergencyContacts
    : [];
  const emergencyContact: { phone?: string; name?: string } | undefined =
    contactsList.length > 0
      ? contactsList[0]
      : (user as { emergencyContact?: { phone?: string; name?: string } })?.emergencyContact;

  KeepAwake.useKeepAwake();

  // Active Location Tracking on Mount — stream to backend via socket
  useEffect(() => {
    let locationWatcher: Location.LocationSubscription | null = null;
    let streamInterval: ReturnType<typeof setInterval> | null = null;

    async function startTracking() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          // On the SOS screen a silent console.warn is not enough — the rider
          // needs to know alerts will go out without their live position.
          Alert.alert(
            'Location Is Off',
            "Without location access, SOS alerts can't include your live position — responders will only see the driver's last reported location. You can still trigger SOS.",
            [
              { text: 'Not Now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
            ]
          );
          return;
        }

        // Get initial position quickly
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setPassengerLocation(initial);
        locationRef.current = initial;

        // Request background location on iOS so tracking continues when app is backgrounded
        if (Platform.OS === 'ios') {
          const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
          if (bgStatus !== 'granted') {
            console.warn('[SOS] Background location denied — streaming may pause when app is backgrounded.');
          }
        }

        // Start watching for real-time fine position changes
        locationWatcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 3000,
            distanceInterval: 5,
          },
          (newLocation) => {
            setPassengerLocation(newLocation);
            locationRef.current = newLocation;
          }
        );

        // Stream location to backend every 10 seconds for safety monitoring.
        // Uses locationRef.current so the interval always sends the latest coords,
        // not the stale `initial` value captured at creation time.
        connectSocket();
        streamInterval = setInterval(() => {
          const loc = locationRef.current;
          if (loc && id) {
            socketEvents.sendSafetyLocation?.({
              tripId: id,
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
          }
        }, 10000);
      } catch (err) {
        console.error('[SOS] Geolocation error:', err);
      }
    }

    startTracking();

    return () => {
      if (locationWatcher) {
        locationWatcher.remove();
      }
      if (streamInterval) {
        clearInterval(streamInterval);
      }
      disconnectSocket();
    };
  }, [id]);

  // Use user's active fine location if available, otherwise fallback to driver's coordinate
  const currentCoords = passengerLocation?.coords
    ? { latitude: passengerLocation.coords.latitude, longitude: passengerLocation.coords.longitude }
    : driverLocation
    ? { latitude: driverLocation.latitude, longitude: driverLocation.longitude }
    : null;

  const coordsString = currentCoords
    ? `${currentCoords.latitude.toFixed(5)}, ${currentCoords.longitude.toFixed(5)}`
    : 'Location unavailable';

  const handleSOSPress = async () => {
    if (alertSent || loading) return;
    // Heavy vibration — confirms the SOS was triggered
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    try {
      setLoading(true);

      const sosData = {
        tripId: id,
        latitude: currentCoords?.latitude,
        longitude: currentCoords?.longitude,
        passengerPhone: user?.phone,
        timestamp: new Date().toISOString(),
        // Send emergency contact info so backend can SMS them
        emergencyContactName: emergencyContact?.name ?? undefined,
        emergencyContactPhone: emergencyContact?.phone ?? undefined,
      };

      // Attempt to broadcast emergency signal to backend API gateway
      if (id && currentCoords) {
        await apiClient.post(`/trips/${id}/emergency`, sosData).catch(async (err) => {
          // Log warning but allow SMS fallbacks to execute
          console.warn('[SOS] Backend notification failed, executing local fail-safe protocols.', err);

          // Enqueue critical action for background/offline sync!
          try {
            const { offlineQueue } = require('../../../utils/offlineQueue');
            await offlineQueue.enqueue('SOS', `/trips/${id}/emergency`, 'POST', sosData);
          } catch (queueErr) {
            console.error('[SOS] Failed to enqueue offline sync:', queueErr);
          }
        });
      }

      setAlertSent(true);

      // Open the SMS composer to the emergency contact. The backend already
      // SMSes them server-side via /trips/:id/emergency, so this is a direct
      // personal follow-up — NOT the only delivery path. Deliberately no
      // simultaneous tel: here: firing tel: right after sms: cancels the
      // composer before the rider can send.
      if (emergencyContact?.phone) {
        const msg = encodeURIComponent(
          `🚨 EMERGENCY: ${user?.name ?? 'An EyeGo rider'} has triggered an SOS alert. ` +
          `Trip ID: ${id}. Location: https://maps.google.com/?q=${currentCoords?.latitude ?? 0},${currentCoords?.longitude ?? 0}. Please contact them immediately.`
        );
        Linking.openURL(`sms:${emergencyContact.phone}?body=${msg}`).catch(() => {});
      }
    } catch (err) {
      Alert.alert('Error', 'Could not send alert. Please call emergency services directly.');
    } finally {
      setLoading(false);
    }
  };

  // Backstop for the RideCheck auto-escalation timer above: JS timers can be
  // frozen while the app is backgrounded and never fire. On foreground resume,
  // check the real deadline directly and escalate immediately if it's passed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const deadline = rideCheckDeadlineRef.current;
      if (deadline && !rideCheckAnsweredRef.current && Date.now() >= deadline) {
        rideCheckAnsweredRef.current = true;
        rideCheckDeadlineRef.current = null;
        if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
        handleSOSPress();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // RideCheck: monitor route deviations via socket.
  // The backend emits 'safety:check' { tripId, reason, timestamp } (driver.socket.js
  // emitSafetyCheck) — NOT 'safety:ride_check_alert', which nothing ever emits. We
  // listen to onSafetyCheck and derive a human message from the reason code.
  useEffect(() => {
    if (rideCheckActive && id) {
      connectSocket();
      const unsub = socketEvents.onSafetyCheck?.((data) => {
        // Only react to the current trip's safety checks.
        if (data?.tripId && data.tripId !== id) return;
        const reason = (data?.reason ?? '').toString().toLowerCase();
        const message =
          reason.includes('route') ? 'Your trip has deviated from the expected route. Are you safe?'
          : reason.includes('stop') ? 'Your driver has been stopped for a while. Is everything okay?'
          : 'A safety check was triggered on your trip. Are you safe?';

        // Auto-escalate to a real SOS if the rider doesn't respond at all — previously
        // an unanswered RideCheck (e.g. an incapacitated rider) triggered nothing further.
        rideCheckAnsweredRef.current = false;
        rideCheckDeadlineRef.current = Date.now() + 45_000;
        if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
        rideCheckEscalateTimerRef.current = setTimeout(() => {
          if (!rideCheckAnsweredRef.current) handleSOSPress();
        }, 45_000);

        Alert.alert(
          'RideCheck Alert',
          `${message}\n\nIf you don't respond within 45 seconds, SOS will trigger automatically.`,
          [
            { text: "I'm safe", style: 'default', onPress: () => {
              rideCheckAnsweredRef.current = true;
              rideCheckDeadlineRef.current = null;
              if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
            } },
            { text: 'Trigger SOS', style: 'destructive', onPress: () => {
              rideCheckAnsweredRef.current = true;
              rideCheckDeadlineRef.current = null;
              if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
              handleSOSPress();
            } },
          ],
          { cancelable: false },
        );
      });
      return () => { unsub?.(); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // handleSOSPress is a plain async function — adding it would cause infinite re-runs
  }, [rideCheckActive, id]);

  // Night Safety Check: periodic "are you OK?" prompt during night trips
  // (10pm-5am), independent of the backend-driven RideCheck event above.
  // Reuses the same answered/deadline/escalate refs — only one check-in can
  // realistically be pending at a time.
  useEffect(() => {
    if (!nightSafetyActive || !id) return;
    const NIGHT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
    const RESPONSE_WINDOW_MS = 60_000;
    const isNightHour = () => {
      const h = new Date().getHours();
      return h >= 22 || h < 5;
    };
    const fireCheckIn = () => {
      if (!isNightHour()) return;
      rideCheckAnsweredRef.current = false;
      rideCheckDeadlineRef.current = Date.now() + RESPONSE_WINDOW_MS;
      if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
      rideCheckEscalateTimerRef.current = setTimeout(() => {
        if (!rideCheckAnsweredRef.current) handleSOSPress();
      }, RESPONSE_WINDOW_MS);

      Alert.alert(
        'Night Safety Check',
        "Just checking in on your night trip. Everything OK?\n\nIf you don't respond within 60 seconds, SOS will trigger automatically.",
        [
          { text: "I'm OK", style: 'default', onPress: () => {
            rideCheckAnsweredRef.current = true;
            rideCheckDeadlineRef.current = null;
            if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
          } },
          { text: 'Trigger SOS', style: 'destructive', onPress: () => {
            rideCheckAnsweredRef.current = true;
            rideCheckDeadlineRef.current = null;
            if (rideCheckEscalateTimerRef.current) clearTimeout(rideCheckEscalateTimerRef.current);
            handleSOSPress();
          } },
        ],
        { cancelable: false },
      );
    };
    const interval = setInterval(fireCheckIn, NIGHT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nightSafetyActive, id]);

  const confirmEmergencyCall = () => {
    Alert.alert(
      'Emergency Call',
      'This will dispatch an SOS alert with your live location and place an emergency call. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call now',
          style: 'destructive',
          onPress: () => {
            handleSOSPress();
            Linking.openURL('tel:112').catch(() => {});
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Safety</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Reassurance card */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          style={styles.reassureCard}
        >
          <View style={styles.shieldCircle}>
            <Ionicons name="shield-checkmark" size={34} color={colors.primary} />
          </View>
          <Text style={styles.reassureTitle}>
            {alertSent ? 'Alert dispatched' : 'Your safety is our priority'}
          </Text>
          <Text style={styles.reassureSub}>
            {alertSent
              ? `Coordinates sent: ${coordsString}`
              : 'Your live location is being monitored throughout this trip.'}
          </Text>
        </MotiView>

        {/* Trip Protection */}
        <Text style={styles.sectionLabel}>Trip Protection</Text>
        <View style={styles.group}>
          <ProtectionRow
            colors={colors}
            icon="share-outline"
            title="Share Trip Status"
            subtitle="Share your live location with family"
            value={shareTripStatus}
            onValueChange={(v) => {
              if (v && !emergencyContact?.phone) {
                Alert.alert('No contact saved', 'Add a trusted contact to share your trip status.');
                return;
              }
              setShareTripStatus(v);
              // One-time SMS composer with the live-location link on enable.
              // Ongoing updates stream silently to the backend over the socket
              // (see startTracking above) — the previous 30-second loop that
              // yanked the rider into the SMS app repeatedly is gone.
              if (v && emergencyContact?.phone) {
                const loc = locationRef.current?.coords ?? currentCoords;
                const msg = encodeURIComponent(
                  `${user?.name ?? 'An EyeGo rider'} is sharing their EyeGo trip with you. ` +
                  `Live location: https://maps.google.com/?q=${loc?.latitude ?? 0},${loc?.longitude ?? 0}`
                );
                Linking.openURL(`sms:${emergencyContact.phone}?body=${msg}`).catch(() => {});
              }
            }}
          />
          <View style={styles.divider} />
          <ProtectionRow
            colors={colors}
            icon="medkit-outline"
            title="RideCheck"
            subtitle="Unexpected stops & route detection"
            value={rideCheckActive}
            onValueChange={setRideCheckActive}
          />
        </View>

        {/* Trusted Contacts */}
        <View style={styles.contactsHeader}>
          <Text style={styles.sectionLabel}>Trusted Contacts</Text>
          <Pressable onPress={() => router.push('/profile/emergency-contacts')} hitSlop={8}>
            <Text style={styles.manageLink}>Manage</Text>
          </Pressable>
        </View>
        <View style={styles.contactsGrid}>
          {contactsList.slice(0, 3).map((c, i) => (
            <View key={`${c.name ?? 'contact'}-${i}`} style={styles.contactCard}>
              <Pressable
                onPress={() => router.push('/profile/emergency-contacts')}
                style={styles.contactClose}
                hitSlop={8}
              >
                <Ionicons name="close" size={14} color={colors.onSurfaceVariant} />
              </Pressable>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactInitial}>
                  {(c.name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.contactName} numberOfLines={1}>
                {c.name ?? 'Contact'}
              </Text>
              <Text style={styles.contactPhone} numberOfLines={1}>
                {c.phone ?? ''}
              </Text>
            </View>
          ))}
          {contactsList.length < 3 && (
            <Pressable
              onPress={() => router.push('/profile/emergency-contacts')}
              style={styles.addCard}
            >
              <View style={styles.addIcon}>
                <Ionicons name="person-add-outline" size={22} color={colors.primary} />
              </View>
              <Text style={styles.addLabel}>Add Contact</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Fixed bottom emergency bar */}
      <View style={styles.emergencyBar}>
        <View style={styles.emergencyHeading}>
          <Ionicons name="warning" size={16} color={colors.statusError} />
          <Text style={styles.emergencyHeadingText}>In an emergency</Text>
        </View>
        <Text style={styles.emergencyHint}>
          Contact authorities directly. Your location will be shared with EyeGo safety.
        </Text>
        <Pressable
          onPress={confirmEmergencyCall}
          disabled={loading}
          style={({ pressed }) => [styles.emergencyButton, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Ionicons name="call" size={20} color={colors.statusError} />
          <Text style={styles.emergencyButtonText}>
            {alertSent ? 'Call 112' : 'Emergency Call'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ProtectionRow({
  colors,
  icon,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  colors: Colors;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.protRow}>
      <View style={[styles.protIcon, value && { backgroundColor: withOpacity(colors.primary, 0.12) }]}>
        <Ionicons name={icon} size={20} color={value ? colors.primary : colors.onSurfaceVariant} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.protTitle}>{title}</Text>
        <Text style={styles.protSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.outlineVariant, true: withOpacity(colors.primary, 0.6) }}
        thumbColor={value ? colors.primary : colors.onSurfaceVariant}
        ios_backgroundColor={colors.outlineVariant}
      />
    </View>
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
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleLarge,
    lineHeight: fontSizes.titleLarge * 1.3,
    color: colors.primary,
    letterSpacing: -0.3,
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.sm,
    paddingBottom: 200,
    gap: spacing.lg,
  },
  reassureCard: {
    alignItems: 'center',
    textAlign: 'center',
    backgroundColor: colors.surfaceCard,
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.1),
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  shieldCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.2),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  reassureTitle: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  reassureSub: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.outline,
    marginLeft: spacing.xs,
  },
  group: {
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: colors.rimLightSubtle,
    marginHorizontal: spacing.base,
  },
  protRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    padding: spacing.base,
  },
  protIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protTitle: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onSurface,
  },
  protSub: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  contactsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.xs,
  },
  manageLink: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.3),
    color: colors.primary,
  },
  contactsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.base,
  },
  contactCard: {
    width: '47%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
    position: 'relative',
  },
  contactClose: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: 2,
  },
  contactAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: withOpacity(colors.primary, 0.12),
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInitial: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.primary,
  },
  contactName: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.onSurface,
  },
  contactPhone: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 14,
    color: colors.onSurfaceVariant,
  },
  addCard: {
    width: '47%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.rimLight,
    paddingVertical: spacing.lg,
    minHeight: 132,
  },
  addIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.3),
    color: colors.primary,
  },
  emergencyBar: {
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
  emergencyHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emergencyHeadingText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.statusError,
  },
  emergencyHint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.base,
  },
  emergencyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.base + 2,
    borderRadius: radii.lg,
    backgroundColor: withOpacity(colors.statusError, 0.2),
    borderWidth: 1,
    borderColor: withOpacity(colors.statusError, 0.5),
  },
  emergencyButtonText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.titleSmall,
    lineHeight: fontSizes.titleSmall * 1.3,
    color: colors.statusError,
  },
});
