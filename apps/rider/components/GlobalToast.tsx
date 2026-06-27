import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useToastStore, type ToastType } from '../stores/toast.store';
import { Text } from '@eyego/ui';
import { spacing, radii } from '@eyego/config';

const CONFIG: Record<ToastType, { bg: string; iconColor: string; name: React.ComponentProps<typeof Ionicons>['name'] }> = {
  success: { bg: '#0f2e14', iconColor: '#4be277', name: 'checkmark-circle' },
  error:   { bg: '#2e0f0f', iconColor: '#ff6b6b', name: 'alert-circle'     },
  warning: { bg: '#2e220f', iconColor: '#ffb347', name: 'warning'           },
  info:    { bg: '#0f1e2e', iconColor: '#7dd8f5', name: 'information-circle'},
};

export function GlobalToast() {
  const { visible, message, type, hide } = useToastStore();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, stiffness: 500, damping: 32 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 240, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, translateY, opacity]);

  const { bg, iconColor, name } = CONFIG[type];

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.container, { top: insets.top + 8, opacity, transform: [{ translateY }], backgroundColor: bg }]}
    >
      <Ionicons name={name} size={20} color={iconColor} />
      <Text variant="bodySmall" style={[styles.message]}>{message}</Text>
      <Pressable onPress={hide} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Ionicons name="close" size={18} color="rgba(255,255,255,0.45)" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg ?? 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  message: {
    flex: 1,
    color: '#fff',
  },
});
