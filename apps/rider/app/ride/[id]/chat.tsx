import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectSocket, socketEvents, getSocket, tripsApi } from '@eyego/api';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../../../stores/auth.store';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { scheduleLocalNotification } from '../../../utils/notifications';
import { Text } from '@eyego/ui';
import { useQuery } from '@tanstack/react-query';

interface ChatMessage {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: string;
  isMine: boolean;
  status?: 'sending' | 'sent' | 'failed' | 'offline';
  isPrivate?: boolean;
  senderRole?: string;
  readAt?: string | null;
}

const QUICK_REPLIES = [
  "I'm at the stop 📍",
  'Running 2 min late ⏱',
  'On my way 🚶',
  'Thank you! 🙏',
];

const getOfflineOutbox = async (tripId: string): Promise<ChatMessage[]> => {
  try {
    const stored = await AsyncStorage.getItem(`@eyego_chat_outbox_${tripId}`);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to load offline outbox', e);
    return [];
  }
};

const saveOfflineOutbox = async (tripId: string, outbox: ChatMessage[]) => {
  try {
    await AsyncStorage.setItem(`@eyego_chat_outbox_${tripId}`, JSON.stringify(outbox));
  } catch (e) {
    console.error('Failed to save offline outbox', e);
  }
};

const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

const getCachedHistory = async (tripId: string): Promise<ChatMessage[]> => {
  try {
    const raw = await AsyncStorage.getItem(`@eyego_chat_history_${tripId}`);
    if (!raw) return [];
    const { messages, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(`@eyego_chat_history_${tripId}`);
      return [];
    }
    return messages ?? [];
  } catch { return []; }
};

const saveCachedHistory = async (tripId: string, msgs: ChatMessage[]) => {
  try {
    await AsyncStorage.setItem(
      `@eyego_chat_history_${tripId}`,
      JSON.stringify({ messages: msgs.slice(0, 200), savedAt: Date.now() })
    );
  } catch {}
};

export default function ChatScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { selectedTrip } = useRideStore();

  const { data: tripData } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => tripsApi.getById(id ?? ''),
    enabled: !!id,
  });

  const syncedTrip = useMemo(() => {
    return selectedTrip ?? (tripData?.data?.data as any)?.trip;
  }, [selectedTrip, tripData]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isDriverTyping, setIsDriverTyping] = useState(false);
  // Group = broadcast to driver + all riders. Private = 1-on-1 thread with the
  // driver (parity with the driver app's Group/Private chat tabs).
  const [chatMode, setChatMode] = useState<'group' | 'private'>('group');
  const isPrivateMode = chatMode === 'private';
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);
  const visibleMessageIdsRef = useRef<Set<string>>(new Set());
  // Track which unread message IDs we've already sent read receipts for
  // to avoid re-sending on every re-render (race condition fix)
  const sentReadReceiptsRef = useRef<Set<string>>(new Set());
  // BUGFIX: Timer refs that get cleaned up on unmount to prevent memory leaks
  const autoClearTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const driver = syncedTrip?.driver;

  const processOfflineOutbox = useCallback(async () => {
    if (!id) return;
    const outbox = await getOfflineOutbox(id);
    if (outbox.length === 0) return;

    // Update UI state: mark these messages as 'sending'
    setMessages((prev) =>
      prev.map((m) => {
        const isInOutbox = outbox.some((om) => om.id === m.id);
        if (isInOutbox) {
          return { ...m, status: 'sending' };
        }
        return m;
      })
    );

    // Emit each message in order, preserving private vs group routing
    for (const msg of outbox) {
      if (msg.isPrivate) {
        socketEvents.sendPrivateChatMessage(id, msg.text, driverIdRef.current);
      } else {
        socketEvents.sendChatMessage(id, msg.text);
      }
    }

    // Clear the outbox in storage
    await saveOfflineOutbox(id, []);

    // Update UI state: mark these messages as sent (remove status)
    setMessages((prev) =>
      prev.map((m) => {
        const isInOutbox = outbox.some((om) => om.id === m.id);
        if (isInOutbox) {
          return { ...m, status: undefined };
        }
        return m;
      })
    );
  }, [id]);

  // R18: Re-process offline outbox whenever connectivity is restored
  useEffect(() => {
    const unsubNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected && getSocket().connected) {
        processOfflineOutbox();
      }
    });
    return () => unsubNetInfo();
  }, [processOfflineOutbox]);

  // Load cached history on mount
  useEffect(() => {
    if (!id) return;

    const loadCache = async () => {
      const cached = await getCachedHistory(id);
      if (cached.length > 0) {
        setMessages(cached);
      }
    };

    loadCache();
  }, [id]);

  // Save cached history when messages change
  useEffect(() => {
    if (id && messages.length > 0) {
      saveCachedHistory(id, messages);
    }
  }, [id, messages]);

  // Stable refs to avoid socket re-subscribe on selectedTrip changes
  const driverIdRef = useRef<string | undefined>(undefined);
  const joinedRoomRef = useRef(false);
  // Refs for latest id/user to avoid stale closures in socket callbacks (R11)
  const idRef = useRef(id);
  const userRef = useRef(user);
  useEffect(() => { idRef.current = id; }, [id]);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    const driverId = syncedTrip?.driver?.id;
    if (driverId && driverId !== driverIdRef.current) {
      driverIdRef.current = driverId;
    }
  }, [syncedTrip?.driver?.id]);

  useEffect(() => {
    if (!id) return;
    connectSocket();

    // Only join room if we haven't already joined (prevents double-join)
    if (!joinedRoomRef.current) {
      socketEvents.joinTripRoom(id, driverIdRef.current);
      joinedRoomRef.current = true;
    }

    // Process outbox if already connected
    if (getSocket().connected) {
      processOfflineOutbox();
    }

    const unsubConnect = socketEvents.onConnect(() => {
      // Re-join the trip room on every (re)connect — Socket.IO drops room
      // membership on disconnect, so without this the rider stops receiving
      // `chat:message` after any network blip / app foregrounding.
      socketEvents.joinTripRoom(idRef.current ?? id, driverIdRef.current);
      processOfflineOutbox();
    });

    const unsubHistory = socketEvents.onChatHistory((history) => {
      // Read latest userId from ref to avoid stale closure
      const currentUserId = userRef.current?.id;
      const parsed: ChatMessage[] = history.map((msg: any) => ({
        id: `${msg.timestamp}-${msg.senderId}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
        isMine: msg.senderId === currentUserId,
        isPrivate: msg.isPrivate ?? false,
        senderRole: msg.senderRole,
      }));

      setMessages((prev) => {
        const offlineMsgs = prev.filter((m) => m.status === 'offline' || m.status === 'sending');
        return [...offlineMsgs, ...parsed];
      });
    });

    // Listen for read receipts
    const unsubReadReceipt = socketEvents.onReadReceipt((data) => {
      if (data.tripId !== id) return;
      setMessages((prev) =>
        prev.map((m) =>
          data.messageIds.includes(m.id) && !m.isMine
            ? { ...m, readAt: new Date().toISOString() }
            : m,
        ),
      );
    });

    const unsubPrivate = socketEvents.onPrivateChatMessage((msg) => {
      const currentUserId = userRef.current?.id;
      const isMine = msg.senderId === currentUserId;
      const incoming: ChatMessage = {
        id: `${msg.timestamp}-${msg.senderId}-private`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
        isMine,
        isPrivate: true,
        senderRole: isMine ? 'PASSENGER' : 'DRIVER',
      };
      // Notify when the driver sends a private message
      if (!isMine) {
        scheduleLocalNotification(
          msg.senderName ?? 'Driver',
          msg.text,
          { tripId: id, type: 'chat' },
        );
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        // Replace this rider's optimistic private send (id ends with '-me')
        if (isMine) {
          const idx = prev.findIndex(
            (m) => m.isMine && m.isPrivate && m.text === incoming.text && m.id.endsWith('-me'),
          );
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = incoming;
            return updated;
          }
        }
        return [incoming, ...prev];
      });
    });

    const unsub = socketEvents.onChatMessage((msg) => {
      // Read latest userId from ref to avoid stale closure (R11)
      const currentUserId = userRef.current?.id;
      const isMine = msg.senderId === currentUserId;
      const incoming: ChatMessage = {
        id: `${msg.timestamp}-${msg.senderId}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
        isMine,
        isPrivate: 'isPrivate' in msg ? !!msg.isPrivate : false,
        senderRole: 'senderRole' in msg ? msg.senderRole : undefined,
      };
      // Notify rider when driver (or another user) sends a message
      if (!isMine) {
        scheduleLocalNotification(
          msg.senderName ?? 'Driver',
          msg.text,
          { tripId: id, type: 'chat' },
        );
      }
      setMessages((prev) => {
        // Exact ID match — already present
        if (prev.some((m) => m.id === incoming.id)) return prev;

        const fiveSecAgo = Date.now() - 5000;

        if (isMine) {
          // Replace optimistic entry sent by this rider
          const idx = prev.findIndex(
            (m) =>
              m.isMine &&
              m.text === incoming.text &&
              (m.id.endsWith('-me') || m.status === 'offline' || m.status === 'sending'),
          );
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = incoming;
            return updated;
          }
        } else {
          // userRef may not be set yet — also check for a recent optimistic '-me' message
          // with the same text to prevent a duplicate when the echo arrives before userRef resolves
          const echoIdx = prev.findIndex(
            (m) =>
              m.text === incoming.text &&
              m.id.endsWith('-me') &&
              parseInt(m.id.split('-me')[0] ?? '0', 10) > fiveSecAgo,
          );
          if (echoIdx !== -1) {
            const updated = [...prev];
            updated[echoIdx] = { ...incoming, isMine: true };
            return updated;
          }
        }
        return [incoming, ...prev];
      });
    });

    const unsubTyping = socketEvents.onTyping((data) => {
      if (data.senderRole === 'DRIVER') {
        setIsDriverTyping(data.isTyping);
        if (data.isTyping) {
            if (autoClearTypingTimerRef.current) clearTimeout(autoClearTypingTimerRef.current);
            autoClearTypingTimerRef.current = setTimeout(() => setIsDriverTyping(false), 5000);
          }
      }
    });

    return () => {
      unsub();
      unsubHistory();
      unsubConnect();
      unsubPrivate();
      unsubReadReceipt();
      unsubTyping();
      // Only leave this chat room — do NOT call global disconnectSocket()
      // as that would tear down the tracking socket used by other screens (R10)
      if (id) socketEvents.leaveTripRoom(id);
      // Reset join guard on unmount so re-mount re-joins
      joinedRoomRef.current = false;
      // BUGFIX: Clean up auto-clear typing timer on unmount
      if (autoClearTypingTimerRef.current) clearTimeout(autoClearTypingTimerRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [id, processOfflineOutbox]);

  // Auto-send read receipts for messages from others that are visible
  // Uses a ref to track already-sent receipts to avoid re-sending on re-renders
  useEffect(() => {
    if (!id || !getSocket().connected || messages.length === 0) return;
    const unreadIds = messages
      .filter((m) => !m.isMine && !m.readAt && !sentReadReceiptsRef.current.has(m.id))
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      // Mark these as sent immediately to prevent re-sending
      unreadIds.forEach((msgId) => sentReadReceiptsRef.current.add(msgId));
      socketEvents.sendReadReceipt(id, unreadIds);
    }
  }, [id, messages.length]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !id) return;

      const isConnected = getSocket().connected;

      const newMessage: ChatMessage = {
        id: `${Date.now()}-me`,
        senderId: user?.id ?? 'me',
        text: trimmed,
        timestamp: new Date().toISOString(),
        isMine: true,
        isPrivate: isPrivateMode,
        status: isConnected ? undefined : 'offline',
      };

      setMessages((prev) => [newMessage, ...prev]);
      setInput('');

      try {
        if (isConnected) {
          if (isPrivateMode) {
            socketEvents.sendPrivateChatMessage(id, trimmed, driverIdRef.current);
          } else {
            socketEvents.sendChatMessage(id, trimmed);
          }
        } else {
          const outbox = await getOfflineOutbox(id);
          const updatedOutbox = [...outbox, newMessage];
          await saveOfflineOutbox(id, updatedOutbox);
        }
      } catch {
        // Mark message as failed so the user knows it didn't send
        setMessages((prev) =>
          prev.map((m) => (m.id === newMessage.id ? { ...m, status: 'failed' as const } : m))
        );
      }
    },
    [id, user?.id, isPrivateMode]
  );

  // Show only the messages for the active tab: group (broadcast) vs private.
  const visibleMessages = useMemo(
    () => messages.filter((m) => (isPrivateMode ? m.isPrivate : !m.isPrivate)),
    [messages, isPrivateMode],
  );

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => (
    <MotiView
      from={{ opacity: 0, translateY: 8, scale: 0.97 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 } as any}
      style={[
        styles.bubbleWrapper,
        item.isMine ? styles.bubbleWrapperRight : styles.bubbleWrapperLeft,
      ]}
    >
      {!item.isMine && (
        <View style={styles.avatarSmall}>
          {driver?.avatarUrl ? (
            <Image source={{ uri: driver.avatarUrl }} style={styles.avatarSmallImg} />
          ) : (
            <Ionicons name="person" size={14} color={colors.onSurfaceVariant} />
          )}
        </View>
      )}
      {item.isMine && item.status && (
        <Text
          variant="caption"
          color={colors.onSurfaceVariant}
          style={{ marginRight: spacing.xs, alignSelf: 'flex-end', marginBottom: spacing.xs }}
        >
          {item.status === 'offline' ? 'Waiting for connection' : 'Sending...'}
        </Text>
      )}
      <View style={{ maxWidth: '75%' }}>
        <View
          style={[
            styles.bubble,
            item.isMine ? styles.bubbleMine : styles.bubbleTheirs,
            item.isPrivate && !item.isMine && styles.bubblePrivate,
          ]}
        >
          {item.isPrivate && !item.isMine && (
            <Text style={styles.privateBadge}>🔒 Private message</Text>
          )}
          <Text
            style={[
              styles.bubbleText,
              { color: item.isMine ? colors.primary : colors.onSurface },
            ]}
          >
            {item.text}
          </Text>
        </View>
        <View style={styles.timestampRow}>
          <Text
            variant="caption"
            color={colors.onSurfaceVariant}
            style={[
              styles.timestamp,
              item.isMine ? { textAlign: 'right' } : { textAlign: 'left' },
            ]}
          >
            {formatTime(item.timestamp)}
          </Text>
          {/* Read receipt indicator — shown on own messages */}
          {item.isMine && (
            <View style={styles.readStatus}>
              {item.readAt ? (
                <Ionicons name="checkmark-done" size={12} color={colors.statusSuccess ?? colors.primary} />
              ) : (
                !item.status && (
                  <Ionicons name="checkmark" size={12} color={colors.outline} />
                )
              )}
            </View>
          )}
        </View>
      </View>
      {!item.isMine && item.status && (
        <Text
          variant="caption"
          color={colors.onSurfaceVariant}
          style={{ marginLeft: spacing.xs, alignSelf: 'flex-end', marginBottom: spacing.xs }}
        >
          {item.status === 'offline' ? 'Waiting for connection' : 'Sending...'}
        </Text>
      )}
    </MotiView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatarWrap}>
            <View style={styles.headerAvatar}>
              {driver?.avatarUrl ? (
                <Image source={{ uri: driver.avatarUrl }} style={styles.headerAvatarImg} />
              ) : (
                <Ionicons name="person" size={18} color={colors.onSurfaceVariant} />
              )}
            </View>
            <View style={styles.onlineDot} />
          </View>
          <View>
            <Text variant="titleSmall">{driver?.name ?? 'Your Driver'}</Text>
            <View style={styles.statusRow}>
              <Ionicons name="car" size={12} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant}>
                {syncedTrip?.vehicle?.model ?? 'En route'}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={() => {
            const phone = driver?.phone;
            if (phone) require('react-native').Linking.openURL(`tel:${phone}`);
          }}
          style={styles.callBtn}
        >
          <Ionicons name="call-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {/* Group / Private tabs — mirrors the driver chat */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, chatMode === 'group' && styles.tabActive]}
          onPress={() => setChatMode('group')}
        >
          <Ionicons name="people-outline" size={14} color={chatMode === 'group' ? colors.primary : colors.onSurfaceVariant} />
          <Text style={[styles.tabText, { color: chatMode === 'group' ? colors.primary : colors.onSurfaceVariant }]}>Group</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, chatMode === 'private' && styles.tabActive]}
          onPress={() => setChatMode('private')}
        >
          <Ionicons name="lock-closed-outline" size={14} color={chatMode === 'private' ? colors.primary : colors.onSurfaceVariant} />
          <Text style={[styles.tabText, { color: chatMode === 'private' ? colors.primary : colors.onSurfaceVariant }]}>Private</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={visibleMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          inverted
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            isDriverTyping ? (
              <MotiView
                from={{ opacity: 0, translateY: 4 }}
                animate={{ opacity: 1, translateY: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'timing', duration: 200 } as any}
                style={[styles.bubbleWrapper, styles.bubbleWrapperLeft, { marginBottom: spacing.xs }]}
              >
                <View style={styles.avatarSmall}>
                  {driver?.avatarUrl ? (
                    <Image source={{ uri: driver.avatarUrl }} style={styles.avatarSmallImg} />
                  ) : (
                    <Ionicons name="person" size={14} color={colors.onSurfaceVariant} />
                  )}
                </View>
                <View style={[styles.bubble, styles.bubbleTheirs, { paddingVertical: 10, paddingHorizontal: 14 }]}>
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
              </MotiView>
            ) : null
          }
          ListEmptyComponent={
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: 'timing', duration: 400 } as any}
              style={styles.emptyState}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.outlineVariant} />
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ marginTop: spacing.base, textAlign: 'center' }}>
                Say hello to your driver
              </Text>
            </MotiView>
          }
        />

        {/* Quick replies */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickReplies}
          style={styles.quickRepliesScroll}
        >
          {QUICK_REPLIES.map((reply) => (
            <Pressable
              key={reply}
              onPress={() => sendMessage(reply)}
              style={styles.quickReply}
            >
              <Text style={{ fontSize: 12, fontFamily: fonts.medium, color: colors.onSurface }}>
                {reply}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input bar */}
        <View style={styles.inputBar}>
          <View style={styles.inputFieldWrap}>
            <Ionicons name="chatbubble-outline" size={16} color={colors.outline} style={styles.inputLeadIcon} />
          <TextInput
            value={input}
            onChangeText={(text) => {
              setInput(text);
              if (!id) return;
              if (!isTypingRef.current) {
                isTypingRef.current = true;
                socketEvents.sendTypingStart(id);
              }
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = setTimeout(() => {
                isTypingRef.current = false;
                socketEvents.sendTypingStop(id);
              }, 2000);
            }}
            placeholder={isPrivateMode ? 'Private message to driver…' : 'Message your driver...'}
            placeholderTextColor={colors.onSurfaceVariant}
            style={styles.textInput}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            blurOnSubmit={false}
          />
            <Pressable
              onPress={() => sendMessage(input)}
              style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
              disabled={!input.trim()}
            >
              <Ionicons
                name="send"
                size={16}
                color={input.trim() ? colors.onPrimary : colors.onSurfaceVariant}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.rimLightSubtle,
    gap: spacing.base,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerAvatarWrap: { width: 44, height: 44, position: 'relative' },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rimLight,
    overflow: 'hidden',
  },
  headerAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.statusSuccess ?? colors.primary,
    borderWidth: 2,
    borderColor: colors.backgroundDeep,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  listContent: {
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  bubbleWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  bubbleWrapperRight: { justifyContent: 'flex-end' },
  bubbleWrapperLeft: { justifyContent: 'flex-start' },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarSmallImg: { width: 28, height: 28, borderRadius: 14 },
  bubble: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.xl,
  },
  bubbleMine: {
    backgroundColor: withOpacity(colors.primary, 0.12),
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.3),
    borderTopRightRadius: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.rimLightSubtle,
    borderTopLeftRadius: 4,
  },
  bubblePrivate: {
    backgroundColor: withOpacity(colors.primary, 0.1),
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.25),
  },
  privateBadge: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.primary,
    marginBottom: 4,
    opacity: 0.8,
  },
  bubbleText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: 20,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  timestamp: { marginTop: 3, paddingHorizontal: spacing.xs },
  readStatus: {
    marginTop: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rimLightSubtle,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  tabActive: {
    borderColor: colors.primary,
    backgroundColor: withOpacity(colors.primary, 0.1),
  },
  tabText: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.caption,
  },
  quickRepliesScroll: {
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
    maxHeight: 52,
    flexGrow: 0,
  },
  quickReplies: {
    paddingHorizontal: spacing['2xl'],
    paddingVertical: 10,
    gap: spacing.sm,
    alignItems: 'center',
  },
  quickReply: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  inputBar: {
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.rimLightSubtle,
    backgroundColor: colors.surfaceDim,
  },
  inputFieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceInput,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.rimLight,
    paddingLeft: spacing.base,
    paddingRight: spacing.xs,
  },
  inputLeadIcon: { marginRight: spacing.sm },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 3,
  },
  sendBtnDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
});
