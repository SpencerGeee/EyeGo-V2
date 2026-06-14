import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useDriverStore } from '../../stores/driver.store';
import { useColors, type DriverColors } from '../../utils/useColors';

export default function DriverRegisterScreen() {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { updateDriver } = useDriverStore();

  const [name, setName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [dob, setDob] = useState<Date | null>(null);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [dobError, setDobError] = useState('');

  const maxDob = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d;
  }, []);

  const updateProfile = useMutation({
    mutationFn: async () => {
      const dobStr = dob ? dob.toISOString().split('T')[0] : undefined;
      const { data } = await driverApi.updateMe({ name: name.trim(), dateOfBirth: dobStr });
      return data.data;
    },
    onSuccess: (updatedDriver) => {
      updateDriver(updatedDriver);
      router.replace('/(tabs)/home');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to save profile. Please try again.';
      setNameError(msg);
    },
  });

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleContinue = () => {
    let hasError = false;
    if (!name.trim()) {
      setNameError('Please enter your full name');
      hasError = true;
    } else {
      setNameError('');
    }
    if (!dob) {
      setDobError('Date of birth is required');
      hasError = true;
    } else {
      setDobError('');
    }
    if (hasError) return;
    updateProfile.mutate();
  };

  const initials = name.trim().split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Headline */}
          <MotiView
            from={{ opacity: 0, translateY: -8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          >
            <Text variant="headlineLarge" style={styles.headline}>Almost{'\n'}there</Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
              Set up your driver profile to get started.
            </Text>
          </MotiView>

          {/* Avatar */}
          <MotiView
            from={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 60 }}
            style={styles.avatarWrapper}
          >
            <Pressable onPress={pickImage} style={styles.avatarTouch}>
              <View style={styles.avatarCircle}>
                {initials ? (
                  <Text style={styles.avatarInitials}>{initials}</Text>
                ) : (
                  <Ionicons name="camera-outline" size={32} color={colors.primary} />
                )}
              </View>
              <View style={styles.avatarBadge}>
                <Ionicons name="add" size={14} color={colors.onPrimary} />
              </View>
            </Pressable>
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
              Add photo (optional)
            </Text>
          </MotiView>

          {/* Name input */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
            style={styles.inputWrapper}
          >
            <Text variant="label" color={colors.onSurfaceVariant} style={styles.inputLabel}>
              Full name
            </Text>
            <View style={[styles.inputContainer, !!nameError && styles.inputError]}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(t) => { setName(t); setNameError(''); }}
                placeholder="e.g. Kwame Asante"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="words"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleContinue}
                selectionColor={colors.primary}
              />
            </View>
            {!!nameError && (
              <Text variant="caption" color={colors.error} style={{ marginTop: spacing.xs }}>
                {nameError}
              </Text>
            )}
          </MotiView>

          {/* DOB input */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 130 }}
            style={styles.inputWrapper}
          >
            <Text variant="label" color={colors.onSurfaceVariant} style={styles.inputLabel}>
              Date of birth
            </Text>
            <Pressable
              style={[styles.inputContainer, !!dobError && styles.inputError]}
              onPress={() => setShowDobPicker(true)}
            >
              <Text style={[styles.input, { color: dob ? colors.onSurface : colors.onSurfaceVariant }]}>
                {dob
                  ? dob.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })
                  : 'Select your date of birth'}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceVariant} />
            </Pressable>
            {!!dobError && (
              <Text variant="caption" color={colors.error} style={{ marginTop: spacing.xs }}>
                {dobError}
              </Text>
            )}
            {showDobPicker && (
              <DateTimePicker
                value={dob ?? maxDob}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={maxDob}
                minimumDate={new Date(1940, 0, 1)}
                onChange={(_, date) => {
                  if (Platform.OS !== 'ios') setShowDobPicker(false);
                  if (date) { setDob(date); setDobError(''); }
                }}
              />
            )}
            {Platform.OS === 'ios' && showDobPicker && (
              <Pressable
                onPress={() => setShowDobPicker(false)}
                style={{ alignSelf: 'flex-end', paddingVertical: spacing.xs }}
              >
                <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.primary }}>
                  Done
                </Text>
              </Pressable>
            )}
          </MotiView>

          {/* CTA */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 160 }}
            style={styles.ctaWrapper}
          >
            <Button
              label="Start Driving"
              onPress={handleContinue}
              loading={updateProfile.isPending}
              disabled={!name.trim() || !dob}
            />
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    headline: { letterSpacing: -1, lineHeight: 38 },
    subtext: { marginTop: spacing.sm, lineHeight: 22 },
    avatarWrapper: {
      alignItems: 'center',
      marginTop: spacing['3xl'],
      marginBottom: spacing['2xl'],
    },
    avatarTouch: { position: 'relative' },
    avatarCircle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 2,
      borderColor: colors.outline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitials: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      color: colors.primary,
    },
    avatarBadge: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.backgroundDeep,
    },
    inputWrapper: { marginBottom: spacing.lg },
    inputLabel: { marginBottom: spacing.xs },
    inputContainer: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: colors.outline,
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.base,
    },
    inputError: { borderColor: colors.error },
    input: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyLarge ?? 16,
      color: colors.onSurface,
    },
    ctaWrapper: { marginTop: spacing.md },
  });
