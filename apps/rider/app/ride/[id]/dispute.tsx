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
import { spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../../utils/useColors';
import { apiClient } from '@eyego/api';
import { useMutation } from '@tanstack/react-query';

const ISSUE_TYPES = [
  'Incorrect fare charged',
  'Driver was rude or unprofessional',
  'Unsafe or reckless driving',
  'Lost item in vehicle',
  'Driver cancelled without reason',
  'Other',
];

const MAX_CHARS = 500;

export default function DisputeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

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

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
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
          <View style={[styles.successIcon, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Report Issue</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <Text
            variant="labelSmall"
            style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
          >
            ISSUE TYPE
          </Text>

          <View style={styles.card}>
            {ISSUE_TYPES.map((type, index) => (
              <React.Fragment key={type}>
                {index > 0 && <View style={styles.divider} />}
                <Pressable
                  onPress={() => setSelectedType(type)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surfaceContainerHigh ?? colors.surfaceContainer },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                      {type}
                    </Text>
                  </View>
                  {selectedType === type ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={22} color={colors.outlineVariant} />
                  )}
                </Pressable>
              </React.Fragment>
            ))}
          </View>

          <View style={{ marginTop: spacing['2xl'] }}>
            <View style={styles.descriptionHeader}>
              <Text
                variant="labelSmall"
                style={[styles.sectionLabel, { color: colors.onSurfaceVariant, marginBottom: 0 }]}
              >
                DESCRIPTION (OPTIONAL)
              </Text>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {description.length}/{MAX_CHARS}
              </Text>
            </View>
            <TextInput
              value={description}
              onChangeText={(t) => setDescription(t.slice(0, MAX_CHARS))}
              placeholder="Describe what happened..."
              placeholderTextColor={colors.onSurfaceVariant}
              multiline
              numberOfLines={5}
              style={[
                styles.textArea,
                {
                  color: colors.onSurface,
                  borderColor: colors.outlineVariant,
                  backgroundColor: colors.surfaceContainer,
                },
              ]}
            />
          </View>

          <View style={{ marginTop: spacing['2xl'] }}>
            <Button
              label={disputeMutation.isPending ? 'Submitting...' : 'Submit Report'}
              onPress={handleSubmit}
              variant="primary"
              disabled={!selectedType || disputeMutation.isPending}
            />
          </View>
        </MotiView>
      </ScrollView>
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
    sectionLabel: { letterSpacing: 1, marginBottom: spacing.base },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.base,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
    divider: { height: 1, backgroundColor: colors.outlineVariant, marginHorizontal: spacing.base },
    descriptionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.base,
    },
    textArea: {
      borderWidth: 1,
      borderRadius: radii.xl,
      padding: spacing.base,
      fontSize: 15,
      textAlignVertical: 'top',
      minHeight: 120,
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
