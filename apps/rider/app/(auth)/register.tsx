import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Entrance } from '@eyego/ui';
import * as ImagePicker from 'expo-image-picker';
import { useMutation } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { userApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Input } from '@eyego/ui';
import { getInitials } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';

export default function RegisterScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, updateUser } = useAuthStore();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [dobError, setDobError] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');

  const handleDobChange = (text: string) => {
    let clean = text.replace(/\D/g, '');
    if (clean.length > 8) clean = clean.slice(0, 8);

    let formatted = '';
    if (clean.length > 0) {
      formatted += clean.slice(0, 2);
    }
    if (clean.length > 2) {
      formatted += ' / ' + clean.slice(2, 4);
    }
    if (clean.length > 4) {
      formatted += ' / ' + clean.slice(4, 8);
    }
    setDob(formatted);
    setDobError('');
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      const d = selectedDate.getDate().toString().padStart(2, '0');
      const m = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
      const y = selectedDate.getFullYear().toString();
      setDob(`${d} / ${m} / ${y}`);
      setDobError('');
    }
  };

  const updateProfile = useMutation({
    mutationFn: async () => {
      let avatarUrl: string | undefined;
      if (avatarUri) {
        avatarUrl = await userApi.uploadAvatar(avatarUri);
      }
      // Pass both name and DOB
      const { data } = await userApi.updateProfile({ 
        name: name.trim(), 
        avatarUrl,
        dob: dob.trim() 
      } as any);
      return { ...data.data, dob: dob.trim(), avatarUrl };
    },
    onSuccess: (updatedUser) => {
      updateUser(updatedUser as any);
      router.replace('/(onboarding)');
    },
    onError: (err: any) => {
      Alert.alert('Couldn\'t save profile', err?.response?.data?.message ?? err?.message ?? 'Please check your connection and try again.');
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
    if (name.trim().length < 2) {
      setNameError('Please enter your full name');
      return;
    }
    setNameError('');

    if (dob.length !== 14) {
      setDobError('Please enter a valid date of birth');
      return;
    }
    setDobError('');

    updateProfile.mutate();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
          {/* Header */}
          <Entrance animation="slideUp" delay={50}>
            <Text variant="headlineLarge" style={styles.headline}>
              Complete your{'\n'}profile
            </Text>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
              Just a few details to personalise your experience.
            </Text>
          </Entrance>

          {/* Avatar picker */}
          <Entrance animation="scaleIn" delay={100} style={styles.avatarSection}>
            <Pressable onPress={pickImage} style={styles.avatarContainer} accessibilityRole="button" accessibilityLabel="Add profile photo">
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>
                    {name ? getInitials(name) : '?'}
                  </Text>
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="pencil" size={12} color={colors.onPrimary} />
              </View>
            </Pressable>
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
              Tap to add photo
            </Text>
          </Entrance>

          {/* Name input */}
          <Entrance animation="slideUp" delay={120} style={styles.inputSection}>
            <Input
              label="Full name"
              value={name}
              onChangeText={(t) => { setName(t); setNameError(''); }}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              error={nameError}
            />
          </Entrance>

          {/* Date of Birth input */}
          <Entrance animation="slideUp" delay={150} style={styles.inputSection}>
            <Input
              label="Date of birth"
              value={dob}
              onChangeText={handleDobChange}
              keyboardType="numeric"
              placeholder="DD / MM / YYYY"
              error={dobError}
              rightIcon={
                <Pressable
              onPress={() => setShowDatePicker(true)}
              hitSlop={10}
              accessibilityLabel="Open date picker"
            >
                  <Ionicons name="calendar-outline" size={22} color={colors.primary} />
                </Pressable>
              }
            />

            {showDatePicker && (
              <DateTimePicker
                value={new Date(2000, 0, 1)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={onDateChange}
              />
            )}
          </Entrance>

          {/* CTA */}
          <Entrance animation="slideUp" delay={160} style={styles.ctaSection}>
            <Button
              label="Continue"
              onPress={handleContinue}
              disabled={name.trim().length < 2 || dob.length !== 14}
              loading={updateProfile.isPending}
            />
            {updateProfile.isError && (
              <Text variant="caption" color={colors.error} style={styles.errorText}>
                Something went wrong. Please try again.
              </Text>
            )}
          </Entrance>

          {/* Skip */}
          <Entrance animation="fadeIn" delay={180} duration={400}>
            <Pressable
              onPress={() => router.replace('/(onboarding)')}
              style={styles.skipButton}
              accessibilityRole="button"
              accessibilityLabel="Skip profile setup"
            >
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                Skip for now
              </Text>
            </Pressable>
          </Entrance>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  headline: {
    letterSpacing: -1,
    lineHeight: 34,
  },
  subtext: {
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  avatarSection: {
    alignItems: 'center',
    marginTop: spacing['3xl'],
    marginBottom: spacing['2xl'],
  },
  avatarContainer: {
    position: 'relative',
    width: 100,
    height: 100,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2.5,
    borderColor: colors.primary,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  avatarInitials: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineMedium,
    lineHeight: fontSizes.headlineMedium * 1.25,
    color: colors.onSurfaceVariant,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditIcon: {
    fontSize: 14,
    color: colors.onPrimary,
  },
  inputSection: {
    marginBottom: spacing.xl,
  },
  ctaSection: {
    marginBottom: spacing.base,
  },
  errorText: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: spacing.base,
  },
});
