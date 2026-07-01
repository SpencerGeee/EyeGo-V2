import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii, fonts, fontSizes } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { useRideStore } from '../../../stores/ride.store';
import { apiClient } from '@eyego/api';
import { useMutation } from '@tanstack/react-query';

const ISSUE_TYPES: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'Incorrect fare', icon: 'card-outline' },
  { label: 'Wrong route', icon: 'git-branch-outline' },
  { label: 'Unsafe driving', icon: 'warning-outline' },
  { label: 'Rude conduct', icon: 'sad-outline' },
  { label: 'Vehicle issue', icon: 'car-sport-outline' },
  { label: 'Other', icon: 'ellipsis-horizontal' },
];

const MAX_CHARS = 500;

export default function DisputeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { selectedTrip } = useRideStore();

  const [selectedType, setSelectedType] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const disputeMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/bookings/' + id + '/dispute', {
        type: selectedType,
        description,
      }),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err: any) => {
      Alert.alert('Submission Failed', err?.message || 'Could not submit your report. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!selectedType) {
      Alert.alert('Select Issue', 'Please select the type of issue before submitting.');
      return;
    }
    disputeMutation.mutate();
  };

  const trip = selectedTrip as any;
  const dropoff = trip?.dropoffLocation?.name ?? trip?.route?.name ?? 'Recent Trip';
  const vehicle = trip?.vehicle
    ? `${trip.vehicle.model ?? 'Vehicle'}${trip.vehicle.color ? ' • ' + trip.vehicle.color : ''}`
    : 'Shared Van';

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </TouchableOpacity>
          <Text variant="titleSmall">Report Issue</Text>
          <View style={{ width: 40 }} />
        </View>

        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={styles.successContainer}
        >
          <View style={[styles.successIcon, { backgroundColor: (colors.statusSuccess ?? colors.primary) + '1F' }]}>
            <Ionicons name="checkmark-circle" size={64} color={colors.statusSuccess ?? '#22C55E'} />
          </View>
          <Text variant="titleMedium" style={{ color: colors.onSurface, marginTop: spacing['2xl'] }}>
            Report Submitted
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: colors.onSurfaceVariant, marginTop: spacing.md, textAlign: 'center' }}
          >
            We'll review your report within 24 hours.
          </Text>
          <View style={{ marginTop: spacing['3xl'], width: '100%' }}>
            <Button label="Done" onPress={() => router.back()} variant="primary" />
          </View>
        </MotiView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          {/* Title block */}
          <Text variant="headlineMedium" style={styles.title}>
            Report an Issue
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Tell us what went wrong with this trip and we'll make it right.
          </Text>

          {/* Trip summary card */}
          <View style={styles.tripCard}>
            <View style={styles.tripThumb}>
              <Ionicons name="location" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.tripMetaRow}>
                <Text style={styles.tripStatus}>COMPLETED</Text>
                <Text style={styles.tripDate}>Recent</Text>
              </View>
              <Text variant="titleSmall" numberOfLines={1} style={{ color: colors.onSurface }}>
                {dropoff}
              </Text>
              <View style={styles.tripVehicleRow}>
                <Ionicons name="car" size={14} color={colors.outline} />
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {vehicle}
                </Text>
              </View>
            </View>
          </View>

          {/* Issue chips */}
          <Text variant="titleSmall" style={styles.sectionTitle}>
            What went wrong?
          </Text>
          <View style={styles.chipWrap}>
            {ISSUE_TYPES.map((issue) => {
              const active = selectedType === issue.label;
              return (
                <Pressable
                  key={issue.label}
                  onPress={() => setSelectedType(issue.label)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Ionicons
                    name={issue.icon}
                    size={16}
                    color={active ? colors.primary : colors.onSurfaceVariant}
                  />
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.primary : colors.onSurfaceVariant },
                    ]}
                  >
                    {issue.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Details */}
          <View style={styles.descriptionHeader}>
            <Text variant="titleSmall" style={{ color: colors.onSurface }}>
              Details
            </Text>
            <Text variant="bodySmall" color={colors.outline}>
              Optional
            </Text>
          </View>
          <View style={styles.textAreaWrap}>
            <TextInput
              value={description}
              onChangeText={(t) => setDescription(t.slice(0, MAX_CHARS))}
              placeholder="Describe what happened..."
              placeholderTextColor={colors.outlineVariant}
              multiline
              numberOfLines={5}
              style={styles.textArea}
            />
            <Text style={styles.charCount}>
              {description.length}/{MAX_CHARS}
            </Text>
          </View>
        </MotiView>
      </ScrollView>

      {/* Fixed bottom CTA */}
      <View style={styles.footer}>
        <Button
          label={disputeMutation.isPending ? 'Submitting...' : 'Submit Report'}
          onPress={handleSubmit}
          variant="primary"
          disabled={!selectedType || disputeMutation.isPending}
          icon={<Ionicons name="send" size={18} color={colors.onPrimary} />}
        />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.sm,
      paddingBottom: 140,
    },
    title: { color: colors.onSurface, marginBottom: spacing.sm },
    subtitle: { color: colors.onSurfaceVariant, marginBottom: spacing['2xl'], maxWidth: '90%' },
    tripCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.base,
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.05)',
      padding: spacing.base,
      marginBottom: spacing['2xl'],
    },
    tripThumb: {
      width: 72,
      height: 72,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tripMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 2,
    },
    tripStatus: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      letterSpacing: 0.6,
      color: colors.primary,
    },
    tripDate: {
      fontFamily: fonts.medium,
      fontSize: 10,
      letterSpacing: 0.6,
      color: colors.outlineVariant,
    },
    tripVehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    sectionTitle: { color: colors.onSurface, marginBottom: spacing.base },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing['2xl'],
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm + 2,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.surfaceVariant ?? colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
    },
    chipActive: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}1A`,
    },
    chipText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodySmall,
    },
    descriptionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginBottom: spacing.base,
    },
    textAreaWrap: {
      position: 'relative',
      backgroundColor: '#0D1515',
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.surfaceVariant ?? colors.outlineVariant,
      overflow: 'hidden',
    },
    textArea: {
      color: colors.onSurface,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      padding: spacing.base,
      paddingBottom: spacing['2xl'],
      textAlignVertical: 'top',
      minHeight: 140,
    },
    charCount: {
      position: 'absolute',
      bottom: spacing.sm,
      right: spacing.base,
      fontFamily: fonts.medium,
      fontSize: 10,
      letterSpacing: 0.6,
      color: colors.outline,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.base,
      paddingBottom: spacing['2xl'],
      backgroundColor: colors.backgroundDeep,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.05)',
    },
    successContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
    },
    successIcon: {
      width: 100,
      height: 100,
      borderRadius: 50,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
