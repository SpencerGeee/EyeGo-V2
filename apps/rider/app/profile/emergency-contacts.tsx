import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setContacts(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const persistContacts = async (updated: Contact[]) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setContacts(updated);
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Emergency Contacts</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
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
              <Text
                variant="labelSmall"
                style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
              >
                SAVED CONTACTS
              </Text>
              <View style={styles.card}>
                {contacts.map((contact, index) => (
                  <React.Fragment key={contact.id}>
                    {index > 0 && <View style={styles.divider} />}
                    <View style={styles.row}>
                      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '22' }]}>
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
                      <TouchableOpacity
                        onPress={() => handleDelete(contact.id)}
                        activeOpacity={0.7}
                        style={styles.deleteBtn}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </>
          )}

          {contacts.length < MAX_CONTACTS && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 300 }}
              style={{ marginTop: spacing['2xl'] }}
            >
              <Text
                variant="labelSmall"
                style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}
              >
                ADD CONTACT
              </Text>
              <View style={styles.formCard}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Full name"
                  placeholderTextColor={colors.onSurfaceVariant}
                  style={[
                    styles.input,
                    { color: colors.onSurface, borderColor: colors.outlineVariant },
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
                    { color: colors.onSurface, borderColor: colors.outlineVariant },
                  ]}
                />
                <Button label={saving ? 'Saving...' : 'Save Contact'} onPress={handleAdd} variant="primary" disabled={saving} />
              </View>
            </MotiView>
          )}

          {contacts.length >= MAX_CONTACTS && (
            <View style={styles.limitNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Maximum of {MAX_CONTACTS} emergency contacts reached.
              </Text>
            </View>
          )}
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    sectionLabel: { letterSpacing: 1, marginBottom: spacing.base },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.base,
    },
    divider: { height: 1, backgroundColor: colors.outlineVariant, marginHorizontal: spacing.base },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing['3xl'],
    },
    formCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      padding: spacing.base,
      gap: spacing.base,
    },
    input: {
      height: 50,
      borderWidth: 1,
      borderRadius: radii.xl,
      paddingHorizontal: spacing.base,
      fontSize: 15,
    },
    limitNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing['2xl'],
    },
  });
