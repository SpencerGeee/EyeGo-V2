import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, TextInput, Alert, Linking } from 'react-native';
import * as Contacts from 'expo-contacts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { userApi } from '@eyego/api';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, SkeletonRows, notify } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { offlineQueue } from '../../utils/offlineQueue';
import { useToastStore } from '../../stores/toast.store';

const STORAGE_KEY = 'eyego_emergency_contacts';
const MAX_CONTACTS = 3;

interface Contact {
  id: string;
  name: string;
  phone: string;
}

/**
 * TRUSTED CONTACTS — up to three people we alert in an emergency (and text
 * your trip to, with Share my trip on). Server copy first, phone cache when
 * offline; an offline edit is queued, not lost.
 */
export default function EmergencyContactsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const queryClient = useQueryClient();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const loadContacts = useCallback(async () => {
    try {
      const res = await userApi.getEmergencyContacts();
      const serverContacts: Contact[] = (res.data as any)?.data?.contacts ?? [];
      setContacts(serverContacts);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serverContacts));
    } catch {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setContacts(JSON.parse(raw));
      } catch { /* nothing cached */ }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const persistContacts = async (updated: Contact[]) => {
    setContacts(updated);
    try {
      const res = await userApi.syncEmergencyContacts(updated.map(({ name, phone }) => ({ name, phone })));
      const saved: Contact[] = (res.data as any)?.data?.contacts ?? updated;
      setContacts(saved);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      // The SOS screen reads contacts through react-query.
      queryClient.invalidateQueries({ queryKey: ['user', 'emergency-contacts'] });
    } catch {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      // Without a queued retry the next open would revert this edit, and the
      // server's SOS texts would go to the old list. PUT is a full replace.
      offlineQueue.enqueue(
        'CONTACT_SYNC',
        '/user/me/emergency-contacts',
        'PUT',
        { contacts: updated.map(({ name, phone }) => ({ name, phone })) },
        { replaceSameType: true },
      );
      useToastStore.getState().show('Saved on this phone — it’ll sync when you’re back online.', 'warning');
    }
  };

  const pickContact = async () => {
    try {
      // The OS's own picker: one contact, no READ_CONTACTS prompt.
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;
      const phone = picked.phoneNumbers?.[0]?.number?.trim();
      if (!phone) {
        notify('No phone number', 'That contact has no phone number saved.');
        return;
      }
      setNewName(picked.name?.trim() || '');
      setNewPhone(phone);
    } catch {
      notify(null, 'Couldn’t open your contacts. You can type the details instead.');
    }
  };

  const digits = newPhone.replace(/\D/g, '');
  const canAdd = newName.trim().length > 1 && digits.length >= 9 && contacts.length < MAX_CONTACTS;

  const add = async () => {
    if (!canAdd) return;
    setSaving(true);
    try {
      await persistContacts([...contacts, { id: Date.now().toString(), name: newName.trim(), phone: newPhone.trim() }]);
      setNewName('');
      setNewPhone('');
    } finally {
      setSaving(false);
    }
  };

  const remove = (c: Contact) =>
    Alert.alert(`Remove ${c.name}?`, 'They won’t be alerted in an emergency.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void persistContacts(contacts.filter((x) => x.id !== c.id)) },
    ]);

  return (
    <Screen title="Trusted contacts" subtitle={`Up to ${MAX_CONTACTS} people we alert if you raise an emergency.`} keyboard>
      {loading ? (
        <SkeletonRows count={2} />
      ) : contacts.length > 0 ? (
        <ListSection title={`Saved · ${contacts.length} of ${MAX_CONTACTS}`}>
          {contacts.map((c) => (
            <ListRow
              key={c.id}
              leading={
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{c.name?.[0]?.toUpperCase() ?? '?'}</Text>
                </View>
              }
              title={c.name}
              subtitle={c.phone}
              right={
                <View style={styles.actions}>
                  <Pressable onPress={() => Linking.openURL(`tel:${c.phone.replace(/\s/g, '')}`)} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Call ${c.name}`}>
                    <Ionicons name="call-outline" size={18} color={colors.onSurface} />
                  </Pressable>
                  <Pressable onPress={() => remove(c)} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              }
            />
          ))}
        </ListSection>
      ) : (
        <ListSection footer="Add someone who’d want to know if something went wrong.">
          <ListRow icon="people-outline" title="No trusted contacts yet" />
        </ListSection>
      )}

      {contacts.length < MAX_CONTACTS ? (
        <View style={styles.form}>
          <View style={styles.formHead}>
            <Text variant="labelCaps">Add a contact</Text>
            <Pressable onPress={pickContact} hitSlop={8} accessibilityRole="button" style={styles.pick}>
              <Ionicons name="people-outline" size={16} color={colors.primary} />
              <Text style={styles.pickText}>From contacts</Text>
            </Pressable>
          </View>
          <TextInput
            maxFontSizeMultiplier={1.4}
            value={newName}
            onChangeText={setNewName}
            placeholder="Full name"
            placeholderTextColor={colors.onSurfaceVariant}
            autoCapitalize="words"
            style={styles.input}
            accessibilityLabel="Contact name"
          />
          <TextInput
            maxFontSizeMultiplier={1.4}
            value={newPhone}
            onChangeText={setNewPhone}
            placeholder="Phone number"
            placeholderTextColor={colors.onSurfaceVariant}
            keyboardType="phone-pad"
            style={styles.input}
            accessibilityLabel="Contact phone number"
          />
          <Button label="Add contact" onPress={add} loading={saving} disabled={!canAdd || saving} />
        </View>
      ) : null}
    </Screen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 20, color: c.onSurface },
    actions: { flexDirection: 'row', gap: 6 },
    iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
    form: { marginTop: 28, paddingHorizontal: 20, gap: 12 },
    formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pick: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pickText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 18, color: c.primary },
    input: { fontFamily: fonts.medium, fontSize: 16, color: c.onSurface, backgroundColor: c.surfaceContainer, borderRadius: radii.lg, paddingHorizontal: 16, height: 52 },
  });
