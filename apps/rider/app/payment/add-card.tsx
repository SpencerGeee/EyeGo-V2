import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { fonts, fontSizes, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, GlassSurface, GradientGlowBorder, PREMIUM_RING_COLORS, PREMIUM_RING_LOCATIONS, LensSheen } from '@eyego/ui';
import { walletApi } from '@eyego/api';
import { useQueryClient } from '@tanstack/react-query';

export default function AddCardScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const handleAddCard = async () => {
    setIsSaving(true);
    try {
      // Step 1: Initialize Paystack hosted checkout for card tokenization
      const initRes = await walletApi.initializeCardSave();
      const { reference, authorizationUrl } = (initRes.data as any).data;

      // Step 2: Open Paystack's PCI-compliant secure checkout
      await WebBrowser.openBrowserAsync(authorizationUrl, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });

      // Step 3: After browser closes, verify and save the card
      try {
        const verifyRes = await walletApi.verifyCardSave(reference);
        const card = (verifyRes.data as any).data.card;
        // Invalidate cached payment methods so the list refreshes
        queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
        Alert.alert(
          'Card Saved',
          `${(card.brand as string).toUpperCase()} ending in ${card.last4} has been saved.`,
          [{ text: 'Done', onPress: () => router.back() }]
        );
      } catch (err: any) {
        const msg = err?.response?.data?.message ?? 'Card could not be verified. Please try again.';
        Alert.alert('Verification Failed', msg);
      }
    } catch (err: any) {
      if ((err as any)?.type !== 'cancel') {
        Alert.alert('Error', err?.response?.data?.message ?? 'Could not open checkout. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Add Payment Method</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Card Preview */}
        <MotiView
          from={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
        >
          {/* Card PREVIEW — premium glow ring with a slow LensSheen light
              sweep across the face; content inset by ring thickness (3). */}
          <GradientGlowBorder
            colors={PREMIUM_RING_COLORS}
            locations={PREMIUM_RING_LOCATIONS}
            fillColor={colors.surfaceCard}
            borderRadius={radii['2xl']}
            glow
            glowColor={colors.premiumBlue}
            glowColorSecondary={colors.premiumOrange}
            style={styles.cardPreview}
          >
          <LinearGradient
            colors={[colors.surfaceCard, colors.backgroundDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardFace}
          >
            <LensSheen />
            <View style={styles.cardChipRow}>
              <Ionicons name="hardware-chip" size={36} color={withOpacity(colors.onSurface, 0.85)} />
              <View style={styles.cardBadge}>
                <Ionicons name="lock-closed" size={11} color={colors.primary} />
                <Text style={styles.cardBadgeText}>Secured</Text>
              </View>
            </View>
            <View style={styles.cardNumberRow}>
              <Text style={styles.cardNumber}>{'••••  ••••  ••••  ••••'}</Text>
            </View>
            <View style={styles.cardMetaRow}>
              <View>
                <Text style={styles.cardMetaLabel}>CARDHOLDER</Text>
                <Text style={styles.cardMetaValue}>YOUR NAME</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.cardMetaLabel}>EXPIRES</Text>
                <Text style={styles.cardMetaValue}>MM/YY</Text>
              </View>
            </View>
          </LinearGradient>
          </GradientGlowBorder>
        </MotiView>

        {/* Info */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, delay: 80 }}
        >
          <GlassSurface borderRadius={radii.lg} intensity="low" dark style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIconWrap, { backgroundColor: withOpacity(colors.statusSuccess, 0.12) }]}>
              <Ionicons name="shield-checkmark" size={18} color={colors.statusSuccess} />
            </View>
            <Text variant="bodyMedium" style={styles.infoText}>
              Card details are entered on Paystack's encrypted, PCI-compliant checkout — your card number never touches our servers.
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <View style={[styles.infoIconWrap, { backgroundColor: colors.surfaceContainerHigh }]}>
              <Ionicons name="information-circle-outline" size={18} color={colors.onSurfaceVariant} />
            </View>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, flex: 1, lineHeight: 18 }}>
              A ₵0.50 verification charge will be made and your card saved for future one-tap payments.
            </Text>
          </View>
          </GlassSurface>
        </MotiView>
      </ScrollView>

      {/* Fixed footer */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleAddCard}
          disabled={isSaving}
          style={({ pressed }) => [styles.addBtn, isSaving && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.97 }] }]}
          accessibilityRole="button"
          accessibilityLabel="Add card securely"
        >
          <Ionicons name="lock-closed" size={18} color={colors.onPrimary} />
          <Text style={styles.addBtnText}>{isSaving ? 'Opening checkout…' : 'Add Card Securely'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.rimLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.md,
      paddingBottom: spacing['3xl'],
      gap: spacing.xl,
    },
    cardPreview: {
      borderRadius: radii['2xl'],
      overflow: 'hidden',
      aspectRatio: 1.586,
    },
    cardFace: {
      // Inset by the ring's stroke thickness (3) so the opaque card face
      // doesn't paint over the glow ring, and clipped to the inner radius.
      margin: 3,
      borderRadius: radii['2xl'] - 3,
      overflow: 'hidden',
      flex: 1,
      padding: spacing.xl,
      justifyContent: 'space-between',
    },
    cardChipRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    cardBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: withOpacity(colors.primary, 0.1),
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: withOpacity(colors.primary, 0.2),
    },
    cardBadgeText: {
      color: colors.primary,
      fontFamily: fonts.bold,
      fontSize: 10,
      lineHeight: 13,
      letterSpacing: 0.5,
    },
    cardNumberRow: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardNumber: {
      fontSize: 22,
      lineHeight: 28,
      fontFamily: fonts.displayBold,
      color: colors.onSurface,
      letterSpacing: 3,
      textAlign: 'center',
    },
    cardMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    cardMetaLabel: {
      fontSize: 9,
      lineHeight: 12,
      fontFamily: fonts.bold,
      color: colors.onSurfaceVariant,
      letterSpacing: 1.5,
      marginBottom: 4,
    },
    cardMetaValue: {
      fontSize: 14,
      lineHeight: 18,
      fontFamily: fonts.semiBold,
      color: colors.onSurface,
      letterSpacing: 1,
    },
    infoCard: {
      borderRadius: radii.lg,
      padding: spacing.base,
      gap: spacing.sm,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    infoIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    infoText: {
      flex: 1,
      color: colors.onSurfaceVariant,
      lineHeight: 20,
    },
    infoDivider: {
      height: 1,
      backgroundColor: colors.rimLightSubtle,
      marginHorizontal: 0,
    },
    footer: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.base,
      paddingBottom: spacing['2xl'],
      borderTopWidth: 1,
      borderTopColor: colors.rimLight,
      borderTopLeftRadius: radii['4xl'],
      borderTopRightRadius: radii['4xl'],
      backgroundColor: colors.backgroundDeep,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.primary,
      borderRadius: radii.full,
      paddingVertical: spacing.base + 2,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
    },
    addBtnText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleSmall,
      lineHeight: fontSizes.titleSmall * 1.3,
      color: colors.onPrimary,
    },
  });
