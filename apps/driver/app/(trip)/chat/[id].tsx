import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { driverSocketEvents } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../../utils/useColors';
import { useDriverStore } from '../../../stores/driver.store';

interface Message {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: string;
  isDriver: boolean;
}

export default function TripChatScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { driver } = useDriverStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    const unsub = driverSocketEvents.onChatMessage((msg) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${msg.senderId}-${msg.timestamp}`,
          senderId: msg.senderId,
          senderName: msg.senderName,
          text: msg.text,
          timestamp: msg.timestamp,
          isDriver: msg.senderId === driver?.id,
        },
      ]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return unsub;
  }, [driver?.id]);

  const sendMessage = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    driverSocketEvents.sendChatMessage(id, trimmed);
    const msg: Message = {
      id: `driver-${Date.now()}`,
      senderId: driver?.id ?? 'driver',
      senderName: driver?.name ?? 'Driver',
      text: trimmed,
      timestamp: new Date().toISOString(),
      isDriver: true,
    };
    setMessages((prev) => [...prev, msg]);
    setText('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => (
    <MotiView
      from={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30, delay: Math.min(index * 30, 200) }}
      style={[styles.messageRow, item.isDriver ? styles.messageRowDriver : styles.messageRowPassenger]}
    >
      {!item.isDriver && (
        <View style={styles.senderAvatar}>
          <Text style={styles.senderInitial}>
            {item.senderName?.[0]?.toUpperCase() ?? 'P'}
          </Text>
        </View>
      )}
      <View style={[styles.bubble, item.isDriver ? styles.bubbleDriver : styles.bubblePassenger]}>
        {!item.isDriver && item.senderName && (
          <Text style={styles.senderName}>{item.senderName}</Text>
        )}
        <Text style={[styles.messageText, item.isDriver && { color: '#fff' }]}>
          {item.text}
        </Text>
        <Text style={[styles.timestamp, item.isDriver && { color: 'rgba(255,255,255,0.6)' }]}>
          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </MotiView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Trip Chat</Text>
          <Text variant="caption" color={colors.onSurfaceVariant}>Messages with passengers</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyChat}>
            <Ionicons name="chatbubbles-outline" size={48} color={colors.onSurfaceVariant} />
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.md }}>
              No messages yet
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Message passengers…"
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            maxLength={500}
            selectionColor={colors.primary}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!text.trim()}
            activeOpacity={0.8}
          >
            <Ionicons name="send" size={18} color={text.trim() ? '#fff' : colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>
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
      color: colors.onSurface,
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
    senderName: {
      fontFamily: fonts.semiBold,
      fontSize: 11,
      color: colors.primary,
      marginBottom: 2,
    },
    messageText: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
      lineHeight: 20,
    },
    timestamp: {
      fontFamily: fonts.regular,
      fontSize: 10,
      color: colors.onSurfaceVariant,
      marginTop: 4,
      alignSelf: 'flex-end',
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
  });
