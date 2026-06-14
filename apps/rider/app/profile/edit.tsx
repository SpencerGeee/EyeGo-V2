import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import * as Contacts from 'expo-contacts';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { userApi } from '@eyego/api';
import { useAuthStore } from '../../stores/auth.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Input } from '@eyego/ui';
import { getInitials } from '@eyego/utils';
import { Ionicons } from '@expo/vector-icons';

export default function EditProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
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
      router.back();
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleSmall">Edit Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar */}
          <MotiView
            from={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
            style={styles.avatarSection}
          >
            <Pressable onPress={pickImage} style={styles.avatarContainer}>
              {avatarSource ? (
                <Image source={avatarSource} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>
                    {name ? getInitials(name) : '?'}
                  </Text>
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera-outline" size={14} color={colors.onPrimary} />
              </View>
            </Pressable>
            <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
              Tap to change photo
            </Text>
          </MotiView>

          {/* Name */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
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
          </MotiView>

          {/* Email */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 60 }}
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
          </MotiView>

          {/* Date of Birth */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
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
          </MotiView>

          {/* Emergency Contact */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 100 }}
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
            <View style={styles.emergencyCard}>
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
            </View>
          </MotiView>

          {/* Save */}
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 120 }}
            style={styles.ctaSection}
          >
            <Button
              label="Save Changes"
              onPress={handleSave}
              disabled={name.trim().length < 2}
              loading={saveProfile.isPending}
            />
            {saveProfile.isError && (
              <Text variant="caption" color={colors.error} style={styles.errorText}>
                Something went wrong. Please try again.
              </Text>
            )}
          </MotiView>
        </ScrollView>
      </KeyboardAvoidingView>
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
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing['2xl'],
  },
  avatarContainer: { position: 'relative', width: 100, height: 100 },
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
  },
  avatarInitials: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.headlineLarge,
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
  inputSection: { marginBottom: spacing.xl },
  dobLabel: {
    marginBottom: spacing.xs,
  },
  dobPickerContainer: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
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
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
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
