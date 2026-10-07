import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, Pressable, TextInput, Alert, Linking, Modal, FlatList } from 'react-native';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, goDeeper, notify, callNumber } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';
import { useDriverStore } from '../../stores/driver.store';
import { offlineQueue } from '../../utils/offlineQueue';

const TIPS: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }[] = [
  { icon: 'person-circle-outline', title: 'Confirm the rider', detail: 'Check the name and boarding code match the booking before you set off.' },
  { icon: 'lock-closed-outline', title: 'Doors stay locked', detail: 'Keep them locked until the rider is confirmed.' },
  { icon: 'phone-portrait-outline', title: 'Phone on the mount', detail: 'Charged and visible, so navigation and SOS are one tap away.' },
  { icon: 'hand-left-outline', title: 'You can say no', detail: 'Cancel any trip that makes you uncomfortable, then tell us why.' },
  { icon: 'map-outline', title: 'Stay on the route', detail: 'If a rider asks for a big detour, let EyeGo know.' },
];

type Contact = { name: string; phone: string; relationship: string };

/**
 * SAFETY (rival spec §18) — the emergency button first, then the person we
 * contact, then guidance. The support number used to be a made-up
 * "+233 30 200 0000"; it now comes from the console, and the row hides when
 * none is set.
 */
export default function SafetyScreen() {
  const { emergencyNumber, supportPhone } = usePlatformConfig();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const qc = useQueryClient();
  const storeDriver = useDriverStore((s) => s.driver);
  const updateDriver = useDriverStore((s) => s.updateDriver);
  const activeTripId = useDriverStore((s) => s.activeTripId);

  // The server copy wins — the store only knew what this phone had saved.
  const me = useQuery({
    queryKey: ['driver', 'me'],
    queryFn: () => driverApi.getMe(),
    select: (r) => (r.data as any).data?.driver ?? (r.data as any).data,
  });
  const existing: Contact | null = me.data?.emergencyContact ?? storeDriver?.emergencyContact ?? null;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [contactList, setContactList] = useState<Contacts.Contact[]>([]);

  useEffect(() => {
    if (existing && !editing) {
      setName(existing.name ?? '');
      setPhone(existing.phone ?? '');
      setRelationship(existing.relationship ?? '');
    }
  }, [existing?.name, existing?.phone, existing?.relationship, editing]);

  const pickContact = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      notify('Contacts are off', 'Allow access to contacts in Settings, or type the details in.');
      return;
    }
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      sort: Contacts.SortTypes.FirstName,
    });
    setContactList(data.filter((c) => c.name && c.phoneNumbers?.length));
    setPicker(true);
  };

  const save = useMutation({
    mutationFn: (c: Contact) => driverApi.updateEmergencyContact(c),
    onSuccess: (_r, c) => {
      updateDriver({ emergencyContact: c });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      notify('Emergency contact saved', undefined, { tone: 'success' });
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'Could not save your emergency contact.');
      notify(title, message);
    },
  });

  const digits = phone.replace(/[^\d+]/g, '');
  const canSave = name.trim().length > 1 && digits.replace(/\D/g, '').length >= 9 && relationship.trim().length > 0;

  const sos = () =>
    Alert.alert('Call emergency services?', `This calls ${emergencyNumber}. Are you in immediate danger?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Call ${emergencyNumber}`,
        style: 'destructive',
        onPress: async () => {
          if (activeTripId) {
            let pos: Location.LocationObject | null = null;
            try { pos = await Location.getLastKnownPositionAsync(); } catch { /* send without coords */ }
            const payload = { latitude: pos?.coords.latitude, longitude: pos?.coords.longitude, timestamp: new Date().toISOString() };
            try {
              await driverApi.emergencyAlert(activeTripId, payload);
            } catch {
              // Never block the call — but the alert must still reach dispatch.
              offlineQueue.enqueue('SOS', `/driver/trips/${activeTripId}/emergency`, 'POST', payload);
            }
          }
          void callNumber(emergencyNumber, { label: 'the emergency services' });
        },
      },
    ]);

  const showForm = editing || !existing;

  return (
    <>
      <Screen title="Safety" keyboard>
        <View style={styles.sosWrap}>
          <Pressable style={styles.sos} onPress={sos} accessibilityRole="button" accessibilityLabel={`Emergency. Call ${emergencyNumber}`}>
            <Ionicons name="warning" size={22} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.sosTitle}>Emergency · {emergencyNumber}</Text>
              <Text style={styles.sosSub}>
                {activeTripId ? 'Calls for help and alerts EyeGo with your location' : 'Calls the emergency services'}
              </Text>
            </View>
          </Pressable>
        </View>

        {showForm ? (
          <View style={styles.form}>
            <View style={styles.formHead}>
              <Text variant="labelCaps">Emergency contact</Text>
              <Pressable onPress={pickContact} hitSlop={8} accessibilityRole="button" style={styles.pickBtn}>
                <Ionicons name="people-outline" size={16} color={colors.primary} />
                <Text style={styles.pickText}>From contacts</Text>
              </Pressable>
            </View>
            <TextInput maxFontSizeMultiplier={1.4} style={styles.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="words" accessibilityLabel="Contact name" />
            <TextInput maxFontSizeMultiplier={1.4} style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone number" placeholderTextColor={colors.onSurfaceVariant} keyboardType="phone-pad" accessibilityLabel="Contact phone number" />
            <TextInput maxFontSizeMultiplier={1.4} style={styles.input} value={relationship} onChangeText={setRelationship} placeholder="Relationship, e.g. Sister" placeholderTextColor={colors.onSurfaceVariant} autoCapitalize="sentences" accessibilityLabel="Relationship" />
            <Button
              label="Save contact"
              onPress={() => save.mutate({ name: name.trim(), phone: digits, relationship: relationship.trim() })}
              loading={save.isPending}
              disabled={!canSave || save.isPending}
            />
            {existing ? <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} /> : null}
            <Text style={styles.note}>We contact them if you trigger an emergency during a trip.</Text>
          </View>
        ) : (
          <ListSection title="Emergency contact" footer="We contact them if you trigger an emergency during a trip.">
            <ListRow
              leading={
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{existing!.name?.[0]?.toUpperCase() ?? '?'}</Text>
                </View>
              }
              title={existing!.name}
              subtitle={[existing!.relationship, existing!.phone].filter(Boolean).join(' · ')}
              right={
                <Pressable onPress={() => Linking.openURL(`tel:${existing!.phone}`)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Call ${existing!.name}`} style={styles.callBtn}>
                  <Ionicons name="call" size={16} color={colors.primary} />
                </Pressable>
              }
            />
            <ListRow icon="create-outline" title="Change emergency contact" onPress={() => setEditing(true)} />
          </ListSection>
        )}

        <ListSection title="Staying safe">
          {TIPS.map((t) => (
            <ListRow key={t.title} icon={t.icon} title={t.title} subtitle={t.detail} subtitleLines={3} />
          ))}
        </ListSection>

        <ListSection title="Support">
          {supportPhone ? (
            <ListRow icon="headset-outline" title="Call EyeGo support" value={supportPhone} onPress={() => Linking.openURL(`tel:${supportPhone.replace(/\s/g, '')}`)} />
          ) : null}
          <ListRow icon="flag-outline" title="Report a safety issue" onPress={() => goDeeper('/(profile)/help')} />
        </ListSection>
      </Screen>

      <Modal visible={picker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalBar}>
            <Text style={styles.modalTitle}>Choose a contact</Text>
            <Pressable onPress={() => setPicker(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <FlatList
            data={contactList}
            keyExtractor={(item, i) => (item as any).id ?? `${item.name}-${i}`}
            renderItem={({ item }) => (
              <ListRow
                title={item.name ?? ''}
                subtitle={item.phoneNumbers?.[0]?.number ?? ''}
                chevron={false}
                onPress={() => {
                  setName(item.name ?? '');
                  setPhone(item.phoneNumbers?.[0]?.number?.replace(/\s/g, '') ?? '');
                  setPicker(false);
                }}
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No contacts with a phone number.</Text>}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    sosWrap: { paddingHorizontal: 20, marginTop: 8 },
    sos: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.error, borderRadius: radii.xl, paddingHorizontal: 18, paddingVertical: 16 },
    sosTitle: { fontFamily: fonts.semiBold, fontSize: 17, lineHeight: 22, color: '#fff' },
    sosSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
    form: { marginTop: 24, paddingHorizontal: 20, gap: 12 },
    formHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pickText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 18, color: c.primary },
    input: { fontFamily: fonts.medium, fontSize: 16, color: c.onSurface, backgroundColor: c.surfaceContainer, borderRadius: radii.lg, paddingHorizontal: 16, height: 52 },
    note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 20, color: c.onSurface },
    callBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
    modal: { flex: 1, backgroundColor: c.background },
    modalBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    modalTitle: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
    empty: { padding: 20, fontFamily: fonts.regular, fontSize: 15, color: c.onSurfaceVariant, textAlign: 'center' },
  });
