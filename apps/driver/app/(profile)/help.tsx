import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Pressable, Linking, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';

const TICKETS_KEY = 'eyego_driver_support_tickets';

type Ticket = {
  id: string;
  subject: string;
  message: string;
  createdAt: string;
  status: 'open' | 'resolved';
};

const FAQS = [
  {
    q: 'Why can\'t I go online?',
    a: 'Your account must be in ACTIVE status to go online. New accounts start as PENDING_REVIEW. Contact EyeGo support to get your account activated. You also need a minimum wallet balance to go online.',
  },
  {
    q: 'How do I receive payments?',
    a: 'Earnings from completed trips are automatically credited to your EyeGo wallet balance. You can withdraw your balance to your mobile money account from the Earnings tab (minimum GHS 20).',
  },
  {
    q: 'How do I add a passenger manually?',
    a: 'On the active trip screen, tap "Add Passenger". You can add a passenger by phone number (they receive an OTP) or as a cash passenger with no phone required.',
  },
  {
    q: 'What happens if my trip is cancelled?',
    a: 'If a trip is cancelled before departure, confirmed passengers are automatically refunded. Cancellations after departure are handled by EyeGo support on a case-by-case basis.',
  },
  {
    q: 'How is my rating calculated?',
    a: 'Your rating is the average of all passenger ratings left after completed trips. Maintaining a high rating improves your visibility and can qualify you for incentive bonuses.',
  },
];

function FaqItem({ q, a, colors }: { q: string; a: string; colors: DriverColors }) {
  const [open, setOpen] = useState(false);
  const height = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    maxHeight: withSpring(open ? 300 : 0, { stiffness: 300, damping: 30 }),
    overflow: 'hidden',
  }));

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: `${colors.outline}88` }}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md }}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={{ flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
          {q}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.onSurfaceVariant}
        />
      </TouchableOpacity>
      <Animated.View style={animStyle}>
        <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ paddingBottom: spacing.base, lineHeight: 22 }}>
          {a}
        </Text>
      </Animated.View>
    </View>
  );
}

export default function HelpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(TICKETS_KEY).then((val) => {
      if (val) {
        try { setTickets(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  const saveTickets = async (updated: Ticket[]) => {
    setTickets(updated);
    await AsyncStorage.setItem(TICKETS_KEY, JSON.stringify(updated));
  };

  const handleSubmitTicket = async () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) {
      Alert.alert('Required', 'Please fill in subject and message.');
      return;
    }
    const newTicket: Ticket = {
      id: Date.now().toString(),
      subject: ticketSubject.trim(),
      message: ticketMessage.trim(),
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    await saveTickets([newTicket, ...tickets]);
    setTicketSubject('');
    setTicketMessage('');
    setShowNewTicket(false);
    Alert.alert('Submitted', 'Your support ticket has been submitted. We\'ll respond within 2 hours.');
  };

  return (
    <SafeAreaView style={styles.safe}>
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
        <MotiView
          from={{ opacity: 0, translateY: -6 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        >
          <Text variant="headlineLarge" style={styles.headline}>Help & Support</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.subtext}>
            Answers to common questions.
          </Text>
        </MotiView>

        {/* FAQ accordion */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 80 }}
          style={styles.faqCard}
        >
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} colors={colors} />
          ))}
        </MotiView>

        {/* Support Tickets */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
          style={{ marginBottom: spacing.xl }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.sm, marginLeft: spacing.xs }}>MY TICKETS</Text>
          <Button
            label="Raise a Dispute"
            onPress={() => setShowNewTicket(true)}
            style={{ marginBottom: spacing.base }}
          />
          {tickets.length === 0 ? (
            <View style={{ alignItems: 'center', padding: spacing['2xl'], gap: spacing.base }}>
              <Ionicons name="ticket-outline" size={40} color={colors.onSurfaceVariant} />
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
                No support tickets yet.{'\n'}Tap above to raise an issue.
              </Text>
            </View>
          ) : (
            <View style={[styles.faqCard, { marginBottom: 0 }]}>
              {tickets.map((ticket, i) => (
                <View
                  key={ticket.id}
                  style={{ paddingVertical: spacing.base, borderBottomWidth: i < tickets.length - 1 ? 1 : 0, borderBottomColor: `${colors.outline}88` }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface, flex: 1 }}>
                      {ticket.subject}
                    </Text>
                    <View style={{ backgroundColor: ticket.status === 'open' ? `${colors.primary}22` : `${'#22C55E'}22`, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <Text variant="caption" color={ticket.status === 'open' ? colors.primary : '#22C55E'}>
                        {ticket.status === 'open' ? 'Open' : 'Resolved'}
                      </Text>
                    </View>
                  </View>
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 2 }}>
                    {new Date(ticket.createdAt).toLocaleDateString()}
                  </Text>
                  <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xs, lineHeight: 20 }} numberOfLines={2}>
                    {ticket.message}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </MotiView>

        {/* Contact support */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 140 }}
          style={styles.contactCard}
        >
          <Ionicons name="mail-outline" size={24} color={colors.primary} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.contactTitle}>Still need help?</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Our support team typically responds within 2 hours.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.contactBtn}
            onPress={() => Linking.openURL('mailto:support@eyego.app?subject=Driver%20App%20Support')}
            activeOpacity={0.8}
          >
            <Text style={styles.contactBtnText}>Email Us</Text>
          </TouchableOpacity>
        </MotiView>
      </ScrollView>

      {/* New Ticket Modal */}
      <Modal visible={showNewTicket} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing['2xl'] }}>
            <Text variant="titleMedium">Raise a Dispute</Text>
            <Pressable onPress={() => setShowNewTicket(false)}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: spacing['2xl'], gap: spacing.base }}>
            <View>
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xs }}>Subject</Text>
              <TextInput
                style={{ height: 48, backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.outline, paddingHorizontal: spacing.base, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}
                value={ticketSubject}
                onChangeText={setTicketSubject}
                placeholder="Brief description of your issue"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
              />
            </View>
            <View>
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginBottom: spacing.xs }}>Message</Text>
              <TextInput
                style={{ minHeight: 120, backgroundColor: colors.surfaceContainerHigh, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.outline, paddingHorizontal: spacing.base, paddingVertical: spacing.md, fontFamily: fonts.medium, fontSize: fontSizes.bodyMedium, color: colors.onSurface, textAlignVertical: 'top' }}
                value={ticketMessage}
                onChangeText={setTicketMessage}
                placeholder="Describe your issue in detail..."
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                multiline
              />
            </View>
            <Button label="Submit Ticket" onPress={handleSubmitTicket} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.backgroundDeep },
    backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
    scroll: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    headline: { letterSpacing: -1 },
    subtext: { marginTop: spacing.xs, marginBottom: spacing['2xl'] },
    faqCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii['2xl'],
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.xl,
      marginBottom: spacing.xl,
    },
    contactCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      padding: spacing.xl,
    },
    contactTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface },
    contactBtn: {
      backgroundColor: colors.primary,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    contactBtnText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall ?? 13, color: colors.onPrimary },
  });
