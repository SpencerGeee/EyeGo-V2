import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Linking, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from '@eyego/ui';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii, springs } from '@eyego/config';
// `Pressable` from @eyego/ui, never from react-native — NativeWind's css-interop
// drops the `({ pressed }) => style` form this screen uses.
import { Text, Button, AppBackground, Pressable } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

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

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: `${colors.outline}88` }}>
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.base, gap: spacing.md }}
        onPress={() => setOpen((v) => !v)}
      >
        <Text style={{ flex: 1, fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface }}>
          {q}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.onSurfaceVariant}
        />
      </Pressable>
      {open && (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ paddingBottom: spacing.base, lineHeight: 22 }}>
            {a}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

export default function HelpScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [showNewTicket, setShowNewTicket] = useState(false);
  /** The ticket whose thread is open, straight off the list payload. */
  const [openTicket, setOpenTicket] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');

  // Previously this whole feature was AsyncStorage-only — "Submit Ticket"
  // told the driver it had been sent to support, but nothing ever left the
  // phone. The backend already had /driver/support-tickets wired (used by
  // the admin console); the client just never called it.
  const queryClient = useQueryClient();
  const { data: ticketsData } = useQuery({
    queryKey: ['driver', 'support-tickets'],
    queryFn: () => driverApi.getSupportTickets(),
  });
  const tickets = ticketsData?.data?.data?.tickets ?? [];

  const replyMutation = useMutation({
    mutationFn: (message: string) =>
      driverApi.replyToTicket(openTicket!.id, { message }),
    onSuccess: () => {
      setReplyText('');
      queryClient.invalidateQueries({ queryKey: ['driver', 'support-tickets'] });
      // The thread is rendered from the list payload, so close on success —
      // the refreshed list carries the new message when the driver reopens it.
      setOpenTicket(null);
      Alert.alert('Sent', 'Your message has been added to the ticket.');
    },
    onError: (err: any) =>
      Alert.alert('Could not send', err?.response?.data?.message ?? 'Please try again.'),
  });

  const createTicketMutation = useMutation({
    mutationFn: (data: { subject: string; category: string; description: string }) =>
      driverApi.createSupportTicket(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver', 'support-tickets'] });
      setTicketSubject('');
      setTicketMessage('');
      setShowNewTicket(false);
      Alert.alert('Submitted', 'Your support ticket has been submitted. We\'ll respond within 2 hours.');
    },
    onError: (err: any) => {
      // Fields deliberately kept so a failed submit doesn't force a retype.
      Alert.alert('Submission Failed', err?.response?.data?.message ?? err?.message ?? 'Please check your connection and try again.');
    },
  });

  const handleSubmitTicket = () => {
    if (!ticketSubject.trim() || !ticketMessage.trim()) {
      Alert.alert('Required', 'Please fill in subject and message.');
      return;
    }
    createTicketMutation.mutate({
      subject: ticketSubject.trim(),
      category: 'GENERAL',
      description: ticketMessage.trim(),
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', ...springs.standard }}
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
          transition={{ type: 'spring', ...springs.standard, delay: 40 }}
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
          transition={{ type: 'spring', ...springs.standard, delay: 80 }}
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
          transition={{ type: 'spring', ...springs.standard, delay: 120 }}
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
              {/*
                BUGFIX ("on the driver app, you can view extra details on my
                tickets — you need to fix this").

                These rows were inert `View`s showing only the first line of the
                first message, with no way into the rest. The payload has always
                carried the whole thread (`getSupportTickets` includes `messages`
                ordered oldest-first with `senderRole`), and `POST
                /driver/support-tickets/:id/reply` has always accepted an answer
                — the driver simply had no screen for either. A dispute filed
                against a driver was therefore something they could see one line
                of and never respond to.
              */}
              {tickets.map((ticket, i) => (
                <Pressable
                  key={ticket.id}
                  onPress={() => setOpenTicket(ticket)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ticket: ${ticket.subject}`}
                  style={({ pressed }) => [
                    { paddingVertical: spacing.base, borderBottomWidth: i < tickets.length - 1 ? 1 : 0, borderBottomColor: `${colors.outline}88` },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, color: colors.onSurface, flex: 1 }}>
                      {ticket.subject}
                    </Text>
                    <View style={{ backgroundColor: ticket.status === 'OPEN' ? `${colors.primary}22` : `${'#22C55E'}22`, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <Text variant="caption" color={ticket.status === 'OPEN' ? colors.primary : '#22C55E'}>
                        {ticket.status === 'OPEN' ? 'Open' : 'Closed'}
                      </Text>
                    </View>
                  </View>
                  <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: 2 }}>
                    {new Date(ticket.createdAt).toLocaleDateString()}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
                    <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ flex: 1, lineHeight: 20 }} numberOfLines={2}>
                      {ticket.messages?.[0]?.text ?? ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
                  </View>
                  {(ticket.messages?.length ?? 0) > 1 && (
                    <Text variant="caption" color={colors.primary} style={{ marginTop: 2 }}>
                      {ticket.messages.length} messages
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </MotiView>

        {/* Contact support */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', ...springs.standard, delay: 140 }}
          style={styles.contactCard}
        >
          <Ionicons name="mail-outline" size={24} color={colors.primary} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.contactTitle}>Still need help?</Text>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              Our support team typically responds within 2 hours.
            </Text>
          </View>
          <Pressable
            style={styles.contactBtn}
            onPress={() => Linking.openURL('mailto:support@eyego.app?subject=Driver%20App%20Support')}
          >
            <Text style={styles.contactBtnText}>Email Us</Text>
          </Pressable>
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
            <Button label="Submit Ticket" onPress={handleSubmitTicket} loading={createTicketMutation.isPending} disabled={createTicketMutation.isPending} />
          </View>
        </SafeAreaView>
      </Modal>

      {/*
        THE TICKET, IN FULL, WITH A WAY TO ANSWER IT.

        Rendered straight from the list payload — `getSupportTickets` already
        includes every message with its `senderRole`, so opening a thread costs
        no extra request. Replies go through `POST
        /driver/support-tickets/:id/reply`, which now also accepts tickets a
        rider filed ABOUT this driver (see drivers.service#replyToTicket); before
        this pass those were readable-but-unanswerable, which is the worse half
        of the complaint.
      */}
      <Modal visible={!!openTicket} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing['2xl'] }}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text variant="titleMedium" numberOfLines={2}>{openTicket?.subject ?? 'Ticket'}</Text>
              {!!openTicket && (
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {(openTicket.category ?? 'GENERAL').toString().toLowerCase()} ·{' '}
                  {openTicket.status === 'OPEN' ? 'Open' : 'Closed'} ·{' '}
                  {openTicket.createdAt ? new Date(openTicket.createdAt).toLocaleDateString() : ''}
                </Text>
              )}
            </View>
            <Pressable onPress={() => { setOpenTicket(null); setReplyText(''); }} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing['2xl'], paddingBottom: spacing['3xl'] }}>
            {(openTicket?.messages ?? []).map((m: any) => {
              // Anything the support console wrote is SUPPORT/ADMIN; everything
              // else came from this side of the conversation.
              const fromSupport = m.senderRole === 'SUPPORT' || m.senderRole === 'ADMIN';
              return (
                <View
                  key={m.id}
                  style={{
                    maxWidth: '88%',
                    alignSelf: fromSupport ? 'flex-start' : 'flex-end',
                    backgroundColor: fromSupport ? colors.surfaceContainerHigh : `${colors.primary}1A`,
                    borderRadius: radii.xl,
                    paddingHorizontal: spacing.base,
                    paddingVertical: spacing.sm,
                    marginTop: spacing.sm,
                    gap: 4,
                  }}
                >
                  <Text variant="bodySmall" color={colors.onSurface}>{m.text}</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    {fromSupport ? 'EyeGo Support' : m.senderRole === 'USER' ? 'Rider' : 'You'} ·{' '}
                    {m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}
                  </Text>
                </View>
              );
            })}

            {(openTicket?.messages ?? []).length === 0 && (
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                No messages on this ticket yet.
              </Text>
            )}

            <TextInput
              style={{
                minHeight: 96,
                backgroundColor: colors.surfaceContainerHigh,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: colors.outline,
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.md,
                fontFamily: fonts.medium,
                fontSize: fontSizes.bodyMedium,
                color: colors.onSurface,
                textAlignVertical: 'top',
                marginTop: spacing.xl,
              }}
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Add a message…"
              placeholderTextColor={colors.onSurfaceVariant}
              selectionColor={colors.primary}
              multiline
            />
            <Button
              label={replyMutation.isPending ? 'Sending…' : 'Send message'}
              onPress={() => replyMutation.mutate(replyText.trim())}
              loading={replyMutation.isPending}
              disabled={replyMutation.isPending || !replyText.trim()}
              style={{ marginTop: spacing.sm }}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
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
    contactTitle: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium, lineHeight: Math.round(fontSizes.bodyMedium * 1.3), color: colors.onSurface },
    contactBtn: {
      backgroundColor: colors.primary,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    contactBtnText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodySmall ?? 13, lineHeight: Math.round((fontSizes.bodySmall ?? 13) * 1.3), color: colors.onPrimary },
  });
