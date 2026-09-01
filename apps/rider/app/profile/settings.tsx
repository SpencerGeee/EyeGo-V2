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
import { spacing, radii, springs } from '@eyego/config';
import { Text, Toggle, GlassSurface, goDeeper, goBack } from '@eyego/ui';
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
        <Pressable onPress={() => goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall">Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* General */}
        <Animated.View entering={FadeInDown.delay(60).springify()
            .stiffness(springs.standard.stiffness)
            .damping(springs.standard.damping)
            .mass(springs.standard.mass)}>
          <Text variant="labelCaps" style={styles.sectionLabel}>
            GENERAL
          </Text>
          <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.card}>
            {/*
              THE TOGGLE NOW SAYS WHICH WAY IT IS MEANT TO BE.

              FEATURE, asked for twice: "add a hint on the settings page where
              the theme is, and make sure it's stated that EyeGo is best suited
              for dark mode."

              It is not a preference we are hiding — light mode is fully built
              and stays switchable. But this app is a dark product: the map
              styles, the ambient shader and the whole elevation system were
              designed against a deep ground, and a rider who flips this without
              being told is choosing the less-finished half of the app. Saying
              so under the control is what a hint is for.
            */}
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="moon-outline" size={20} color={colors.onSurfaceVariant} />
                <View style={styles.rowText}>
                  <Text variant="bodyMedium" color={colors.onSurface}>Dark Mode</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant} style={styles.rowHint}>
                    EyeGo is designed for dark mode — the map, the motion and the
                    depth are all tuned for it. Light mode works, but this is how
                    it is meant to look.
                  </Text>
                </View>
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
          entering={FadeInDown.delay(130).springify()
            .stiffness(springs.standard.stiffness)
            .damping(springs.standard.damping)
            .mass(springs.standard.mass)}
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="labelCaps" style={styles.sectionLabel}>
            NOTIFICATIONS
          </Text>
          <GlassSurface borderRadius={radii.xl} intensity="low" dark style={styles.card}>
            <Pressable style={styles.row} onPress={() => goDeeper('/profile/notification-preferences' as any)} accessibilityRole="button">
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
    // `flex-start`, not `center`: the dark-mode row now carries a two-line hint
    // under its label, and centring would float the icon halfway down it.
    alignItems: 'flex-start',
    gap: spacing.md,
    flex: 1,
  },
  /** Label + hint, stacked. `flex: 1` so the hint wraps instead of pushing the
   *  toggle off the row. */
  rowText: { flex: 1, gap: 2 },
  rowHint: { lineHeight: 17 },
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
