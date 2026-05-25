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
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectSocket, socketEvents, getSocket, tripsApi } from '@eyego/api';
import { useAuthStore } from '../../../stores/auth.store';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
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

const getCachedHistory = async (tripId: string): Promise<ChatMessage[]> => {
  try {
    const stored = await AsyncStorage.getItem(`@eyego_chat_history_${tripId}`);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('Failed to load cached history', e);
    return [];
  }
};

const saveCachedHistory = async (tripId: string, history: ChatMessage[]) => {
  try {
    await AsyncStorage.setItem(`@eyego_chat_history_${tripId}`, JSON.stringify(history));
  } catch (e) {
    console.error('Failed to save cached history', e);
  }
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
    return selectedTrip ?? tripData?.data?.data?.trip;
  }, [selectedTrip, tripData]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList>(null);

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

    // Emit each message in order
    for (const msg of outbox) {
      socketEvents.sendChatMessage(id, msg.text);
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

  useEffect(() => {
    connectSocket();
    socketEvents.joinTripRoom(id!, syncedTrip?.driver?.id);

    // Process outbox if already connected
    if (getSocket().connected) {
      processOfflineOutbox();
    }

    const unsubConnect = socketEvents.onConnect(() => {
      processOfflineOutbox();
    });

    const unsubHistory = socketEvents.onChatHistory((history) => {
      const parsed: ChatMessage[] = history.map((msg: any) => ({
        id: `${msg.timestamp}-${msg.senderId}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
        isMine: msg.senderId === user?.id,
      }));
      
      setMessages((prev) => {
        const offlineMsgs = prev.filter((m) => m.status === 'offline' || m.status === 'sending');
        return [...offlineMsgs, ...parsed];
      });
    });

    const unsub = socketEvents.onChatMessage((msg) => {
      const incoming: ChatMessage = {
        id: `${msg.timestamp}-${msg.senderId}`,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
        isMine: msg.senderId === user?.id,
      };
      setMessages((prev) => {
        if (incoming.isMine) {
          const index = prev.findIndex(
            (m) =>
              m.isMine &&
              m.text === incoming.text &&
              (m.id.endsWith('-me') || m.status === 'offline' || m.status === 'sending')
          );
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = incoming;
            return updated;
          }
        }
        if (prev.some((m) => m.id === incoming.id)) {
          return prev;
        }
        return [incoming, ...prev];
      });
    });

    return () => {
      unsub();
      unsubHistory();
      unsubConnect();
    };
  }, [id, selectedTrip, user, processOfflineOutbox]);

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
        status: isConnected ? undefined : 'offline',
      };

      setMessages((prev) => [newMessage, ...prev]);
      setInput('');

      if (isConnected) {
        socketEvents.sendChatMessage(id, trimmed);
      } else {
        const outbox = await getOfflineOutbox(id);
        const updatedOutbox = [...outbox, newMessage];
        await saveOfflineOutbox(id, updatedOutbox);
      }
    },
    [id, user?.id]
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
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: item.isMine ? colors.onPrimary : colors.onSurface },
            ]}
          >
            {item.text}
          </Text>
        </View>
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatar}>
            {driver?.avatarUrl ? (
              <Image source={{ uri: driver.avatarUrl }} style={styles.headerAvatarImg} />
            ) : (
              <Ionicons name="person" size={18} color={colors.onSurfaceVariant} />
            )}
          </View>
          <View>
            <Text variant="titleSmall">{driver?.name ?? 'Your Driver'}</Text>
            <Text variant="caption" color={colors.primary}>
              Online
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => {
            const phone = (driver as any)?.phone;
            if (phone) require('react-native').Linking.openURL(`tel:${phone}`);
          }}
          style={styles.callBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="call-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          inverted
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
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
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message your driver..."
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
              size={18}
              color={input.trim() ? colors.onPrimary : colors.onSurfaceVariant}
            />
          </Pressable>
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
    borderBottomColor: colors.outlineVariant,
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
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    overflow: 'hidden',
  },
  headerAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
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
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceContainerHigh,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    lineHeight: 20,
  },
  timestamp: { marginTop: 3, paddingHorizontal: spacing.xs },
  quickRepliesScroll: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
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
    borderColor: colors.outlineVariant,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
});
