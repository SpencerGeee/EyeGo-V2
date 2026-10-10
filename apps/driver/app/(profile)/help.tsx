import React, { useState, useMemo, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { View, StyleSheet, ScrollView, Linking, Modal, TextInput, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi, type DriverSupportTicket } from '@eyego/api';
import { formatGhs, describeError, dayMonth, dayMonthTime } from '@eyego/utils';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, SkeletonRows, notify, goDeeper } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'TRIP', label: 'A trip' },
  { value: 'ACCOUNT', label: 'My account' },
  { value: 'TECHNICAL', label: 'App problem' },
  { value: 'LOST_ITEM', label: 'Lost item' },
  { value: 'GENERAL', label: 'Something else' },
];

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  PENDING: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const shortDate = (iso?: string) =>
  iso ? dayMonth(iso) : '';

/**
 * HELP — get help first, then your open requests, then answers (rival spec
 * §19). Requests are real tickets on /driver/support-tickets; a rider's
 * dispute about one of your trips shows here too, and you can answer it.
 */
export default function HelpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { supportPhone, driverRequiredWalletPesewas, driverMinWithdrawalPesewas } = usePlatformConfig();
  const qc = useQueryClient();

  const [composeOpen, setComposeOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [openTicket, setOpenTicket] = useState<DriverSupportTicket | null>(null);
  const [replyText, setReplyText] = useState('');

  const ticketsQ = useQuery({
    queryKey: ['driver', 'support-tickets'],
    queryFn: () => driverApi.getSupportTickets(),
    select: (r) => r.data?.data?.tickets ?? [],
  });
  const tickets = ticketsQ.data ?? [];

  // `?ticket=` — a support-reply push or notification opens its thread directly.
  const { ticket: ticketParam } = useLocalSearchParams<{ ticket?: string }>();
  useEffect(() => {
    const t = ticketParam && tickets.find((x) => x.id === ticketParam);
    if (t) setOpenTicket(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketParam, ticketsQ.data]);

  const FAQS = [
    {
      q: 'Why can’t I go online?',
      a: `You need an approved account, a verified driver’s licence and Ghana Card, and at least ${formatGhs(driverRequiredWalletPesewas, { showDecimals: false })} in your EyeGo balance. An expired licence has to be renewed first. Home tells you exactly which one is missing.`,
    },
    {
      q: 'How do I get paid?',
      a: `Fares paid in the app go to your EyeGo balance when the trip ends. Cash fares are yours on the spot — the commission on them comes out of your balance. Cash out to mobile money or a bank from Earnings (minimum ${formatGhs(driverMinWithdrawalPesewas, { showDecimals: false })}).`,
    },
    {
      q: 'How do I add a passenger at the roadside?',
      a: 'On the active trip, tap Add passenger. Add them by phone number (they get a code to confirm) or as a cash passenger with no phone.',
    },
    {
      q: 'What happens when a trip is cancelled?',
      a: 'Passengers who paid in the app are refunded automatically. Trips you cancel after accepting count towards your cancellation rate; a rider cancelling never counts against you.',
    },
    {
      q: 'How is my rating worked out?',
      a: 'It’s the average of the stars riders give you after a trip. Ratings are anonymous — nobody can see who gave which score.',
    },
  ];

  const create = useMutation({
    mutationFn: () =>
      driverApi.createSupportTicket({ subject: subject.trim(), category: category || 'GENERAL', description: message.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'support-tickets'] });
      setComposeOpen(false);
      setCategory('');
      setSubject('');
      setMessage('');
      notify('Request sent', 'We usually reply within a few hours. You’ll find the answer here.', { tone: 'success' });
    },
    // Fields are kept so a failed send doesn't force a retype.
    onError: (err) => {
      const { title, message: m } = describeError(err, 'Please check your connection and try again.');
      notify(title, m);
    },
  });

  const reply = useMutation({
    mutationFn: (text: string) => driverApi.replyToTicket(openTicket!.id, { message: text }),
    onSuccess: () => {
      setReplyText('');
      qc.invalidateQueries({ queryKey: ['driver', 'support-tickets'] });
      // The thread renders from the list payload; the refreshed list carries the reply.
      setOpenTicket(null);
      notify('Sent', 'Your message was added to the request.', { tone: 'success' });
    },
    onError: (err) => {
      const { title, message: m } = describeError(err, 'Please try again.');
      notify(title, m);
    },
  });

  const canSend = !!category && subject.trim().length >= 3 && message.trim().length >= 10;

  return (
    <>
      <Screen title="Help">
        <ListSection title="Get help">
          <ListRow icon="chatbubbles-outline" title="Contact support" subtitle="Send a request — we reply in the app" onPress={() => setComposeOpen(true)} />
          <ListRow icon="bag-handle-outline" title="Lost items" subtitle="Things riders left in your car" onPress={() => goDeeper('/(profile)/lost-items' as any)} />
          {supportPhone ? (
            <ListRow icon="call-outline" title="Call support" value={supportPhone} onPress={() => Linking.openURL(`tel:${supportPhone.replace(/\s/g, '')}`)} />
          ) : null}
          <ListRow
            icon="mail-outline"
            title="Email support"
            value="support@eyego.app"
            onPress={() => Linking.openURL('mailto:support@eyego.app?subject=Driver%20app%20support').catch(() => notify('No email app', 'Write to support@eyego.app.'))}
          />
        </ListSection>

        {ticketsQ.isLoading ? (
          <SkeletonRows count={2} />
        ) : tickets.length > 0 ? (
          <ListSection title="Your requests">
            {tickets.map((t) => {
              const last = t.messages?.[t.messages.length - 1];
              return (
                <ListRow
                  key={t.id}
                  icon={t.filedByMe === false ? 'alert-circle-outline' : 'chatbox-ellipses-outline'}
                  title={t.subject}
                  subtitle={`${t.filedByMe === false ? 'Rider dispute · ' : ''}${shortDate(t.updatedAt ?? t.createdAt)}${last?.text ? ` · ${last.text}` : ''}`}
                  subtitleLines={1}
                  value={STATUS_LABEL[t.status] ?? t.status}
                  valueColor={t.status === 'OPEN' || t.status === 'IN_PROGRESS' ? colors.primary : colors.onSurfaceVariant}
                  onPress={() => setOpenTicket(t)}
                />
              );
            })}
          </ListSection>
        ) : null}

        <ListSection title="Common questions">
          {FAQS.map((f) => (
            <FaqRow key={f.q} q={f.q} a={f.a} colors={colors} styles={styles} />
          ))}
        </ListSection>
      </Screen>

      {/* New request */}
      <Modal
        visible={composeOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setComposeOpen(false)}
      >
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalBar}>
            <Text style={styles.modalTitle}>Contact support</Text>
            <Pressable onPress={() => setComposeOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text variant="labelCaps" style={styles.label}>What’s it about?</Text>
              <View style={styles.chips}>
                {CATEGORIES.map((c) => {
                  const on = category === c.value;
                  return (
                    <Pressable
                      key={c.value}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setCategory(c.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.onSurface }]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text variant="labelCaps" style={styles.label}>Subject</Text>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={styles.input}
                value={subject}
                onChangeText={setSubject}
                placeholder="In a few words"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                maxLength={120}
              />
              <Text variant="labelCaps" style={styles.label}>Details</Text>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={[styles.input, styles.multiline]}
                value={message}
                onChangeText={setMessage}
                placeholder="What happened? Include the trip date or code if it’s about a trip."
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                multiline
                maxLength={2000}
              />
              <Button label="Send" onPress={() => create.mutate()} loading={create.isPending} disabled={!canSend || create.isPending} style={{ marginTop: 20 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* A request, in full, with a way to answer it. */}
      <Modal
        visible={!!openTicket}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setOpenTicket(null); setReplyText(''); }}
      >
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalBar}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.modalTitle} numberOfLines={2}>{openTicket?.subject ?? 'Request'}</Text>
              {openTicket ? (
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {(CATEGORIES.find((c) => c.value === openTicket.category)?.label ?? 'Request')} · {STATUS_LABEL[openTicket.status] ?? openTicket.status} · {shortDate(openTicket.createdAt)}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => { setOpenTicket(null); setReplyText(''); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          {/* RN's avoider: a native page-sheet is its own window, which
              keyboard-controller does not drive. */}
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              {(openTicket?.messages ?? []).map((m) => {
                const fromSupport = m.senderRole === 'SUPPORT' || m.senderRole === 'ADMIN';
                const mine = m.fromMe ?? (!fromSupport && m.senderRole === 'DRIVER');
                return (
                  <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text variant="bodySmall" color={colors.onSurface}>{m.text}</Text>
                    <Text variant="caption" color={colors.onSurfaceVariant}>
                      {fromSupport ? 'EyeGo Support' : mine ? 'You' : 'Rider'} · {m.createdAt ? dayMonthTime(m.createdAt) : ''}
                    </Text>
                  </View>
                );
              })}
              {openTicket?.status === 'CLOSED' ? (
                <Text style={styles.closedNote}>This request is closed. Replying reopens it.</Text>
              ) : null}
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={[styles.input, styles.multiline, { marginTop: 20 }]}
                value={replyText}
                onChangeText={setReplyText}
                placeholder="Add a message…"
                placeholderTextColor={colors.onSurfaceVariant}
                selectionColor={colors.primary}
                multiline
                maxLength={2000}
              />
              <Button
                label="Send"
                onPress={() => reply.mutate(replyText.trim())}
                loading={reply.isPending}
                disabled={reply.isPending || !replyText.trim()}
                style={{ marginTop: 12 }}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

/** A ListRow-shaped row that opens in place. Takes ListSection's `divider`. */
function FaqRow({ q, a, colors, styles, divider }: { q: string; a: string; colors: DriverColors; styles: ReturnType<typeof makeStyles>; divider?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[styles.faqRow, pressed && { backgroundColor: colors.surfaceContainer }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.faqQ}>{q}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.outline} />
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(180)}>
          <Text style={styles.faqA}>{a}</Text>
        </Animated.View>
      ) : null}
      {divider ? <View style={styles.faqDivider} /> : null}
    </View>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    faqRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
    faqQ: { flex: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 21, color: c.onSurface },
    faqA: { paddingHorizontal: 20, paddingBottom: 16, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: c.onSurfaceVariant },
    faqDivider: { marginLeft: 20, height: StyleSheet.hairlineWidth, backgroundColor: c.outlineVariant },
    modal: { flex: 1, backgroundColor: c.background },
    modalBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
    modalTitle: { flex: 1, fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
    modalBody: { paddingHorizontal: 20, paddingBottom: 40 },
    label: { marginTop: 20, marginBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.full, backgroundColor: c.surfaceContainer },
    chipOn: { backgroundColor: c.primary },
    chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
    input: {
      fontFamily: fonts.medium,
      fontSize: 16,
      color: c.onSurface,
      backgroundColor: c.surfaceContainer,
      borderRadius: radii.lg,
      paddingHorizontal: 16,
      height: 52,
    },
    multiline: { height: undefined, minHeight: 120, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top' },
    bubble: { maxWidth: '88%', borderRadius: radii.xl, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10, gap: 4 },
    bubbleMine: { alignSelf: 'flex-end', backgroundColor: `${c.primary}1F` },
    bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: c.surfaceContainerHigh },
    closedNote: { marginTop: 16, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant, textAlign: 'center' },
  });
