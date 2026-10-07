import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, Pressable, Modal, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { userApi } from '@eyego/api';
import { fonts } from '@eyego/config';
import { Text, Button, Input, Screen, ListSection, ListRow, goBack, goDeeper, notify } from '@eyego/ui';
import { getInitials, formatPhone, describeError } from '@eyego/utils';
import { useAuthStore } from '../../stores/auth.store';
import { useColors, Colors } from '../../utils/useColors';

/** Riders must be 16 or over (Terms §3). */
const MAX_DOB = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 16);
  return d;
};

/** Stored as "dd / mm / yyyy" — the shape register.tsx and the server use. */
const formatDob = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')} / ${String(d.getMonth() + 1).padStart(2, '0')} / ${d.getFullYear()}`;
const parseDob = (s?: string | null): Date | null => {
  const p = String(s ?? '').split(' / ');
  return p.length === 3 ? new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)) : null;
};

/**
 * EDIT PROFILE — photo, name, email, date of birth.
 *
 * Two bugs went with the rewrite:
 *  - An inline date spinner: on Android the picker is a dialog, so mounting
 *    it opened a calendar the moment this screen did. It opens on tap now.
 *  - An "Emergency contact" pair that saved through the full-replace contacts
 *    endpoint, so saving your profile deleted every trusted contact but one.
 *    Trusted contacts have their own page; this links to it.
 */
export default function EditProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuthStore();
  const qc = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState((user as any)?.email ?? '');
  const [dob, setDob] = useState<string>((user as any)?.dob ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [iosPicker, setIosPicker] = useState(false);
  const [iosTemp, setIosTemp] = useState<Date>(new Date(2000, 0, 1));

  // Adopt the profile when it arrives, unless the rider has started typing —
  // a late refetch must never overwrite what they're editing.
  const dirty = useRef(false);
  useEffect(() => {
    if (dirty.current || !user) return;
    const u = user as any;
    if (u.name) setName(u.name);
    if (u.email) setEmail(u.email);
    if (u.dob) setDob(u.dob);
  }, [user]);

  const openDob = () => {
    const current = parseDob(dob) ?? new Date(2000, 0, 1);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        maximumDate: MAX_DOB(),
        minimumDate: new Date(1900, 0, 1),
        onChange: (e, d) => {
          if (e.type === 'set' && d) {
            dirty.current = true;
            setDob(formatDob(d));
          }
        },
      });
    } else {
      setIosTemp(current);
      setIosPicker(true);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      notify('Photos are off', 'Allow access to your photos in Settings to choose a picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      dirty.current = true;
      setAvatarUri(result.assets[0].uri);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const avatarUrl = avatarUri ? await userApi.uploadAvatar(avatarUri) : undefined;
      const { data } = await userApi.updateProfile({
        name: name.trim(),
        email: email.trim() || undefined,
        dob: dob.trim() || undefined,
        avatarUrl,
      } as any);
      return data.data;
    },
    onSuccess: (updated) => {
      updateUser(updated);
      qc.invalidateQueries({ queryKey: ['user', 'profile'] });
      // The checklist is derived from the profile — refresh it, or the Account
      // tab keeps asking for the email that was just added.
      qc.invalidateQueries({ queryKey: ['user', 'account-checklist'] });
      notify('Profile updated', undefined, { tone: 'success' });
      goBack();
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'Could not save your profile. Check your connection and try again.');
      notify(title, message);
    },
  });

  const handleSave = () => {
    if (name.trim().length < 2) {
      setNameError('Enter your full name');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('That email doesn’t look right');
      return;
    }
    save.mutate();
  };

  const avatar = avatarUri ?? user?.avatarUrl ?? null;

  return (
    <>
      <Screen
        title="Edit profile"
        keyboard
        footer={<Button label="Save" onPress={handleSave} disabled={name.trim().length < 2 || save.isPending} loading={save.isPending} fullWidth />}
      >
        <View style={styles.avatarWrap}>
          <Pressable onPress={pickImage} accessibilityRole="button" accessibilityLabel="Change profile photo">
            <View style={styles.avatar}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Text style={styles.initials}>{name ? getInitials(name) : '?'}</Text>
              )}
            </View>
            <View style={styles.badge}>
              <Ionicons name="camera" size={14} color={colors.onPrimary} />
            </View>
          </Pressable>
          <Text style={styles.hint}>Your driver sees this at pickup.</Text>
        </View>

        <View style={styles.fields}>
          <Input
            label="Full name"
            value={name}
            onChangeText={(t) => { dirty.current = true; setName(t); setNameError(''); }}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            error={nameError}
          />
          <Input
            label="Email (optional)"
            value={email}
            onChangeText={(t) => { dirty.current = true; setEmail(t); setEmailError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="done"
            error={emailError}
          />
        </View>

        <ListSection>
          <ListRow icon="calendar-outline" title="Date of birth" value={dob ? dob.replace(/ \/ /g, '/') : 'Add'} onPress={openDob} />
          <ListRow
            icon="call-outline"
            title="Phone number"
            value={user?.phone ? formatPhone(user.phone) : '—'}
            right={<Ionicons name="checkmark-circle" size={18} color={colors.statusSuccess} />}
          />
        </ListSection>

        <ListSection footer="Your phone number is how you sign in, so it can’t be changed here.">
          <ListRow icon="people-outline" title="Trusted contacts" subtitle="Who we alert in an emergency" onPress={() => goDeeper('/profile/emergency-contacts')} />
        </ListSection>
      </Screen>

      {/* iOS date sheet. Android uses the system dialog (openDob). */}
      {Platform.OS === 'ios' ? (
        <Modal visible={iosPicker} transparent animationType="slide" onRequestClose={() => setIosPicker(false)}>
          <Pressable style={styles.overlay} onPress={() => setIosPicker(false)} accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.sheetBar}>
              <Pressable onPress={() => setIosPicker(false)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.sheetCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.sheetTitle}>Date of birth</Text>
              <Pressable
                onPress={() => {
                  dirty.current = true;
                  setDob(formatDob(iosTemp));
                  setIosPicker(false);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.sheetDone}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={iosTemp}
              mode="date"
              display="spinner"
              maximumDate={MAX_DOB()}
              minimumDate={new Date(1900, 0, 1)}
              onChange={(_e, d) => d && setIosTemp(d)}
              textColor={colors.onSurface}
              style={{ alignSelf: 'stretch' }}
            />
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    avatarWrap: { alignItems: 'center', marginTop: 8, gap: 12 },
    avatar: { width: 104, height: 104, borderRadius: 52, overflow: 'hidden', backgroundColor: c.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
    initials: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 42, color: c.onSurface },
    badge: {
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
    hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant },
    fields: { paddingHorizontal: 20, marginTop: 24, gap: 16 },
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surfaceContainerHigh, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
    sheetBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
    sheetTitle: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 21, color: c.onSurface },
    sheetCancel: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 21, color: c.onSurfaceVariant },
    sheetDone: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 21, color: c.primary },
  });
