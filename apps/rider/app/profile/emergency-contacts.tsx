import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { fonts, spacing, radii, withOpacity } from '@eyego/config';
import { Text, Button, GlassSurface } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { userApi } from '@eyego/api';
import { offlineQueue } from '../../utils/offlineQueue';
import { useToastStore } from '../../stores/toast.store';

const STORAGE_KEY = 'eyego_emergency_contacts';
const MAX_CONTACTS = 3;

interface Contact {
  id: string;
  name: string;
  phone: string;
}

export default function EmergencyContactsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const loadContacts = useCallback(async () => {
    try {
      // Prefer server-side contacts; fall back to local cache if offline
      const res = await userApi.getEmergencyContacts();
      const serverContacts: Contact[] = (res.data as any)?.data?.contacts ?? [];
      setContacts(serverContacts);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serverContacts));
    } catch {
      // Offline fallback — load from cache
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setContacts(JSON.parse(raw));
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const persistContacts = async (updated: Contact[]) => {
    // Optimistically update UI
    setContacts(updated);
    // Sync to server; update cache regardless of outcome
    try {
      const res = await userApi.syncEmergencyContacts(
        updated.map(({ name, phone }) => ({ name, phone }))
      );
      const saved: Contact[] = (res.data as any)?.data?.contacts ?? updated;
      setContacts(saved);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Server sync failed — keep local state, cache what we have
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
      // loadContacts() prefers the server copy, so without a queued retry the
      // next screen open would silently REVERT this edit — and server-side SOS
      // SMS would go to the old contacts. PUT is a full replace; keep only the
      // newest queued list.
      offlineQueue.enqueue(
        'CONTACT_SYNC',
        '/user/me/emergency-contacts',
        'PUT',
        { contacts: updated.map(({ name, phone }) => ({ name, phone })) },
        { replaceSameType: true }
      );
      useToastStore.getState().show("Saved on this phone — will sync to your account when you're back online.", 'warning');
    }
  };

  const handlePickContact = async () => {
    if (contacts.length >= MAX_CONTACTS) {
      Alert.alert('Limit Reached', `You can only save up to ${MAX_CONTACTS} emergency contacts.`);
      return;
    }
    try {
      // presentContactPickerAsync shows the OS's own contact-picker sheet and
      // only returns the one contact the user taps — no READ_CONTACTS
      // permission prompt needed, unlike getContactsAsync.
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return; // user cancelled
      const phone = picked.phoneNumbers?.[0]?.number?.trim();
      const name = picked.name?.trim();
      if (!phone) {
        Alert.alert('No Phone Number', 'That contact has no phone number saved.');
        return;
      }
      setNewName(name || '');
      setNewPhone(phone);
    } catch (e) {
      Alert.alert('Error', 'Could not open contacts. You can still enter the details manually below.');
    }
  };

  const handleAdd = async () => {
    const trimName = newName.trim();
    const trimPhone = newPhone.trim();
    if (!trimName || !trimPhone) {
      Alert.alert('Missing Info', 'Please enter both a name and phone number.');
      return;
    }
    if (contacts.length >= MAX_CONTACTS) {
      Alert.alert('Limit Reached', `You can only save up to ${MAX_CONTACTS} emergency contacts.`);
      return;
    }
    setSaving(true);
    try {
      const newContact: Contact = {
        id: Date.now().toString(),
        name: trimName,
        phone: trimPhone,
      };
      await persistContacts([...contacts, newContact]);
      setNewName('');
      setNewPhone('');
    } catch {
      Alert.alert('Error', 'Could not save contact. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Remove Contact', 'Are you sure you want to remove this contact?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await persistContacts(contacts.filter((c) => c.id !== id));
          } catch {
            Alert.alert('Error', 'Could not remove contact.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Emergency Contacts</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View
          >
          {contacts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={52} color={colors.onSurfaceVariant} />
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant, marginTop: spacing.base }}
              >
                No emergency contacts saved
              </Text>
            </View>
          ) : (
            <>
              <Text variant="labelCaps" style={styles.sectionLabel}>SAVED CONTACTS</Text>
              <GlassSurface borderRadius={radii.lg} intensity="low" dark style={styles.card}>
                {contacts.map((contact, index) => (
                  <React.Fragment key={contact.id}>
                    {index > 0 && <View style={styles.divider} />}
                    <View style={styles.row}>
                      <View style={[styles.iconWrap, { backgroundColor: withOpacity(colors.primary, 0.13) }]}>
                        <Ionicons name="person" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                          {contact.name}
                        </Text>
                        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                          {contact.phone}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => handleDelete(contact.id)}
                        style={styles.deleteBtn}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.statusError} />
                      </Pressable>
                    </View>
                  </React.Fragment>
                ))}
              </GlassSurface>
            </>
          )}

          {contacts.length < MAX_CONTACTS && (
            <View
              style={{ marginTop: spacing['2xl'] }}
            >
              <Text variant="labelCaps" style={styles.sectionLabel}>ADD CONTACT</Text>
              <GlassSurface borderRadius={radii.lg} intensity="low" dark style={styles.formCard}>
                <Pressable onPress={handlePickContact} style={[styles.pickContactBtn, { borderColor: colors.primary }]}>
                  <Ionicons name="people-outline" size={18} color={colors.primary} />
                  <Text variant="bodyMedium" style={{ color: colors.primary }}>Choose from Contacts</Text>
                </Pressable>
                <View style={styles.orDivider}>
                  <View style={[styles.orLine, { backgroundColor: colors.rimLightSubtle }]} />
                  <Text variant="caption" style={{ color: colors.onSurfaceVariant }}>or enter manually</Text>
                  <View style={[styles.orLine, { backgroundColor: colors.rimLightSubtle }]} />
                </View>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Full name"
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={[
                    styles.input,
                    { color: colors.onSurface, borderColor: colors.rimLight },
                  ]}
                />
                <TextInput
                  value={newPhone}
                  onChangeText={setNewPhone}
                  placeholder="Phone number"
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType="phone-pad"
                  style={[
                    styles.input,
                    { color: colors.onSurface, borderColor: colors.rimLight },
                  ]}
                />
                <Button label={saving ? 'Saving...' : 'Save Contact'} onPress={handleAdd} variant="primary" disabled={saving} />
              </GlassSurface>
            </View>
          )}

          {contacts.length >= MAX_CONTACTS && (
            <View style={styles.limitNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Maximum of {MAX_CONTACTS} emergency contacts reached.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['3xl'],
    },
    sectionLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 1.4,
      color: colors.outline,
      marginBottom: spacing.sm,
      marginLeft: spacing.xs,
    },
    card: {
      borderRadius: radii.lg,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.base,
    },
    divider: { height: 1, backgroundColor: colors.rimLightSubtle, marginHorizontal: spacing.base },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing['3xl'],
    },
    formCard: {
      borderRadius: radii.lg,
      padding: spacing.base,
      gap: spacing.base,
    },
    pickContactBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      height: 50,
      borderRadius: radii.lg,
      borderWidth: 1.5,
    },
    orDivider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    orLine: { flex: 1, height: 1 },
    input: {
      height: 50,
      borderWidth: 1,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      fontSize: 15,
      lineHeight: Math.round(15 * 1.4),
      backgroundColor: colors.surfaceInput,
      borderColor: colors.rimLightSubtle,
      color: colors.onSurface,
      fontFamily: fonts.regular,
    },
    limitNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing['2xl'],
    },
  });
