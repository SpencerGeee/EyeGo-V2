import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import * as Contacts from 'expo-contacts';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { userApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Input, GlassSurface, GradientGlowBorder, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS, MorphTarget, useMorph } from '@eyego/ui';
import { getInitials } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';

export default function EditProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { morphId } = useLocalSearchParams<{ morphId?: string }>();
  const { morphBack } = useMorph();
  // Reverse the hero-avatar morph back into the profile screen. Falls back to
  // a plain pop when no morph is in flight (deep link / no source measured).
  const handleBack = useCallback(() => {
    morphBack(() => router.back());
  }, [morphBack, router]);
  const { user, updateUser } = useAuthStore();
  const qc = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState((user as any)?.email ?? '');
  const [dob, setDob] = useState((user as any)?.dob ?? '');
  const [dobDate, setDobDate] = useState<Date>(() => {
    const stored = (user as any)?.dob ?? '';
    const parts = stored.split(' / ');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date(2000, 0, 1);
  });
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [emergencyName, setEmergencyName] = useState((user as any)?.emergencyContact?.name ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState((user as any)?.emergencyContact?.phone ?? '');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactList, setContactList] = useState<Contacts.Contact[]>([]);

  const handlePickContact = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow access to contacts in Settings.');
      return;
    }
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      sort: Contacts.SortTypes.FirstName,
    });
    const withPhones = data.filter(c => c.name && c.phoneNumbers?.length);
    setContactList(withPhones);
    setShowContactPicker(true);
  };

  const selectContact = useCallback((contact: Contacts.Contact) => {
    const phone = contact.phoneNumbers?.[0]?.number?.replace(/\s/g, '') ?? '';
    setEmergencyName(contact.name ?? '');
    setEmergencyPhone(phone);
    setShowContactPicker(false);
  }, []);

  const onDateChange = (_event: any, selectedDate?: Date) => {
    if (selectedDate) {
      setDobDate(selectedDate);
      const d = selectedDate.getDate().toString().padStart(2, '0');
      const m = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
      const y = selectedDate.getFullYear().toString();
      setDob(`${d} / ${m} / ${y}`);
    }
  };

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

  const saveProfile = useMutation({
    mutationFn: async () => {
      let avatarUrl: string | undefined;
      if (avatarUri) {
        avatarUrl = await userApi.uploadAvatar(avatarUri);
      }
      const { data } = await userApi.updateProfile({
        name: name.trim(),
        email: email.trim() || undefined,
        dob: dob.trim() || undefined,
        avatarUrl,
        emergencyContact: emergencyName.trim()
          ? { name: emergencyName.trim(), phone: emergencyPhone.trim() }
          : undefined,
      } as any);
      return data.data;
    },
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
      qc.invalidateQueries({ queryKey: ['user', 'profile'] });
      handleBack();
    },
    onError: () => {
      Alert.alert('Save Failed', 'Could not save your profile. Please check your connection and try again.');
    },
  });

  const handleSave = () => {
    if (name.trim().length < 2) {
      setNameError('Please enter your full name');
      return;
    }
    setNameError('');
    saveProfile.mutate();
  };

  const renderContactItem = useCallback(({ item }: { item: Contacts.Contact }) => (
    <Pressable
      onPress={() => selectContact(item)}
      style={{ padding: spacing['2xl'], borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}
    >
      <Text variant="bodyMedium">{item.name}</Text>
      <Text variant="caption" color={colors.onSurfaceVariant}>{item.phoneNumbers?.[0]?.number ?? ''}</Text>
    </Pressable>
  ), [selectContact, colors]);

  const avatarSource = avatarUri
    ? { uri: avatarUri }
    : user?.avatarUrl
    ? { uri: user.avatarUrl }
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleSmall">Edit Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAwareScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          {/* Avatar */}
          <View
            style={styles.avatarSection}
          >
            <MorphTarget id={morphId ?? 'profile-hero-avatar'} borderRadius={48}>
            <Pressable onPress={pickImage} style={styles.avatarContainer}>
              <GradientGlowBorder
                colors={PREMIUM_RING_COLORS}
                locations={PREMIUM_RING_LOCATIONS}
                fillColor={colors.surfaceContainerHigh}
                borderRadius={54}
                glow
                glowColor={colors.primary}
                style={styles.avatarRing}
              >
                {avatarSource ? (
                  <Image source={avatarSource} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitials}>
                      {name ? getInitials(name) : '?'}
                    </Text>
                  </View>
                )}
              </GradientGlowBorder>
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera-outline" size={14} color={colors.onPrimary} />
              </View>
            </Pressable>
            </MorphTarget>
            <Text style={styles.changePhotoLabel}>CHANGE PHOTO</Text>
          </View>

          {/* Name */}
          <View
            style={styles.inputSection}
          >
            <Input
              label="Full name"
              value={name}
              onChangeText={(t) => { setName(t); setNameError(''); }}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              error={nameError}
            />
          </View>

          {/* Email */}
          <View
            style={styles.inputSection}
          >
            <Input
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />
          </View>

          {/* Phone (read-only, verified) */}
          <View
            style={styles.inputSection}
          >
            <Text style={styles.phoneLabel}>Phone Number</Text>
            <View style={styles.phoneField}>
              <Text style={styles.phoneValue}>{user?.phone ?? '—'}</Text>
              <Ionicons name="checkmark-circle" size={20} color={colors.statusSuccess} />
            </View>
          </View>

          {/* Date of Birth */}
          <View
            style={styles.inputSection}
          >
            <Text variant="caption" color={colors.onSurfaceVariant} style={styles.dobLabel}>
              Date of birth
            </Text>
            <View style={styles.dobPickerContainer}>
              <DateTimePicker
                value={dobDate}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={onDateChange}
                style={styles.dobPicker}
              />
            </View>
          </View>

          {/* Emergency Contact */}
          <View
            >
            <View style={styles.sectionHeader}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Text variant="label" color={colors.onSurface} style={{ marginLeft: spacing.xs }}>
                Emergency Contact
              </Text>
            </View>
            <Text variant="caption" color={colors.onSurfaceVariant} style={styles.sectionCaption}>
              Notified when you trigger SOS
            </Text>
            <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.emergencyCard}>
              <View style={styles.inputSection}>
                <Input
                  label="Contact name"
                  value={emergencyName}
                  onChangeText={setEmergencyName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
                <Pressable onPress={handlePickContact} style={styles.pickContactBtn}>
                  <Ionicons name="phone-portrait-outline" size={14} color={colors.primary} />
                  <Text variant="caption" color={colors.primary}> Pick from contacts</Text>
                </Pressable>
              </View>
              <View style={{ marginBottom: 0 }}>
                <Input
                  label="Contact phone"
                  value={emergencyPhone}
                  onChangeText={setEmergencyPhone}
                  keyboardType="phone-pad"
                  returnKeyType="done"
                />
              </View>
            </GlassSurface>
          </View>

          {saveProfile.isError && (
            <Text variant="caption" color={colors.error} style={styles.errorText}>
              Something went wrong. Please try again.
            </Text>
          )}
        </KeyboardAwareScrollView>

        {/* Fixed bottom Save — rides the keyboard so it stays reachable */}
        <KeyboardStickyView>
          <View style={styles.footer}>
            <Button
              label="Save Changes"
              onPress={handleSave}
              disabled={name.trim().length < 2}
              loading={saveProfile.isPending}
              fullWidth
            />
          </View>
        </KeyboardStickyView>
      </View>
      <Modal visible={showContactPicker} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing['2xl'] }}>
            <Text variant="titleMedium">Select Contact</Text>
            <Pressable onPress={() => setShowContactPicker(false)}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <FlatList
            data={contactList}
            keyExtractor={(item: any) => item.id ?? item.name ?? Math.random().toString()}
            renderItem={renderContactItem}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.rimLightSubtle,
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
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: 120,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing['2xl'],
  },
  avatarContainer: { position: 'relative', width: 108, height: 108 },
  avatarRing: { width: 108, height: 108, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineLarge,
    lineHeight: fontSizes.headlineLarge * 1.25,
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
    borderWidth: 2,
    borderColor: colors.backgroundDeep,
  },
  changePhotoLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.primary,
    marginTop: spacing.md,
  },
  inputSection: { marginBottom: spacing.xl },
  phoneLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodySmall,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
  },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceInput,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md + 2,
  },
  phoneValue: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLarge,
    lineHeight: fontSizes.bodyLarge * 1.3,
    color: colors.onSurfaceVariant,
  },
  footer: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.base,
    paddingBottom: spacing['2xl'],
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
    backgroundColor: colors.backgroundDeep,
  },
  dobLabel: {
    marginBottom: spacing.xs,
  },
  dobPickerContainer: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  dobPicker: {
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  sectionCaption: { marginBottom: spacing.base },
  emergencyCard: {
    borderRadius: radii.xl,
    padding: spacing.base,
    marginBottom: spacing.xl,
  },
  ctaSection: { marginTop: spacing.sm },
  errorText: { textAlign: 'center', marginTop: spacing.sm },
  pickContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
});
