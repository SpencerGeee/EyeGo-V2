import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from '@eyego/config';
import { Text } from './Text';
import { Pressable } from './Pressable';

interface EmptyStateProps {
  lottieSource?: object;
  icon?: string;
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function EmptyState({ lottieSource, icon, title, subtitle, action }: EmptyStateProps) {
  // Lazy-import LottieView to avoid crash in Expo Go where lottie may not be available
  let LottieView: any = null;
  try {
    LottieView = require('lottie-react-native').default;
  } catch {
    LottieView = null;
  }

  return (
    <View style={styles.container}>
      {lottieSource && LottieView ? (
        <LottieView
          source={lottieSource}
          autoPlay
          loop={false}
          style={styles.lottie}
        />
      ) : icon ? (
        <Text style={styles.icon}>{icon}</Text>
      ) : null}

      <Text variant="titleMedium" style={styles.title}>{title}</Text>

      {subtitle ? (
        <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}

      {action ? (
        <Pressable onPress={action.onPress} style={styles.actionBtn}>
          <Text variant="label" color={colors.primary}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing['2xl'],
  },
  lottie: {
    width: 160,
    height: 160,
  },
  icon: {
    fontSize: 56,
    marginBottom: spacing.base,
  },
  title: {
    marginTop: spacing.base,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  actionBtn: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
});
