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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
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

  const saveProfile = useMutation({
    mutationFn: () => driverApi.updateMe({ name: name.trim() }),
    onSuccess: () => {
      // Update store directly with the known changed value
      updateDriver({ name: name.trim() });
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      router.back();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'Failed to save. Please try again.');
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
    if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri);
  };

  const initials = (driver?.name ?? name).trim().split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const hasChanges = name.trim() !== (driver?.name ?? '') || !!avatarUri;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      {/* Back */}
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
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
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
          >
            <Text variant="headlineLarge" style={styles.headline}>Edit Profile</Text>
          </MotiView>

          {/* Avatar */}
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 80 }}
            style={styles.avatarWrapper}
          >
            <Pressable onPress={pickImage} style={styles.avatarTouch}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitials}>{initials || '?'}</Text>
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
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 110 }}
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
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 140 }}
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
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 170 }}
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
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.surfaceContainerHigh,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
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
