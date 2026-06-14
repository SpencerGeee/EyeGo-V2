import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import { apiClient, bookingsApi, userApi, socketEvents, connectSocket, disconnectSocket } from '@eyego/api';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../../stores/auth.store';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
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
  const [audioRecording, setAudioRecording] = useState(false);
  const [rideCheckActive, setRideCheckActive] = useState(false);
  // Use a ref for the timer so cleanup always sees the latest handle (no stale closure)
  const autoAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const emergencyContact: { phone?: string; name?: string } | undefined =
    (Array.isArray(emergencyContacts) && emergencyContacts.length > 0)
      ? emergencyContacts[0]
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
          console.warn('[SOS] Foreground location permission denied.');
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

  // Auto-share current location to emergency contacts every 30 seconds after alert sent
  useEffect(() => {
    if (alertSent && passengerLocation?.coords) {
      const interval = setInterval(() => {
        if (emergencyContact?.phone && id) {
          const msg = encodeURIComponent(
            `🆘 SOS UPDATE: ${user?.name ?? 'EyeGo rider'} location at ${new Date().toLocaleTimeString()}. ` +
            `https://maps.google.com/?q=${passengerLocation.coords.latitude},${passengerLocation.coords.longitude}`
          );
          Linking.openURL(`sms:${emergencyContact.phone}?body=${msg}`);
        }
      }, 30000); // every 30 seconds
      return () => clearInterval(interval);
    }
  }, [alertSent, passengerLocation, user, id, emergencyContact]);

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

      // SMS the emergency contact if available
      if (emergencyContact?.phone) {
        const msg = encodeURIComponent(
          `🚨 EMERGENCY: ${user?.name ?? 'An EyeGo rider'} has triggered an SOS alert. ` +
          `Trip ID: ${id}. Location: https://maps.google.com/?q=${currentCoords?.latitude ?? 0},${currentCoords?.longitude ?? 0}. Please contact them immediately.`
        );
        Linking.openURL(`sms:${emergencyContact.phone}?body=${msg}`);
      }
      // Call emergency contact directly
      if (emergencyContact?.phone) {
        try {
          Linking.openURL(`tel:${emergencyContact.phone}`);
        } catch {}
      }

      // Start auto-location sharing timer
      const timer = setTimeout(() => {
        autoAlertTimerRef.current = null;
      }, 60000);
      autoAlertTimerRef.current = timer;
    } catch (err) {
      Alert.alert('Error', 'Could not send alert. Please call emergency services directly.');
    } finally {
      setLoading(false);
    }
  };

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
        Alert.alert(
          'RideCheck Alert',
          message,
          [
            { text: "I'm safe", style: 'default' },
            { text: 'Trigger SOS', style: 'destructive', onPress: () => handleSOSPress() },
          ]
        );
      });
      return () => { unsub?.(); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // handleSOSPress is a plain async function — adding it would cause infinite re-runs
  }, [rideCheckActive, id]);

  // Cleanup auto-alert timer on unmount
  useEffect(() => () => {
    if (autoAlertTimerRef.current) clearTimeout(autoAlertTimerRef.current);
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: alertSent ? 0 : 1 }}
          transition={{ type: 'timing', duration: 300 }}
        >
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
        </MotiView>

        <View style={styles.emergencyBadge}>
          <MotiView
            from={{ opacity: 0.5 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 600, loop: true }}
            style={styles.emergencyDot}
          />
          <Text style={styles.emergencyLabel}>EMERGENCY</Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        {/* Big SOS button */}
        <View style={styles.sosWrapper}>
          {/* Outer pulse ring */}
          {!alertSent && (
            <MotiView
              from={{ scale: 1, opacity: 0.4 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{ type: 'timing', duration: 1600, loop: true }}
              style={[styles.sosRing, { backgroundColor: colors.error }]}
            />
          )}
          {/* Inner pulse ring */}
          {!alertSent && (
            <MotiView
              from={{ scale: 1, opacity: 0.3 }}
              animate={{ scale: 1.25, opacity: 0 }}
              transition={{ type: 'timing', duration: 1600, loop: true, delay: 400 }}
              style={[styles.sosRing, { backgroundColor: colors.error }]}
            />
          )}

          <Pressable
            onPress={handleSOSPress}
            disabled={loading}
            style={[
              styles.sosButton,
              alertSent && { backgroundColor: colors.primary },
            ]}
          >
            {alertSent ? (
              <Ionicons name="checkmark" size={48} color={colors.onPrimary} />
            ) : (
              <Text style={styles.sosText}>SOS</Text>
            )}
          </Pressable>
        </View>

        {alertSent ? (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            style={styles.sentMsg}
          >
            <Text variant="titleSmall" color={colors.primary}>Alert Dispatched</Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.coordText}>
              Coordinates sent: {coordsString}
            </Text>
          </MotiView>
        ) : (
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.tapHint}>
            Tap to send emergency alert
          </Text>
        )}

        {/* RideCheck: inactivity detection */}
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 150 }}
          style={[styles.actionsCard, { marginBottom: spacing.md }]}
        >
          <ActionRow
            icon={audioRecording ? 'stop-circle-outline' : 'mic-outline'}
            iconColor={audioRecording ? '#EF4444' : colors.primary}
            iconBg={audioRecording ? 'rgba(239, 68, 68, 0.15)' : colors.primary + '20'}
            label={audioRecording ? 'Stop Recording' : 'Start Audio Recording'}
            sublabel={audioRecording ? 'Recording audio for safety evidence' : 'Record audio as safety evidence during the trip'}
            onPress={() => setAudioRecording(!audioRecording)}
          />
          <View style={styles.divider} />
          <ActionRow
            icon={rideCheckActive ? 'checkmark-circle' : 'shield-outline'}
            iconColor={rideCheckActive ? '#4BE277' : colors.onSurfaceVariant}
            iconBg={rideCheckActive ? 'rgba(75, 226, 119, 0.15)' : colors.surfaceContainerHigh + '40'}
            label={rideCheckActive ? 'RideCheck Active' : 'Enable RideCheck'}
            sublabel={rideCheckActive ? 'Monitoring for unexpected stops or route deviations' : 'Get alerted if your trip deviates unexpectedly'}
            onPress={() => setRideCheckActive(!rideCheckActive)}
          />
        </MotiView>

        {/* Action rows */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 300 }}
          style={styles.actionsCard}
        >
          <ActionRow
            icon="call"
            iconColor="#fff"
            iconBg={colors.error}
            label="Call Emergency Services"
            sublabel="112 — Police / Ambulance / Fire"
            onPress={() => Linking.openURL('tel:112')}
          />
          <View style={styles.divider} />
          <ActionRow
            icon="headset-outline"
            iconColor={colors.primary}
            iconBg={colors.primary + '20'}
            label="Call SNR Dispatcher"
            sublabel="EyeGo safety team — 24/7"
            onPress={() => Linking.openURL('tel:+233XXXXXXXXX')}
          />
          <View style={styles.divider} />
          <ActionRow
            icon="person-outline"
            iconColor={colors.secondary ?? colors.onSurfaceVariant}
            iconBg={(colors.secondary ?? colors.surfaceContainerHigh) + '20'}
            label={emergencyContact?.name ? `Alert ${emergencyContact.name}` : 'Alert Emergency Contact'}
            sublabel={emergencyContact?.phone ?? 'No emergency contact saved — add one in profile'}
            onPress={() => {
              if (!emergencyContact?.phone) {
                Alert.alert('No contact saved', 'Go to Profile → Edit Profile to add an emergency contact.');
                return;
              }
              Linking.openURL(`tel:${emergencyContact.phone}`);
            }}
          />
        </MotiView>
      </View>

      {/* Cancel */}
      <MotiView
        from={{ opacity: 0, translateY: 16 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 300 }}
        style={styles.cancelWrapper}
      >
        <Pressable onPress={() => router.back()} style={styles.cancelButton}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
            Cancel — I'm Safe
          </Text>
        </Pressable>
      </MotiView>
    </SafeAreaView>
  );
}

function ActionRow({
  icon,
  iconColor,
  iconBg,
  label,
  sublabel,
  onPress,
}: {
  icon: any;
  iconColor: string;
  iconBg: string;
  label: string;
  sublabel: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={rowStyles.row}>
      <View style={[rowStyles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" color={colors.onSurface}>{label}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 2 }}>
          {sublabel}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.base,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  emergencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.error + '20',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.error + '40',
  },
  emergencyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  emergencyLabel: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.caption,
    color: colors.error,
    letterSpacing: 1.5,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
  },
  sosWrapper: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  sosRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  sosButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.error + '60',
  },
  sosText: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: '#fff',
    letterSpacing: 2,
  },
  tapHint: {
    marginBottom: spacing['2xl'],
    textAlign: 'center',
  },
  sentMsg: {
    alignItems: 'center',
    marginBottom: spacing['2xl'],
    gap: spacing.xs,
  },
  coordText: { textAlign: 'center' },
  actionsCard: {
    width: '100%',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.base,
  },
  cancelWrapper: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['2xl'],
  },
  cancelButton: {
    height: 52,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
