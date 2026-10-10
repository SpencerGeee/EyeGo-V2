import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Linking, TextInput, Modal, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingsApi, supportTicketsApi, queryKeys } from '@eyego/api';
import { describeError, dayMonth, dayMonthTime } from '@eyego/utils';
import { fonts, radii } from '@eyego/config';
import { Text, Button, Screen, ListSection, ListRow, SkeletonRows, notify } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';
import { useAuthStore } from '../../stores/auth.store';

const FAQS = [
  {
    q: 'How does EyeGo work?',
    a: 'Book a private ride, or a seat on a shared trip a driver has published. Set your pickup and destination, see the price before you confirm, pay by mobile money, card, wallet or cash, and follow your driver live.',
  },
  {
    q: 'Can I book for a group?',
    a: 'Yes. Book several seats, or start a group and share the invite link — each friend books their own seat, or you can pay for everyone.',
  },
  {
    q: 'How is my fare worked out?',
    a: 'By distance, time and vehicle class (Eco, Comfort or Premium). You always see the price before you confirm. On a shared trip you pay for your seat.',
  },
  {
    q: 'How do I cancel?',
    a: 'Open the ride in Activity and tap Cancel. It’s free before the trip sets off; for an on-demand ride it’s free until two minutes after a driver accepts. The app shows any fee before you confirm.',
  },
  {
    q: 'I left something in the car',
    a: 'Open the trip from Activity and tap “Left something, or something went wrong?” → Left something in the car. Your driver is told straight away, answers in the app, and you can message them to arrange the return.',
  },
  {
    q: 'Is my payment secure?',
    a: 'Yes. Payments are processed by Paystack, a PCI-DSS certified gateway. EyeGo never stores your card details or MoMo PIN.',
  },
];

const CATEGORIES = [
  { value: 'TRIP', label: 'A trip' },
  { value: 'PAYMENT', label: 'Payments' },
  { value: 'LOST_ITEM', label: 'Lost item' },
  { value: 'ACCOUNT', label: 'My account' },
  { value: 'TECHNICAL', label: 'App problem' },
  { value: 'GENERAL', label: 'Something else' },
] as const;

const STATUS_LABEL: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };

const shortDate = (iso?: string | null) =>
  iso ? dayMonth(iso) : '';

/**
 * HELP (rival spec §10) — your recent trips first (most help is about one),
 * then ways to reach us, your requests, and answers.
 *
 * Two bugs fixed here: a trip dispute sent the TRIP id where the server wants
 * the BOOKING id, so the driver was never linked to it; and the thread showed
 * support's replies as "You" (it read fields the server never sends).
 */
export default function HelpScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const { supportPhone } = usePlatformConfig();

  const [compose, setCompose] = useState(false);
  const [category, setCategory] = useState<string>('');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  // `?ticket=` — a support-reply notification opens its thread directly.
  const { ticket: ticketParam } = useLocalSearchParams<{ ticket?: string }>();
  const [openId, setOpenId] = useState<string | null>(ticketParam ?? null);
  const [reply, setReply] = useState('');

  const tripsQ = useQuery({
    queryKey: queryKeys.bookings.myHistory(),
    queryFn: () => bookingsApi.getHistory({ limit: 50 }),
  });
  const trips: any[] = ((tripsQ.data?.data?.data as any)?.bookings ?? []).slice(0, 3);

  const ticketsQ = useQuery({
    queryKey: ['support', 'tickets'],
    queryFn: () => supportTicketsApi.getAll(),
  });
  const tickets: any[] = (ticketsQ.data?.data as any)?.data?.tickets ?? [];

  const threadQ = useQuery({
    queryKey: ['support', 'ticket', openId],
    queryFn: () => supportTicketsApi.getById(openId!),
    enabled: !!openId,
  });
  const thread = (threadQ.data?.data as any)?.data?.ticket ?? null;

  const tripLabel = (b: any) => {
    const dest = b?.trip?.route?.destinationName ?? b?.dropoffName ?? b?.trip?.destinationName;
    return dest ? `To ${String(dest).split(',')[0]}` : 'Your trip';
  };

  const startRequest = (opts: { category?: string; booking?: any } = {}) => {
    setCategory(opts.category ?? '');
    setBookingId(opts.booking?.id ?? null);
    setSubject(opts.booking ? `${tripLabel(opts.booking)} · ${shortDate(opts.booking?.trip?.departureTime ?? opts.booking?.createdAt)}` : '');
    setMessage('');
    setCompose(true);
  };

  const create = useMutation({
    mutationFn: () =>
      supportTicketsApi.create({
        subject: subject.trim(),
        message: message.trim(),
        category: category || 'GENERAL',
        // The BOOKING id — the server resolves the driver from it.
        relatedBookingId: bookingId ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
      setCompose(false);
      notify('Request sent', 'We usually reply within a few hours — you’ll find it here.', { tone: 'success' });
    },
    // Fields kept, so a failed send doesn't mean retyping.
    onError: (err) => {
      const { title, message: m } = describeError(err, 'Please check your connection and try again.');
      notify(title, m);
    },
  });

  const send = useMutation({
    mutationFn: (text: string) => supportTicketsApi.addMessage(openId!, { text }),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['support', 'ticket', openId] });
      qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
    },
    onError: (err) => {
      const { title, message: m } = describeError(err, 'Please try again.');
      notify(title, m);
    },
  });

  const canSend = !!category && subject.trim().length >= 3 && message.trim().length >= 10;
  const digits = (supportPhone ?? '').replace(/\D/g, '');

  return (
    <>
      <Screen title="Help">
        {tripsQ.isPending ? (
          <SkeletonRows count={2} />
        ) : trips.length > 0 ? (
          <ListSection title="Get help with a trip">
            {trips.map((b) => (
              <ListRow
                key={b.id}
                icon="car-outline"
                title={tripLabel(b)}
                subtitle={`${shortDate(b?.trip?.departureTime ?? b?.createdAt)} · ${String(b.status ?? '').replace(/_/g, ' ').toLowerCase()}`}
                onPress={() => startRequest({ category: 'TRIP', booking: b })}
              />
            ))}
          </ListSection>
        ) : null}

        <ListSection title="Contact us" footer="We usually reply within a few hours.">
          <ListRow icon="chatbubbles-outline" title="Send us a message" subtitle="Get an answer right here in the app" onPress={() => startRequest()} />
          {digits ? (
            <ListRow icon="logo-whatsapp" iconColor="#25D366" title="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${digits}?text=Hi%20EyeGo%20Support`)} />
          ) : null}
          {digits ? (
            <ListRow icon="call-outline" title="Call support" value={supportPhone ?? undefined} onPress={() => Linking.openURL(`tel:+${digits}`)} />
          ) : null}
          <ListRow icon="mail-outline" title="Email" value="support@eyego.app" onPress={() => Linking.openURL('mailto:support@eyego.app').catch(() => notify('No email app', 'Write to support@eyego.app.'))} />
        </ListSection>

        {tickets.length > 0 ? (
          <ListSection title="Your requests">
            {tickets.map((t) => {
              const last = t.messages?.[0];
              return (
                <ListRow
                  key={t.id}
                  icon="chatbox-ellipses-outline"
                  title={t.subject}
                  subtitle={`${shortDate(t.updatedAt ?? t.createdAt)}${last?.text ? ` · ${last.senderRole === 'SUPPORT' || last.senderRole === 'ADMIN' ? 'EyeGo: ' : ''}${last.text}` : ''}`}
                  subtitleLines={1}
                  value={STATUS_LABEL[t.status] ?? t.status}
                  valueColor={t.status === 'OPEN' || t.status === 'IN_PROGRESS' ? colors.primary : colors.onSurfaceVariant}
                  onPress={() => setOpenId(t.id)}
                />
              );
            })}
          </ListSection>
        ) : null}

        <ListSection title="Common questions">
          {FAQS.map((f) => (
            <FaqRow key={f.q} q={f.q} a={f.a} styles={styles} colors={colors} />
          ))}
        </ListSection>
      </Screen>

      {/* New request */}
      <Modal visible={compose} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCompose(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalBar}>
            <Text style={styles.modalTitle}>Send us a message</Text>
            <Pressable onPress={() => setCompose(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
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
                    <Pressable key={c.value} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(c.value)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                      <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.onSurface }]}>{c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {bookingId ? <Text style={styles.linked}>Linked to this trip, so we can see what happened.</Text> : null}
              <Text variant="labelCaps" style={styles.label}>Subject</Text>
              <TextInput maxFontSizeMultiplier={1.4} style={styles.input} value={subject} onChangeText={setSubject} placeholder="In a few words" placeholderTextColor={colors.onSurfaceVariant} maxLength={120} />
              <Text variant="labelCaps" style={styles.label}>Details</Text>
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={[styles.input, styles.multiline]}
                value={message}
                onChangeText={setMessage}
                placeholder={category === 'LOST_ITEM' ? 'What did you leave behind, and where were you sitting?' : 'What happened?'}
                placeholderTextColor={colors.onSurfaceVariant}
                multiline
                maxLength={2000}
              />
              <Button label="Send" onPress={() => create.mutate()} loading={create.isPending} disabled={!canSend || create.isPending} style={{ marginTop: 20 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* A request, in full */}
      <Modal visible={!!openId} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setOpenId(null); setReply(''); }}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalBar}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.modalTitle} numberOfLines={2}>{thread?.subject ?? 'Request'}</Text>
              {thread ? (
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {STATUS_LABEL[thread.status] ?? thread.status} · {shortDate(thread.createdAt)}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => { setOpenId(null); setReply(''); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              {threadQ.isPending ? (
                <SkeletonRows count={2} icon={false} />
              ) : (
                (thread?.messages ?? []).map((m: any) => {
                  const fromSupport = m.senderRole === 'SUPPORT' || m.senderRole === 'ADMIN';
                  const fromDriver = m.senderRole === 'DRIVER';
                  const mine = !fromSupport && !fromDriver && (m.senderId ? m.senderId === userId : true);
                  return (
                    <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text variant="bodySmall" color={colors.onSurface}>{m.text}</Text>
                      <Text variant="caption" color={colors.onSurfaceVariant}>
                        {fromSupport ? 'EyeGo Support' : fromDriver ? 'Driver' : 'You'} · {m.createdAt ? dayMonthTime(m.createdAt) : ''}
                      </Text>
                    </View>
                  );
                })
              )}
              {thread && (thread.messages ?? []).every((m: any) => m.senderRole !== 'SUPPORT' && m.senderRole !== 'ADMIN') ? (
                <Text style={styles.note}>No reply yet — we usually answer within a few hours.</Text>
              ) : null}
              <TextInput
                maxFontSizeMultiplier={1.4}
                style={[styles.input, styles.multiline, { marginTop: 20 }]}
                value={reply}
                onChangeText={setReply}
                placeholder="Add a message…"
                placeholderTextColor={colors.onSurfaceVariant}
                multiline
                maxLength={2000}
              />
              <Button label="Send" onPress={() => send.mutate(reply.trim())} loading={send.isPending} disabled={send.isPending || !reply.trim()} style={{ marginTop: 12 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

/** A ListRow-shaped row that opens in place; takes ListSection's `divider`. */
function FaqRow({ q, a, styles, colors, divider }: { q: string; a: string; styles: ReturnType<typeof makeStyles>; colors: Colors; divider?: boolean }) {
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

const makeStyles = (c: Colors) =>
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
    linked: { marginTop: 10, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.primary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.full, backgroundColor: c.surfaceContainer },
    chipOn: { backgroundColor: c.primary },
    chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
    input: { fontFamily: fonts.medium, fontSize: 16, color: c.onSurface, backgroundColor: c.surfaceContainer, borderRadius: radii.lg, paddingHorizontal: 16, height: 52 },
    multiline: { height: undefined, minHeight: 120, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top' },
    bubble: { maxWidth: '88%', borderRadius: radii.xl, paddingHorizontal: 14, paddingVertical: 10, marginTop: 10, gap: 4 },
    bubbleMine: { alignSelf: 'flex-end', backgroundColor: `${c.primary}1F` },
    bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: c.surfaceContainerHigh },
    note: { marginTop: 16, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.onSurfaceVariant, textAlign: 'center' },
  });
