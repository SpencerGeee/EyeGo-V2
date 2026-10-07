import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TextInput, Pressable, Image } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, goBack, notify } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useDriverStore } from '../../stores/driver.store';
import { useColors, type DriverColors } from '../../utils/useColors';

/**
 * EDIT PROFILE — photo and name. The phone is the login, so it is shown
 * read-only with the way to change it.
 *
 * The photo goes up through the same multipart path the documents screen uses
 * (PROFILE_PHOTO), so there is one place a driver's face is stored.
 */
export default function EditProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { driver, updateDriver } = useDriverStore();
  const qc = useQueryClient();

  const [name, setName] = useState(driver?.name ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [error, setError] = useState('');

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
        photoUrl = [result?.profilePhotoUrl, result?.documentUrl, result?.url].find((v): v is string => typeof v === 'string');
      }
      if (name.trim() !== (driver?.name ?? '')) await driverApi.updateMe({ name: name.trim() });
      return { photoUrl };
    },
    onSuccess: ({ photoUrl }) => {
      // Every avatar on screen (home header, account tab) moves at once.
      updateDriver({ name: name.trim(), ...(photoUrl ? { profilePhoto: photoUrl, avatarUrl: photoUrl } : {}) });
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      qc.invalidateQueries({ queryKey: ['driver', 'documents'] });
      notify('Profile updated', undefined, { tone: 'success' });
      goBack();
    },
    onError: (err) => setError(describeError(err, 'Failed to save. Please try again.').message),
  });

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo access is off. Allow it in Settings to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      setError('');
    }
  };

  // The photo just picked, else the stored one, else initials.
  const stored = (driver as any)?.profilePhoto ?? (driver as any)?.avatarUrl;
  const avatarSource = avatarUri ? { uri: avatarUri } : stored ? { uri: stored as string } : null;
  const initials = (driver?.name ?? name).trim().split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const trimmed = name.trim();
  const hasChanges = trimmed !== (driver?.name ?? '') || !!avatarUri;
  const nameOk = trimmed.length >= 2;

  return (
    <Screen
      title="Edit profile"
      keyboard
      footer={
        <Button
          label="Save"
          onPress={() => saveProfile.mutate()}
          loading={saveProfile.isPending}
          disabled={!hasChanges || !nameOk || saveProfile.isPending}
        />
      }
    >
      <View style={styles.avatarWrap}>
        <Pressable onPress={pickImage} accessibilityRole="button" accessibilityLabel="Change profile photo">
          <View style={styles.avatar}>
            {avatarSource ? (
              <Image source={avatarSource} style={styles.avatarImage} />
            ) : (
              <Text style={styles.initials}>{initials || '?'}</Text>
            )}
          </View>
          <View style={styles.cameraBadge}>
            <Ionicons name="camera" size={14} color={colors.onPrimary} />
          </View>
        </Pressable>
        <Text style={styles.photoHint}>Riders see this when you’re on the way.</Text>
      </View>

      <View style={styles.field}>
        <Text variant="labelCaps" style={styles.fieldLabel}>Full name</Text>
        <TextInput
          maxFontSizeMultiplier={1.4}
          style={[styles.input, !!error && styles.inputError]}
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError('');
          }}
          placeholder="Your full name"
          placeholderTextColor={colors.onSurfaceVariant}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          selectionColor={colors.primary}
          accessibilityLabel="Full name"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <ListSection footer="Your phone number is how you sign in. To change it, contact support.">
        <ListRow icon="call-outline" title="Phone number" value={driver?.phone ?? ''} right={<Ionicons name="lock-closed-outline" size={16} color={colors.onSurfaceVariant} />} />
      </ListSection>
    </Screen>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    avatarWrap: { alignItems: 'center', marginTop: 12, gap: 12 },
    avatar: {
      width: 104,
      height: 104,
      borderRadius: 52,
      overflow: 'hidden',
      backgroundColor: c.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarImage: { width: '100%', height: '100%' },
    initials: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 42, color: c.onSurface },
    cameraBadge: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: c.background,
    },
    photoHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant },
    field: { marginTop: 28, paddingHorizontal: 20 },
    fieldLabel: { marginBottom: 8 },
    input: {
      fontFamily: fonts.medium,
      fontSize: 16,
      color: c.onSurface,
      backgroundColor: c.surfaceContainer,
      borderRadius: radii.lg,
      borderWidth: 1.5,
      borderColor: 'transparent',
      paddingHorizontal: 16,
      height: 52,
    },
    inputError: { borderColor: c.error },
    error: { marginTop: 6, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.error },
  });
