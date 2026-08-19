import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from './Text';

export type AnnouncementLevel = 'info' | 'warning' | 'critical';

export interface AnnouncementBannerProps {
  /** Null or empty renders nothing — the caller does not have to branch. */
  text?: string | null;
  level?: AnnouncementLevel;
  /** Surface colour for the container, from the host app's palette. */
  surfaceColor: string;
  style?: object;
}

/**
 * The operator's in-app message.
 *
 * `APP_ANNOUNCEMENT_TEXT` has been a setting in the admin console since the
 * registry was written, with help text promising it appears "as a banner in both
 * apps … on the next app foreground — no store release". Neither app had a
 * banner. This is it.
 *
 * The tone colours are deliberately hardcoded rather than pulled from either
 * app's palette: an announcement is the same urgency in the rider app and the
 * driver app, and both palettes are dark-first with a green primary that would
 * make a "critical" notice read as success.
 */
const TONE: Record<AnnouncementLevel, { accent: string; icon: keyof typeof Ionicons.glyphMap }> = {
  info: { accent: '#3B82F6', icon: 'information-circle' },
  warning: { accent: '#F59E0B', icon: 'warning' },
  critical: { accent: '#EF4444', icon: 'alert-circle' },
};

export function AnnouncementBanner({ text, level = 'info', surfaceColor, style }: AnnouncementBannerProps) {
  const message = text?.trim();
  if (!message) return null;

  const tone = TONE[level] ?? TONE.info;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: surfaceColor, borderColor: tone.accent + '55' },
        style,
      ]}
    >
      <Ionicons name={tone.icon} size={18} color={tone.accent} />
      <Text style={[styles.text, { color: tone.accent }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 1,
  },
  text: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodySmall,
    lineHeight: Math.round(fontSizes.bodySmall * 1.4),
  },
});
