import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@eyego/config';
import { Text } from './Text';
import { Pressable } from './Pressable';

interface EmptyStateProps {
  lottieSource?: object;
  /** An Ionicons name (preferred, rendered as a crisp vector) or a legacy emoji string. */
  icon?: string;
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

// Distinguish an Ionicons name from a legacy emoji so we can render vectors going
// forward without breaking call sites that still pass an emoji.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

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
        EMOJI_RE.test(icon) ? (
          <Text style={styles.icon}>{icon}</Text>
        ) : (
          <Ionicons
            name={icon as React.ComponentProps<typeof Ionicons>['name']}
            size={56}
            color={colors.onSurfaceVariant}
            style={styles.iconVector}
          />
        )
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
  iconVector: {
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
