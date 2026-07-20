import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text, Toggle, GlassSurface } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useColors();
  const { isDark, setDark } = useThemeStore();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall">Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* General */}
        <Animated.View entering={FadeInDown.delay(60).springify().damping(18)}>
          <Text variant="labelCaps" style={styles.sectionLabel}>
            GENERAL
          </Text>
          <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="moon-outline" size={20} color={colors.onSurfaceVariant} />
                <Text variant="bodyMedium" color={colors.onSurface}>Dark Mode</Text>
              </View>
              <Toggle value={isDark} onValueChange={setDark} />
            </View>
          </GlassSurface>
        </Animated.View>

        {/* Notifications — previously three fake toggles here (local React
            state only, no persistence, no backend call) duplicated and
            conflicted with the real, fully-wired preferences screen at
            profile/notification-preferences.tsx. One link to the real thing
            instead of a second, non-functional copy. */}
        <Animated.View
          entering={FadeInDown.delay(130).springify().damping(18)}
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="labelCaps" style={styles.sectionLabel}>
            NOTIFICATIONS
          </Text>
          <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.card}>
            <Pressable style={styles.row} onPress={() => router.push('/profile/notification-preferences' as any)}>
              <View style={styles.rowLeft}>
                <Ionicons name="notifications-outline" size={20} color={colors.onSurfaceVariant} />
                <View>
                  <Text variant="bodyMedium" color={colors.onSurface}>Notification Preferences</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>Trips, messages, promotions</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
            </Pressable>
          </GlassSurface>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
  },
  sectionLabel: {
    letterSpacing: 1,
    marginBottom: spacing.base,
  },
  card: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.base,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.base,
  },
});
