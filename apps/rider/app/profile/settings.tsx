import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Toggle } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useColors();
  const { isDark, setDark } = useThemeStore();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { t } = useTranslation();
  const [pushNotifications, setPushNotifications] = useState(true);
  const [emailReceipts, setEmailReceipts] = useState(true);
  const [smsUpdates, setSmsUpdates] = useState(false);
  const [accessibilityPings, setAccessibilityPings] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language ?? 'en');

  const LANGUAGES = [
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'fr', label: 'Français', flag: '🇫🇷' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'tw', label: 'Twi', flag: '🇬🇭' },
  ];

  const selectLanguage = async (code: string) => {
    await i18n.changeLanguage(code);
    setCurrentLang(code);
    await AsyncStorage.setItem('eyego_language', code);
    setShowLangModal(false);
  };

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
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            GENERAL
          </Text>
          <View style={styles.card}>
            <Pressable style={styles.row} onPress={() => setShowLangModal(true)}>
              <View style={styles.rowLeft}>
                <Ionicons name="language-outline" size={20} color={colors.onSurfaceVariant} />
                <Text variant="bodyMedium" color={colors.onSurface}>Language</Text>
              </View>
              <View style={styles.rowRight}>
                <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                  {LANGUAGES.find(l => l.code === currentLang)?.label ?? 'English'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
              </View>
            </Pressable>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="moon-outline" size={20} color={colors.onSurfaceVariant} />
                <Text variant="bodyMedium" color={colors.onSurface}>Dark Mode</Text>
              </View>
              <Toggle value={isDark} onValueChange={setDark} />
            </View>
          </View>
        </MotiView>

        {/* Notifications */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            NOTIFICATIONS
          </Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="notifications-outline" size={20} color={colors.onSurfaceVariant} />
                <View>
                  <Text variant="bodyMedium" color={colors.onSurface}>Push Notifications</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>Ride updates and promos</Text>
                </View>
              </View>
              <Toggle value={pushNotifications} onValueChange={setPushNotifications} />
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="mail-outline" size={20} color={colors.onSurfaceVariant} />
                <View>
                  <Text variant="bodyMedium" color={colors.onSurface}>Email Receipts</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>Receive trip receipts</Text>
                </View>
              </View>
              <Toggle value={emailReceipts} onValueChange={setEmailReceipts} />
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="chatbubble-outline" size={20} color={colors.onSurfaceVariant} />
                <View>
                  <Text variant="bodyMedium" color={colors.onSurface}>SMS Updates</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>Important alerts via SMS</Text>
                </View>
              </View>
              <Toggle value={smsUpdates} onValueChange={setSmsUpdates} />
            </View>
          </View>
        </MotiView>

        {/* Accessibility */}
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 80 }}
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            ACCESSIBILITY
          </Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="volume-high-outline" size={20} color={colors.onSurfaceVariant} />
                <View>
                  <Text variant="bodyMedium" color={colors.onSurface}>Audio Pings</Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>Sound alerts for ride status</Text>
                </View>
              </View>
              <Toggle value={accessibilityPings} onValueChange={setAccessibilityPings} />
            </View>
          </View>
        </MotiView>
      </ScrollView>

      {/* Language Picker Modal */}
      <Modal visible={showLangModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing['2xl'] }}>
            <Text variant="titleMedium">Choose Language</Text>
            <Pressable onPress={() => setShowLangModal(false)}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.code}
              onPress={() => selectLanguage(lang.code)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base, padding: spacing['2xl'], borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}
            >
              <Text style={{ fontSize: 24, lineHeight: 30 }}>{lang.flag}</Text>
              <Text variant="bodyMedium" style={{ flex: 1 }}>{lang.label}</Text>
              {currentLang === lang.code && <Ionicons name="checkmark" size={20} color={colors.primary} />}
            </Pressable>
          ))}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
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
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
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
