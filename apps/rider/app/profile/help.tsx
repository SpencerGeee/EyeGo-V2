import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, queryKeys } from '@eyego/api';
import type { Booking } from '@eyego/types';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';

const FAQ_ITEMS = [
  {
    id: '1',
    question: 'How does EyeGo work?',
    answer:
      'EyeGo connects you with shared vans running fixed routes across Accra. Browse available rides, pick your seat, pay securely, and track your driver in real time. The more passengers share a ride, the lower the fare drops for everyone.',
  },
  {
    id: '2',
    question: 'Can I book a trip for a group?',
    answer:
      'Yes! On the Ride Details screen, tap "Book & invite my group" to open the Group Hub, where you can share an invite link with friends. Members who join through the link will ride in the same vehicle.',
  },
  {
    id: '3',
    question: 'How do split fares work for group bookings?',
    answer:
      'When you create a group, you can toggle "I\'m paying for everyone" in the Group Settings to put all seats on your checkout. Otherwise, the booking behaves as a split fare trip, allowing members to book and pay for their own seats individually.',
  },
  {
    id: '4',
    question: 'Is there a surcharge for heavy luggage or cargo?',
    answer:
      'Yes, if you or your group are carrying heavy luggage or bulky cargo, you can select the "Heavy cargo in group" setting in the Group Settings. This adds a flat surcharge of GHS 10.00 to the ride.',
  },
  {
    id: '5',
    question: 'How is my fare calculated?',
    answer:
      'Fares start at a base rate per seat and decrease as more passengers book the same trip. You always see the current price before confirming. Economy and Comfort tiers have different base rates.',
  },
  {
    id: '6',
    question: 'What if my driver doesn\'t show?',
    answer:
      'If your driver hasn\'t arrived within 10 minutes of the scheduled time, you\'ll receive an automatic notification. You can cancel for a full refund directly from the tracking screen or contact our support team.',
  },
  {
    id: '7',
    question: 'How do I cancel a booking?',
    answer:
      'Go to Trips → tap your booking → select Cancel. Cancellations made more than 15 minutes before departure receive a full refund. Cancellations within 15 minutes may incur a small fee.',
  },
  {
    id: '8',
    question: 'Is my payment secure?',
    answer:
      'Yes. All payments are processed by Paystack, a PCI-DSS Level 1 certified payment gateway. EyeGo never stores your card details. MoMo payments are handled through the official network APIs.',
  },
];

const CONTACT_OPTIONS = [
  {
    id: 'whatsapp',
    icon: 'logo-whatsapp' as const,
    label: 'Chat on WhatsApp',
    color: '#25D366',
    onPress: () => Linking.openURL('https://wa.me/233XXXXXXXXX?text=Hi%20EyeGo%20Support'),
  },
  {
    id: 'email',
    icon: 'mail-outline' as const,
    label: 'Email Support',
    color: '#4BE277',
    onPress: () => Linking.openURL('mailto:support@eyego.app'),
  },
  {
    id: 'phone',
    icon: 'call-outline' as const,
    label: 'Call Support',
    color: '#4BE277',
    onPress: () => Linking.openURL('tel:+233XXXXXXXXX'),
  },
];

export default function HelpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['60%', '92%'], []);
  
  const [ticketCategory, setTicketCategory] = useState<'General Support' | 'Dispute' | 'Lost Item'>('General Support');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [lostItemDesc, setLostItemDesc] = useState('');
  const [disputeReason, setDisputeReason] = useState('Fare discrepancy');
  const [tickets, setTickets] = useState<Array<{id: string; subject: string; category: string; status: string; date: string; message: string; tripId?: string | null; lostItemDesc?: string; disputeReason?: string}>>([]);

  const { data: bookingsData } = useQuery({
    queryKey: queryKeys.bookings.myHistory(),
    queryFn: () => bookingsApi.getHistory({ limit: 50 }),
  });
  
  const myTrips = useMemo(() => {
    return (bookingsData?.data?.data?.bookings ?? []) as Booking[];
  }, [bookingsData]);

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      const stored = await AsyncStorage.getItem('@eyego_support_tickets');
      if (stored) {
        setTickets(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load tickets', e);
    }
  };

  const saveTickets = async (newTickets: typeof tickets) => {
    try {
      await AsyncStorage.setItem('@eyego_support_tickets', JSON.stringify(newTickets));
      setTickets(newTickets);
    } catch (e) {
      console.error('Failed to save tickets', e);
    }
  };

  const toggle = (id: string) => {
    setOpenItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenTickets = () => {
    bottomSheetRef.current?.expand();
  };

  const handleSubmitTicket = () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) return;
    
    let subjectLine = ticketSubject.trim();
    if (ticketCategory === 'Lost Item') {
      subjectLine = `Lost Item: ${ticketSubject.trim()}`;
    } else if (ticketCategory === 'Dispute') {
      subjectLine = `Dispute (${disputeReason}): ${ticketSubject.trim()}`;
    }

    const newTicket = {
      id: Date.now().toString(),
      subject: subjectLine,
      category: ticketCategory,
      tripId: selectedTripId,
      lostItemDesc: ticketCategory === 'Lost Item' ? lostItemDesc : undefined,
      disputeReason: ticketCategory === 'Dispute' ? disputeReason : undefined,
      status: 'Open',
      date: new Date().toISOString().split('T')[0],
      message: ticketMessage.trim(),
    };

    const updated = [newTicket, ...tickets];
    saveTickets(updated as any);
    
    setTicketSubject('');
    setTicketMessage('');
    setLostItemDesc('');
    setSelectedTripId(null);
    setTicketCategory('General Support');
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Help & Support</Text>
        <TouchableOpacity onPress={handleOpenTickets} style={styles.ticketsBtn}>
          <Ionicons name="ticket-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* FAQ Section */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            FREQUENTLY ASKED
          </Text>

          <View style={styles.faqCard}>
            {FAQ_ITEMS.map((item, index) => (
              <View key={item.id}>
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={styles.faqRow}
                >
                  <Text variant="bodyMedium" color={colors.onSurface} style={styles.faqQuestion}>
                    {item.question}
                  </Text>
                  <MotiView
                    animate={{ rotate: openItems.has(item.id) ? '180deg' : '0deg' }}
                    transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                  >
                    <Ionicons name="chevron-down" size={18} color={colors.onSurfaceVariant} />
                  </MotiView>
                </Pressable>

                {openItems.has(item.id) && (
                  <MotiView
                    from={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: undefined }}
                    transition={{ type: 'spring', stiffness: 600, damping: 34 }}
                    style={styles.faqAnswer}
                  >
                    <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ lineHeight: 20 }}>
                      {item.answer}
                    </Text>
                  </MotiView>
                )}

                {index < FAQ_ITEMS.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        </MotiView>

        {/* Contact Section */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            CONTACT US
          </Text>

          <View style={styles.contactCard}>
            {CONTACT_OPTIONS.map((option, index) => (
              <View key={option.id}>
                <Pressable onPress={option.onPress} style={styles.contactRow}>
                  <View style={[styles.contactIcon, { backgroundColor: option.color + '20' }]}>
                    <Ionicons name={option.icon} size={20} color={option.color} />
                  </View>
                  <Text variant="bodyMedium" color={colors.onSurface} style={{ flex: 1 }}>
                    {option.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
                </Pressable>
                {index < CONTACT_OPTIONS.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        </MotiView>

        {/* Response time note */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 110 }}
          style={styles.noteRow}
        >
          <Ionicons name="time-outline" size={14} color={colors.onSurfaceVariant} />
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginLeft: spacing.xs }}>
            We typically respond within 2 hours during business hours
          </Text>
        </MotiView>
      </ScrollView>

      {/* My Tickets Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backgroundStyle={{
          backgroundColor: colors.background,
          borderTopLeftRadius: radii['3xl'],
          borderTopRightRadius: radii['3xl'],
        }}
        handleIndicatorStyle={styles.sheetHandle}
        enablePanDownToClose={true}
      >
        <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
          <Text variant="titleMedium" style={{ marginBottom: spacing.md, color: colors.onSurface }}>
            My Tickets
          </Text>
          
          <View style={styles.newTicketCard}>
            <Text variant="label" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.sm }}>
              OPEN NEW RESOLUTION TICKET
            </Text>

            {/* Category Segment Control */}
            <View style={styles.categoryRow}>
              {(['General Support', 'Dispute', 'Lost Item'] as const).map((cat) => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setTicketCategory(cat)}
                  style={[
                    styles.categoryChip,
                    ticketCategory === cat && { backgroundColor: colors.primary },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: fonts.semiBold,
                      color: ticketCategory === cat ? colors.onPrimary : colors.onSurfaceVariant,
                    }}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Associated Trip Picker for Disputes and Lost Items */}
            {ticketCategory !== 'General Support' && (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="label" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xs }}>
                  SELECT ASSOCIATED TRIP
                </Text>
                {myTrips.length === 0 ? (
                  <Text variant="caption" color={colors.error} style={{ marginVertical: spacing.xs }}>
                    No recent trips found to associate.
                  </Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 4 }}>
                    {myTrips.map((b) => (
                      <TouchableOpacity
                        key={b.id}
                        onPress={() => setSelectedTripId(b.tripId)}
                        style={[
                          styles.tripPill,
                          selectedTripId === b.tripId && { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
                        ]}
                      >
                        <Text style={{ fontSize: 11, fontFamily: fonts.medium, color: colors.onSurface }}>
                          {b.trip?.route?.originName?.split(',')[0]} → {b.trip?.route?.destinationName?.split(',')[0]}
                        </Text>
                        <Text style={{ fontSize: 9, fontFamily: fonts.regular, color: colors.onSurfaceVariant }}>
                          {b.trip?.departureTime ? new Date(b.trip.departureTime).toLocaleDateString() : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}

            {/* Dispute specific reasons */}
            {ticketCategory === 'Dispute' && (
              <View style={{ marginTop: spacing.md }}>
                <Text variant="label" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xs }}>
                  DISPUTE REASON
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingVertical: 4 }}>
                  {['Fare discrepancy', 'Driver behavior', 'Route issue', 'Cleanliness', 'Other'].map((reason) => (
                    <TouchableOpacity
                      key={reason}
                      onPress={() => setDisputeReason(reason)}
                      style={[
                        styles.tripPill,
                        disputeReason === reason && { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
                      ]}
                    >
                      <Text style={{ fontSize: 11, fontFamily: fonts.medium, color: colors.onSurface }}>
                        {reason}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Lost Item specific description */}
            {ticketCategory === 'Lost Item' && (
              <View style={{ marginTop: spacing.md }}>
                <TextInput
                  style={styles.input}
                  placeholder="What item did you lose? (e.g. Black keys, iPhone)"
                  placeholderTextColor={colors.onSurfaceVariant}
                  value={lostItemDesc}
                  onChangeText={setLostItemDesc}
                />
              </View>
            )}

            <TextInput
              style={[styles.input, { marginTop: spacing.sm }]}
              placeholder="Subject / Summary"
              placeholderTextColor={colors.onSurfaceVariant}
              value={ticketSubject}
              onChangeText={setTicketSubject}
            />

            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top', marginTop: spacing.sm }]}
              placeholder="Describe your issue in detail..."
              placeholderTextColor={colors.onSurfaceVariant}
              value={ticketMessage}
              onChangeText={setTicketMessage}
              multiline
            />
            
            <Button
              label="Submit Ticket"
              onPress={handleSubmitTicket}
              disabled={
                !ticketSubject.trim() || 
                !ticketMessage.trim() || 
                (ticketCategory === 'Lost Item' && !lostItemDesc.trim())
              }
              style={{ marginTop: spacing.md }}
            />
          </View>

          <Text variant="label" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>
            PREVIOUS TICKETS
          </Text>

          {tickets.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing['2xl'] }}>
              <Ionicons name="help-circle-outline" size={40} color={colors.onSurfaceVariant} />
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.sm }}>
                No support tickets yet. Use the form below to get help.
              </Text>
            </View>
          ) : (
            tickets.map((ticket) => (
              <View key={ticket.id} style={styles.ticketItem}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyMedium" color={colors.onSurface} style={{ fontFamily: fonts.semiBold }}>
                    {ticket.subject}
                  </Text>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={2}>
                    {ticket.message}
                  </Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>{ticket.date}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: ticket.status === 'Open' ? colors.primary + '20' : colors.surfaceContainerHigh }]}>
                  <Text variant="caption" color={ticket.status === 'Open' ? colors.primary : colors.onSurfaceVariant}>
                    {ticket.status}
                  </Text>
                </View>
              </View>
            ))
          )}
        </BottomSheetScrollView>
      </BottomSheet>
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
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.base,
  },
  faqCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  faqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    gap: spacing.sm,
  },
  faqQuestion: { flex: 1, lineHeight: 20 },
  faqAnswer: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.base,
  },
  contactCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    gap: spacing.base,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing['2xl'],
  },
  ticketsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii['3xl'],
    borderTopRightRadius: radii['3xl'],
  },
  sheetHandle: {
    backgroundColor: colors.outline,
    width: 40,
    height: 4,
  },
  sheetContent: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  newTicketCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  categoryRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xl,
    padding: 4,
    marginBottom: spacing.md,
    gap: 4,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: radii.lg,
  },
  tripPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    height: 48,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  ticketItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    padding: spacing.base,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
});
