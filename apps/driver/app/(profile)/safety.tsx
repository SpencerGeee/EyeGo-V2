import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput, Alert, Linking, Modal, FlatList } from 'react-native';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, AppBackground } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const SAFETY_TIPS = [
  { icon: 'lock-closed-outline' as const,     tip: 'Keep your doors locked until a passenger shows their verified QR code.' },
  { icon: 'eye-outline' as const,              tip: 'Verify passenger identity matches the booking name before departure.' },
  { icon: 'phone-portrait-outline' as const,  tip: 'Keep your phone charged and visible on its mount at all times.' },
  { icon: 'shield-outline' as const,          tip: 'Trust your instincts — you have the right to cancel any trip that makes you uncomfortable.' },
  { icon: 'map-outline' as const,             tip: 'Always follow the designated route. Notify EyeGo if asked to deviate.' },
];

export default function SafetyScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const qc = useQueryClient();
  const driver = useDriverStore((s) => s.driver);
  const updateDriver = useDriverStore((s) => s.updateDriver);
  const activeTripId = useDriverStore((s) => s.activeTripId);

  const existing = driver?.emergencyContact;
  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [relationship, setRelationship] = useState(existing?.relationship ?? '');
  const [editing, setEditing] = useState(!existing);
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
    setContactList(data.filter((c) => c.name && c.phoneNumbers?.length));
    setShowContactPicker(true);
  };

  const selectContact = (contact: Contacts.Contact) => {
    setName(contact.name ?? '');
    setPhone(contact.phoneNumbers?.[0]?.number?.replace(/\s/g, '') ?? '');
    setShowContactPicker(false);
  };

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setPhone(existing.phone);
      setRelationship(existing.relationship);
    }
  }, [existing]);

  const saveContact = useMutation({
    mutationFn: () => driverApi.updateEmergencyContact({ name: name.trim(), phone: phone.trim(), relationship: relationship.trim() }),
    onSuccess: () => {
      updateDriver({ emergencyContact: { name: name.trim(), phone: phone.trim(), relationship: relationship.trim() } });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
    },
    onError: (err) => Alert.alert('Error', (err as Error).message),
  });

  const renderContactItem = useCallback(({ item }: { item: Contacts.Contact }) => (
    <Pressable
      onPress={() => selectContact(item)}
      style={{ padding: spacing['2xl'], borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}
    >
      <Text variant="bodyMedium">{item.name}</Text>
      <Text variant="caption" color={colors.onSurfaceVariant}>{item.phoneNumbers?.[0]?.number ?? ''}</Text>
    </Pressable>
  ), [selectContact, colors]);

  const canSave = name.trim().length > 1 && phone.trim().length >= 9 && relationship.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}>
          <Text variant="headlineLarge" style={styles.headline}>Safety</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xs }}>
            Emergency tools and safe-driving guidelines.
          </Text>
        </MotiView>

        {/* SOS / Emergency call */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 80 }}
          style={styles.sosCard}>
          <View style={styles.sosGlow} />
          <Ionicons name="warning" size={28} color={colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.error }]}>Emergency SOS</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Calls 191 (Ghana Police){activeTripId ? ' and shares your live location with your emergency contact' : ''}.
            </Text>
          </View>
          <Pressable
            style={styles.sosBtn}
            onPress={() => Alert.alert(
              'Emergency SOS',
              'This will call Ghana Police (191). Are you in immediate danger?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Call 191',
                  style: 'destructive',
                  onPress: async () => {
                    if (activeTripId) {
                      try {
                        const pos = await Location.getLastKnownPositionAsync();
                        await driverApi.emergencyAlert(activeTripId, {
                          latitude: pos?.coords.latitude,
                          longitude: pos?.coords.longitude,
                          timestamp: new Date().toISOString(),
                        });
                      } catch {
                        // Never block the actual emergency call on this
                      }
                    }
                    Linking.openURL('tel:191');
                  },
                },
              ]
            )}
          >
            <Text style={styles.sosBtnText}>SOS</Text>
          </Pressable>
        </MotiView>

        {/* Emergency contact */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
          style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Emergency Contact</Text>
            {!editing && existing && (
              <Pressable onPress={() => setEditing(true)} style={styles.editBtn}>
                <Ionicons name="create-outline" size={16} color={colors.primary} />
                <Text style={styles.editBtnText}>Edit</Text>
              </Pressable>
            )}
          </View>

          {!editing && existing ? (
            <View style={styles.contactDisplay}>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactInitial}>{existing.name[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName}>{existing.name}</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>{existing.relationship}</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>{existing.phone}</Text>
              </View>
              <Pressable onPress={() => Linking.openURL(`tel:${existing.phone}`)}>
                <View style={styles.callBtn}>
                  <Ionicons name="call-outline" size={16} color={colors.primary} />
                </View>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: spacing.md }}>
              <Pressable
                onPress={handlePickContact}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.primary + '15', borderRadius: radii.md, alignSelf: 'flex-start', marginBottom: spacing.sm }}
              >
                <Ionicons name="people-outline" size={16} color={colors.primary} />
                <Text variant="label" color={colors.primary}>Pick from Contacts</Text>
              </Pressable>
              <View>
                <Text variant="caption" color={colors.onSurfaceVariant} style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Ama Owusu"
                  placeholderTextColor={colors.onSurfaceVariant}
                  selectionColor={colors.primary}
                />
              </View>
              <View>
                <Text variant="caption" color={colors.onSurfaceVariant} style={styles.inputLabel}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+233 XX XXX XXXX"
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType="phone-pad"
                  selectionColor={colors.primary}
                />
              </View>
              <View>
                <Text variant="caption" color={colors.onSurfaceVariant} style={styles.inputLabel}>Relationship</Text>
                <TextInput
                  style={styles.input}
                  value={relationship}
                  onChangeText={setRelationship}
                  placeholder="e.g. Spouse, Parent, Sibling"
                  placeholderTextColor={colors.onSurfaceVariant}
                  selectionColor={colors.primary}
                />
              </View>
              <Button
                label="Save Contact"
                onPress={() => saveContact.mutate()}
                loading={saveContact.isPending}
                disabled={!canSave || saveContact.isPending}
                size="md"
              />
              {editing && existing && (
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => setEditing(false)}
                  size="md"
                />
              )}
            </View>
          )}
        </MotiView>

        {/* Safety tips */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 160 }}
          style={styles.card}>
          <Text style={styles.cardTitle}>Safety Tips</Text>
          {SAFETY_TIPS.map((tip, i) => (
            <MotiView
              key={i}
              from={{ opacity: 0, translateX: -8 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 180 + i * 60 }}
              style={[styles.tipRow, i < SAFETY_TIPS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}
            >
              <View style={styles.tipIcon}>
                <Ionicons name={tip.icon} size={16} color={colors.primary} />
              </View>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ flex: 1, lineHeight: 21 }}>
                {tip.tip}
              </Text>
            </MotiView>
          ))}
        </MotiView>

        {/* Support */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 200 }}>
          <Pressable
            style={styles.supportRow}
            onPress={() => Linking.openURL('tel:+233302000000')}
          >
            <View style={styles.tipIcon}>
              <Ionicons name="headset-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>24/7 Driver Support</Text>
              <Text variant="caption" color={colors.onSurfaceVariant}>+233 30 200 0000</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </MotiView>
      </ScrollView>

      {/* Contact Picker Modal */}
      <Modal visible={showContactPicker} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing['2xl'] }}>
            <Text variant="titleMedium">Select Emergency Contact</Text>
            <Pressable onPress={() => setShowContactPicker(false)}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <FlatList
            data={contactList}
            keyExtractor={(item, index) => item.name ?? String(index)}
            renderItem={renderContactItem}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.xl },
    headline: { letterSpacing: -1 },
    sosCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: `${colors.error}14`,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: `${colors.error}44`,
      padding: spacing.xl,
      overflow: 'hidden',
    },
    sosGlow: {
      position: 'absolute',
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.error,
      opacity: 0.07,
      right: -20,
    },
    sosBtn: {
      backgroundColor: colors.error,
      borderRadius: radii.lg,
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sosBtnText: { fontFamily: fonts.displayBold, fontSize: 14, lineHeight: 18, color: '#fff', letterSpacing: 0.5 },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
    cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.titleSmall, lineHeight: Math.round(fontSizes.titleSmall * 1.3), color: colors.onSurface },
    editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    editBtnText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall ?? 12, lineHeight: Math.round((fontSizes.bodySmall ?? 12) * 1.3), color: colors.primary },
    contactDisplay: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    contactAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: `${colors.primary}22`,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactInitial: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 23, color: colors.primary },
    contactName: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3), color: colors.onSurface },
    callBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: `${colors.primary}18`,
      borderWidth: 1,
      borderColor: `${colors.primary}44`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inputLabel: { marginBottom: spacing.xs },
    input: {
      height: 48,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.base,
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
    },
    tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md },
    tipIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: `${colors.primary}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    supportRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.base,
    },
  });
