import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { MotiView } from 'moti';
import { driverApi, driverSocketEvents, connectDriverSocket, disconnectDriverSocket } from '@eyego/api';
import { useQuery } from '@tanstack/react-query';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Entrance } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';
import { scheduleLocalNotification } from '../../../utils/notifications';

interface Message {
  id: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  seatNumber?: number | null;
  text: string;
  timestamp: string;
  isDriver: boolean;
  isPrivate?: boolean;
  pending?: boolean;
  readAt?: string | null;
  recipientId?: string;
}

export default function TripChatScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, seatNumber, recipientId, riderName } = useLocalSearchParams<{
    id: string;
    seatNumber?: string;
    recipientId?: string;
    riderName?: string;
  }>();
  const router = useRouter();
  const { driver } = useDriverStore();

  // If recipientId is in URL params we start directly in private mode with that passenger.
  // Otherwise the driver picks via the Group/Private tab UI.
  const urlPrivate = !!recipientId;
  const decodedRiderName = riderName ? decodeURIComponent(riderName) : '';
  const seatNum = seatNumber ? parseInt(seatNumber, 10) : null;

  // Tab state — only relevant when NOT navigated from a URL private param
  const [chatMode, setChatMode] = useState<'group' | 'private'>(urlPrivate ? 'private' : 'group');
  const [privateRecipientId, setPrivateRecipientId] = useState<string | null>(recipientId ?? null);
  const [privateRecipientName, setPrivateRecipientName] = useState<string>(decodedRiderName);

  // Effective "is private" — true when in private tab AND a recipient is selected
  const isPrivate = chatMode === 'private' && !!privateRecipientId;

  const outboxKey = `driver_chat_outbox_${id}_${privateRecipientId ?? 'global'}`;

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [isConnected, setIsConnected] = useState(true);
  const [typingPassengers, setTypingPassengers] = useState<Map<string, string>>(new Map());
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isTypingRef = useRef(false);
  const driverTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList>(null);
  const driverId = driver?.id ?? '';
  // Track which unread message IDs we've already sent read receipts for
  // to avoid re-sending on every re-render (race condition fix)
  const sentReadReceiptsRef = useRef<Set<string>>(new Set());

  // Trip query — needed for passenger list in Private tab
  const { data: tripData } = useQuery({
    queryKey: ['driver', 'trip', id],
    queryFn: () => driverApi.getTripById(id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data?.data?.trip ?? null,
    staleTime: 30_000,
    enabled: !!id,
  });
  const activePassengers = useMemo(() => {
    const bookings = tripData?.bookings ?? [];
    return bookings
      .filter((b: any) =>
        ['CONFIRMED', 'BOARDED', 'SEAT_HELD'].includes(b.status) && b.user?.id
      )
      .sort((a: any, b: any) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99));
  }, [tripData?.bookings]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const addOrUpdateMessage = useCallback((incoming: Message) => {
    setMessages((prev) => {
      // Exact ID match — already present
      if (prev.some((m) => m.id === incoming.id)) return prev;
      // For driver's own messages: replace optimistic entry that matches text+recent timestamp
      if (incoming.isDriver) {
        const fiveSecAgo = Date.now() - 5000;
        const idx = prev.findIndex(
          (m) =>
            m.isDriver &&
            m.text === incoming.text &&
            (m.pending || parseInt((m.id.split('-')[1]) ?? '0', 10) > fiveSecAgo),
        );
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...incoming, pending: false };
          return updated;
        }
      }
      return [...prev, incoming];
    });
    scrollToBottom();
  }, [scrollToBottom]);

  // Flush pending outbox messages on reconnect
  const flushOutbox = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(outboxKey);
      const outbox: { text: string; timestamp: string }[] = raw ? JSON.parse(raw) : [];
      if (!outbox.length) return;

      for (const item of outbox) {
        if (isPrivate) {
          driverSocketEvents.sendPrivateChatMessage(id, item.text, recipientId!);
        } else {
          driverSocketEvents.sendChatMessage(id, item.text);
        }
      }
      await AsyncStorage.removeItem(outboxKey);

      // Replace pending messages with sent ones
      setMessages((prev) =>
        prev.map((m) => (m.pending ? { ...m, pending: false } : m))
      );
    } catch (_) {}
  }, [id, isPrivate, recipientId, outboxKey]);

  // Network status + outbox flush
  useEffect(() => {
    const unsubNet = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? true;
      setIsConnected(connected);
      if (connected) flushOutbox();
    });
    return () => unsubNet();
  }, [flushOutbox]);

  useEffect(() => {
    connectDriverSocket();

    // Load full history — store ALL messages and filter on render
    const unsubHistory = driverSocketEvents.onChatHistory((history) => {
      const parsed = history.map((msg) => ({
        id: `${msg.senderId}-${msg.timestamp}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderRole: msg.senderRole,
        seatNumber: msg.seatNumber,
        text: msg.text,
        timestamp: msg.timestamp,
        isDriver: msg.senderId === driverId,
        isPrivate: msg.isPrivate ?? false,
        recipientId: msg.recipientId,
        readAt: null,
      }));
      setMessages(parsed);
      scrollToBottom();
    });

    // Listen for read receipts
    const unsubReadReceipt = driverSocketEvents.onReadReceipt((data) => {
      if (data.tripId !== id) return;
      setMessages((prev) =>
        prev.map((m) =>
          data.messageIds.includes(m.id) && !m.isDriver
            ? { ...m, readAt: new Date().toISOString() }
            : m,
        ),
      );
    });

    // Always subscribe to group messages (rider→driver arrives here)
    const unsubGlobal = driverSocketEvents.onChatMessage((msg) => {
      const isFromPassenger = msg.senderId !== driverId;
      addOrUpdateMessage({
        id: `${msg.senderId}-${msg.timestamp}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderRole: msg.senderRole,
        seatNumber: msg.seatNumber,
        text: msg.text,
        timestamp: msg.timestamp,
        isDriver: !isFromPassenger,
        isPrivate: false,
      });
      // Local notification so driver sees the message even when screen is not focused
      if (isFromPassenger) {
        scheduleLocalNotification(
          msg.senderName ?? 'Passenger',
          msg.text,
          { tripId: id, type: 'chat' },
        );
      }
    });

    // Always subscribe to private messages too — they're filtered on render
    const unsubPrivate = driverSocketEvents.onPrivateChatMessage((msg) => {
      const isFromPassenger = msg.senderId !== driverId;
      if (isFromPassenger) {
        scheduleLocalNotification(
          `${msg.senderName ?? 'Passenger'} (private)`,
          msg.text,
          { tripId: id, type: 'chat_private' },
        );
      }
      addOrUpdateMessage({
        id: `${msg.senderId}-${msg.timestamp}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
        isDriver: msg.senderId === driverId,
        isPrivate: true,
        recipientId: msg.recipientId,
      });
    });

    const unsubTyping = driverSocketEvents.onTyping((data) => {
      if (data.senderRole === 'PASSENGER') {
        if (data.isTyping) {
          setTypingPassengers((prev) => {
            const next = new Map(prev);
            next.set(data.senderId, data.senderId);
            return next;
          });
          // Auto-clear after 5s in case stop event is missed
          const existing = typingTimeoutRef.current.get(data.senderId);
          if (existing) clearTimeout(existing);
          const t = setTimeout(() => {
            setTypingPassengers((prev) => {
              const next = new Map(prev);
              next.delete(data.senderId);
              return next;
            });
          }, 5000);
          typingTimeoutRef.current.set(data.senderId, t);
        } else {
          const existing = typingTimeoutRef.current.get(data.senderId);
          if (existing) clearTimeout(existing);
          typingTimeoutRef.current.delete(data.senderId);
          setTypingPassengers((prev) => {
            const next = new Map(prev);
            next.delete(data.senderId);
            return next;
          });
        }
      }
    });

    // Join the trip room now (covers the already-connected case) AND on every
    // (re)connect. Socket.IO drops all room membership on disconnect, so without
    // re-joining on reconnect the driver silently stops receiving `chat:message`
    // — the root cause of "messages only appear after I send one".
    driverSocketEvents.emitJoinTracking?.(id);
    const unsubConnect = driverSocketEvents.onConnect(() => {
      driverSocketEvents.emitJoinTracking?.(id);
    });

    return () => {
      unsubHistory();
      unsubGlobal();
      unsubPrivate();
      unsubReadReceipt();
      unsubTyping();
      unsubConnect();
      disconnectDriverSocket();
    };
  }, [driverId, id, scrollToBottom, addOrUpdateMessage, scheduleLocalNotification]);

  // Auto-send read receipts for messages from passengers that are visible
  // Uses a ref to track already-sent receipts to avoid re-sending on re-renders
  useEffect(() => {
    if (!id || messages.length === 0) return;
    const unreadIds = messages
      .filter((m) => !m.isDriver && !m.readAt && !sentReadReceiptsRef.current.has(m.id))
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      // Mark these as sent immediately to prevent re-sending
      unreadIds.forEach((msgId) => sentReadReceiptsRef.current.add(msgId));
      driverSocketEvents.sendReadReceipt(id, unreadIds);
    }
  }, [id, messages.length]);

  const sendMessage = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');

    const optimistic: Message = {
      id: `driver-${Date.now()}`,
      senderId: driverId,
      senderName: driver?.name ?? 'Driver',
      senderRole: 'DRIVER',
      text: trimmed,
      timestamp: new Date().toISOString(),
      isDriver: true,
      isPrivate,
      pending: !isConnected,
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();

    if (!isConnected) {
      try {
        const raw = await AsyncStorage.getItem(outboxKey);
        const outbox = raw ? JSON.parse(raw) : [];
        outbox.push({ text: trimmed, timestamp: optimistic.timestamp });
        await AsyncStorage.setItem(outboxKey, JSON.stringify(outbox));
      } catch (_) {}
      return;
    }

    if (isPrivate && privateRecipientId) {
      driverSocketEvents.sendPrivateChatMessage(id, trimmed, privateRecipientId);
    } else {
      driverSocketEvents.sendChatMessage(id, trimmed);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <Entrance
      animation="slideDown"
      delay={Math.min(index * 30, 200)}
      style={[styles.messageRow, item.isDriver ? styles.messageRowDriver : styles.messageRowPassenger]}
    >
      {!item.isDriver && (
        <View style={styles.senderAvatar}>
          <Text style={styles.senderInitial}>
            {item.senderName?.[0]?.toUpperCase() ?? 'P'}
          </Text>
        </View>
      )}
      <View style={[styles.bubble, item.isDriver ? styles.bubbleDriver : styles.bubblePassenger, item.pending && styles.bubblePending]}>
        {!item.isDriver && (
          <View style={styles.senderMeta}>
            {item.senderName && (
              <Text style={styles.senderName}>{item.senderName}</Text>
            )}
            {!isPrivate && item.seatNumber != null && (
              <View style={styles.seatChip}>
                <Text style={styles.seatChipText}>S{item.seatNumber}</Text>
              </View>
            )}
          </View>
        )}
        {item.isPrivate && (
          <Text style={styles.privateBadge}>🔒 Private</Text>
        )}
        <Text style={[styles.messageText, item.isDriver && { color: '#fff' }]}>
          {item.text}
        </Text>
        <View style={styles.timestampRow}>
          <Text style={[styles.timestamp, item.isDriver && { color: 'rgba(255,255,255,0.6)' }]}>
            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {item.pending && (
            <Ionicons name="time-outline" size={10} color="rgba(255,255,255,0.5)" style={{ marginLeft: 4 }} />
          )}
          {/* Read receipt indicator — shown on driver's own sent messages */}
          {item.isDriver && !item.pending && (
            <View style={{ marginLeft: 3, alignItems: 'center', justifyContent: 'center' }}>
              {item.readAt ? (
                <Ionicons name="checkmark-done" size={11} color="rgba(255,255,255,0.8)" />
              ) : (
                <Ionicons name="checkmark" size={11} color="rgba(255,255,255,0.4)" />
              )}
            </View>
          )}
        </View>
      </View>
    </Entrance>
  );

  // Filter messages for the current view
  const visibleMessages = useMemo(() => {
    if (chatMode === 'group') {
      return messages.filter((m) => !m.isPrivate);
    }
    if (!privateRecipientId) return []; // passenger picker — no messages yet
    // Private: show messages between driver and this specific passenger
    return messages.filter(
      (m) =>
        m.isPrivate &&
        (m.senderId === privateRecipientId ||
          (m.isDriver && (m as any).recipientId === privateRecipientId) ||
          // fallback: driver message without recipientId tag (sent by this session)
          (m.isDriver && !(m as any).recipientId)),
    );
  }, [messages, chatMode, privateRecipientId]);

  const renderPassengerItem = useCallback(({ item }: { item: any }) => (
    <Pressable
      key={item.user?.id}
      style={[
        styles.passengerRow,
        privateRecipientId === item.user?.id && { backgroundColor: colors.primary + '18', borderColor: colors.primary },
      ]}
      onPress={() => {
        setPrivateRecipientId(item.user?.id ?? '');
        setPrivateRecipientName(item.user?.name ?? 'Passenger');
      }}
    >
      <View style={[styles.seatBadge, { backgroundColor: colors.primary + '22' }]}>
        <Text variant="labelSmall" color={colors.primary} style={{ fontWeight: '700' }}>
          #{item.seatNumber ?? '?'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {item.user?.name ?? 'Passenger'}
        </Text>
        <Text variant="caption" color={colors.onSurfaceVariant}>
          {item.status}
        </Text>
      </View>
      {privateRecipientId === item.user?.id && (
        <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
      )}
    </Pressable>
  ), [styles, colors, privateRecipientId, setPrivateRecipientId, setPrivateRecipientName]);

  const chatPlaceholder = isPrivate
    ? `Message ${privateRecipientName || 'passenger'}…`
    : 'Broadcast to all passengers…';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (chatMode === 'private' && privateRecipientId && !urlPrivate) {
              // Go back to passenger picker
              setPrivateRecipientId(null);
            } else {
              router.back();
            }
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {chatMode === 'private' && privateRecipientId ? `🔒 ${privateRecipientName}` : 'Trip Chat'}
          </Text>
          <Text variant="caption" color={colors.onSurfaceVariant}>
            {chatMode === 'group'
              ? 'All Passengers'
              : privateRecipientId
                ? `Private · Seat ${activePassengers.find((p: any) => p.user?.id === privateRecipientId)?.seatNumber ?? '—'}`
                : 'Choose a passenger'}
          </Text>
        </View>
        {!isConnected && (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={14} color="#F59E0B" />
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        )}
      </View>

      {/* Group / Private tabs — hidden when navigated directly into a private chat */}
      {!urlPrivate && (
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, chatMode === 'group' && styles.tabActive]}
            onPress={() => { setChatMode('group'); setPrivateRecipientId(null); }}
          >
            <Ionicons name="people-outline" size={14} color={chatMode === 'group' ? colors.primary : colors.onSurfaceVariant} />
            <Text style={[styles.tabText, chatMode === 'group' && { color: colors.primary }]}>Group</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, chatMode === 'private' && styles.tabActive]}
            onPress={() => setChatMode('private')}
          >
            <Ionicons name="lock-closed-outline" size={14} color={chatMode === 'private' ? colors.primary : colors.onSurfaceVariant} />
            <Text style={[styles.tabText, chatMode === 'private' && { color: colors.primary }]}>Private</Text>
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Private tab — passenger picker when no recipient selected */}
        {chatMode === 'private' && !privateRecipientId ? (
          <View style={{ flex: 1 }}>
            {activePassengers.length === 0 ? (
              <View style={styles.emptyChat}>
                <Ionicons name="people-outline" size={48} color={colors.onSurfaceVariant} />
                <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.md }}>
                  No passengers yet
                </Text>
              </View>
            ) : (
              <FlatList
                data={activePassengers}
                keyExtractor={(p) => p.user?.id ?? p.id}
                contentContainerStyle={{ padding: spacing.xl, gap: spacing.sm }}
                renderItem={renderPassengerItem}
              />
            )}
          </View>
        ) : visibleMessages.length === 0 ? (
          <View style={styles.emptyChat}>
            <Ionicons
              name={isPrivate ? 'lock-closed-outline' : 'chatbubbles-outline'}
              size={48}
              color={colors.onSurfaceVariant}
            />
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.md }}>
              {isPrivate ? `Start a private chat with ${privateRecipientName}` : 'No messages yet'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Typing indicator */}
        {typingPassengers.size > 0 && (
          <Entrance
            animation="slideDown"
            exitAnimation="fadeOut"
            duration={200}
            style={[styles.messageRow, styles.messageRowPassenger, { marginHorizontal: spacing.xl, marginBottom: spacing.xs }]}
          >
            <View style={styles.senderAvatar}>
              <Text style={styles.senderInitial}>P</Text>
            </View>
            <View style={[styles.bubble, styles.bubblePassenger, { paddingVertical: 10 }]}>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                {[0, 1, 2].map((i) => (
                  <MotiView
                    key={i}
                    from={{ translateY: 0 }}
                    animate={{ translateY: -4 }}
                    transition={{ type: 'timing', duration: 400, loop: true, delay: i * 120 } as any}
                    style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onSurfaceVariant }}
                  />
                ))}
              </View>
            </View>
          </Entrance>
        )}

        {/* Input — hidden when on passenger picker */}
        {!(chatMode === 'private' && !privateRecipientId) && (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={text}
              onChangeText={(val) => {
                setText(val);
                if (!isTypingRef.current) {
                  isTypingRef.current = true;
                  driverSocketEvents.sendTypingStart(id);
                }
                if (driverTypingTimeoutRef.current) clearTimeout(driverTypingTimeoutRef.current);
                driverTypingTimeoutRef.current = setTimeout(() => {
                  isTypingRef.current = false;
                  driverSocketEvents.sendTypingStop(id);
                }, 2000);
              }}
              placeholder={chatPlaceholder}
              placeholderTextColor={colors.onSurfaceVariant}
              multiline
              maxLength={500}
              selectionColor={colors.primary}
              returnKeyType="send"
              onSubmitEditing={sendMessage}
            />
            <Pressable
              style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!text.trim()}
            >
              <Ionicons name="send" size={18} color={text.trim() ? '#fff' : colors.onSurfaceVariant} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: fonts.displaySemiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: Math.round(fontSizes.titleSmall * 1.3),
      color: colors.onSurface,
    },
    offlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#F59E0B22',
      borderRadius: radii.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: '#F59E0B44',
    },
    offlineText: {
      fontFamily: fonts.medium,
      fontSize: 11,
      lineHeight: 14,
      color: '#F59E0B',
    },
    emptyChat: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listContent: {
      padding: spacing.xl,
      gap: spacing.sm,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      maxWidth: '85%',
    },
    messageRowDriver: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
    messageRowPassenger: { alignSelf: 'flex-start' },
    senderAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    senderInitial: {
      fontFamily: fonts.semiBold,
      fontSize: 12,
      lineHeight: 16,
      color: colors.onSurface,
    },
    bubble: {
      borderRadius: 16,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      maxWidth: '100%',
    },
    bubbleDriver: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: 4,
    },
    bubblePassenger: {
      backgroundColor: colors.surfaceContainerHigh,
      borderBottomLeftRadius: 4,
    },
    bubblePending: { opacity: 0.6 },
    senderMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginBottom: 2,
    },
    senderName: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      lineHeight: 14,
      color: colors.primary,
    },
    seatChip: {
      backgroundColor: `${colors.primary}25`,
      borderRadius: radii.full,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: `${colors.primary}50`,
    },
    seatChipText: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      lineHeight: 12,
      color: colors.primary,
      letterSpacing: 0.3,
    },
    privateBadge: {
      fontFamily: fonts.medium,
      fontSize: 10,
      lineHeight: 13,
      color: colors.onSurfaceVariant,
      marginBottom: 2,
    },
    messageText: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      lineHeight: 20,
    },
    timestampRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      marginTop: 4,
    },
    timestamp: {
      fontFamily: fonts.regular,
      fontSize: 10,
      lineHeight: 13,
      color: colors.onSurfaceVariant,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
      backgroundColor: colors.background,
    },
    textInput: {
      flex: 1,
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outline,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
      color: colors.onSurface,
      maxHeight: 100,
    },
    sendBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: colors.surfaceContainerHigh },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outline,
    },
    tabActive: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}18`,
    },
    tabText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.caption,
      lineHeight: Math.round(fontSizes.caption * 1.3),
      color: colors.onSurfaceVariant,
    },
    passengerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      marginBottom: spacing.xs,
      backgroundColor: colors.surfaceContainer,
    },
    seatBadge: {
      width: 36,
      height: 36,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
