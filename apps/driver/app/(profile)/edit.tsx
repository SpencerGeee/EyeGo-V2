import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Pressable,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from '@eyego/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, springs } from '@eyego/config';
import { Text, Button, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useDriverStore } from '../../stores/driver.store';
import { useColors, type DriverColors } from '../../utils/useColors';

export default function EditProfileScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { driver, updateDriver } = useDriverStore();
  const qc = useQueryClient();

  const [name, setName] = useState(driver?.name ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [error, setError] = useState('');

  /**
   * THE PHOTO NOW ACTUALLY GOES SOMEWHERE.
   *
   * BUGFIX ("I uploaded an image on the driver app but it didn't show or
   * update").
   *
   * `pickImage` set `avatarUri` and that was the end of it: the avatar circle
   * below rendered initials unconditionally, so the picked image never appeared;
   * and `saveProfile` sent `{ name }` only, so it was never uploaded either.
   * `avatarUri`'s single use was to enable the Save button — the one thing that
   * made the whole flow LOOK like it had worked.
   *
   * The upload path already existed and is used by the documents screen:
   * multipart POST /driver/documents with type PROFILE_PHOTO, which returns the
   * stored URL. Reusing it rather than inventing a second one keeps one place
   * where a driver's photo is stored and reviewed.
   */
  const saveProfile = useMutation({
    mutationFn: async () => {
      let photoUrl: string | undefined;

      if (avatarUri) {
        const filename = avatarUri.split('/').pop() ?? 'avatar.jpg';
        const formData = new FormData();
        formData.append('type', 'PROFILE_PHOTO');
        formData.append('file', { uri: avatarUri, name: filename, type: 'image/jpeg' } as any);
        const res = await driverApi.uploadDocument('PROFILE_PHOTO', formData);
        const result = (res as any)?.data?.data as Record<string, unknown> | undefined;
        photoUrl = [result?.profilePhotoUrl, result?.documentUrl, result?.url].find(
          (v): v is string => typeof v === 'string',
        );
      }

      if (name.trim() !== (driver?.name ?? '')) {
        await driverApi.updateMe({ name: name.trim() });
      }
      return { photoUrl };
    },
    onSuccess: ({ photoUrl }) => {
      // Update store directly with the known changed values so every screen
      // showing the avatar (home header, profile tab) moves immediately rather
      // than waiting on the refetch below.
      updateDriver({
        name: name.trim(),
        ...(photoUrl ? { profilePhoto: photoUrl, avatarUrl: photoUrl } : {}),
      });
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      qc.invalidateQueries({ queryKey: ['driver', 'documents'] });
      router.back();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'Failed to save. Please try again.');
    },
  });

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo access is off. Allow it in Settings to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      setError('');
    }
  };

  /**
   * What the circle shows: the photo just picked, else the one already stored,
   * else initials. The local URI wins so the driver sees their choice the
   * instant they make it, before it has been uploaded.
   */
  const avatarSource = avatarUri
    ? { uri: avatarUri }
    : (driver as any)?.profilePhoto || (driver as any)?.avatarUrl
      ? { uri: ((driver as any).profilePhoto ?? (driver as any).avatarUrl) as string }
      : null;

  const initials = (driver?.name ?? name).trim().split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const hasChanges = name.trim() !== (driver?.name ?? '') || !!avatarUri;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      {/* Back */}
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', ...springs.standard }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard, delay: 40 }}
          >
            <Text variant="headlineLarge" style={styles.headline}>Edit Profile</Text>
          </MotiView>

          {/* Avatar */}
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', ...springs.standard, delay: 80 }}
            style={styles.avatarWrapper}
          >
            <Pressable onPress={pickImage} style={styles.avatarTouch}>
              <View style={styles.avatarCircle}>
                {avatarSource ? (
                  <Image source={avatarSource} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarInitials}>{initials || '?'}</Text>
                )}
              </View>
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={14} color={colors.onPrimary} />
              </View>
            </Pressable>
          </MotiView>

          {/* Name field */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard, delay: 110 }}
            style={styles.fieldWrapper}
          >
            <Text variant="label" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Full name</Text>
            <View style={[styles.inputBox, !!error && styles.inputBoxError]}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(t) => { setName(t); setError(''); }}
                placeholder="Your full name"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="words"
                autoFocus
                selectionColor={colors.primary}
              />
            </View>
            {!!error && <Text variant="caption" color={colors.error} style={{ marginTop: spacing.xs }}>{error}</Text>}
          </MotiView>

          {/* Phone (read-only) */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard, delay: 140 }}
            style={styles.fieldWrapper}
          >
            <Text variant="label" color={colors.onSurfaceVariant} style={styles.fieldLabel}>Phone number</Text>
            <View style={[styles.inputBox, styles.inputBoxReadOnly]}>
              <TextInput
                style={[styles.input, { color: colors.onSurfaceVariant }]}
                value={driver?.phone ?? ''}
                editable={false}
              />
              <Ionicons name="lock-closed-outline" size={16} color={colors.onSurfaceVariant} />
            </View>
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xs }}>
              Contact support to change your phone number.
            </Text>
          </MotiView>

          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', ...springs.standard, delay: 170 }}
          >
            <Button
              label="Save Changes"
              onPress={() => saveProfile.mutate()}
              loading={saveProfile.isPending}
              disabled={!hasChanges || !name.trim()}
            />
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    headline: { letterSpacing: -1, marginBottom: spacing['2xl'] },
    avatarWrapper: { alignItems: 'center', marginBottom: spacing['3xl'] },
    avatarTouch: { position: 'relative' },
    avatarCircle: {
      overflow: 'hidden',
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Fills the circle: the ring is drawn by avatarCircle's border, so the
    // image sits inside it and is clipped to the same radius.
    avatarImage: { width: '100%', height: '100%', borderRadius: 48 },
    avatarInitials: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 39, color: colors.primary },
    cameraBadge: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.backgroundDeep,
    },
    fieldWrapper: { marginBottom: spacing.lg },
    fieldLabel: { marginBottom: spacing.xs },
    inputBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: colors.outline,
      height: 56,
      paddingHorizontal: spacing.base,
    },
    inputBoxError: { borderColor: colors.error },
    inputBoxReadOnly: { opacity: 0.6 },
    input: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
  });
