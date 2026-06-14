import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button } from '@eyego/ui';
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
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle}>Add Payment Method</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Card Preview */}
        <MotiView
          from={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
          style={styles.cardContainer}
        >
          <BlurView intensity={40} tint="dark" style={styles.cardGlass}>
            <View style={styles.cardTop}>
              <Ionicons name="hardware-chip" size={36} color="rgba(255,255,255,0.8)" />
              <View style={styles.cardTypeBadge}>
                <Ionicons name="lock-closed" size={12} color="#FFFFFF" />
                <Text style={styles.cardTypeText}>Secured</Text>
              </View>
            </View>
            <View style={styles.cardMiddle}>
              <Text style={styles.cardNumberPreview}>{'•••• •••• •••• ••••'}</Text>
            </View>
            <View style={styles.cardBottom}>
              <View style={styles.cardMetaItem}>
                <Text style={styles.metaLabel}>CARDHOLDER</Text>
                <Text style={styles.metaValue}>YOUR NAME</Text>
              </View>
              <View style={styles.cardMetaItemRight}>
                <Text style={styles.metaLabel}>EXPIRES</Text>
                <Text style={styles.metaValue}>MM/YY</Text>
              </View>
            </View>
          </BlurView>
        </MotiView>

        {/* Info */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, delay: 100 }}
          style={styles.infoCard}
        >
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark" size={22} color="#4CAF50" />
            <Text variant="bodyMedium" style={styles.infoText}>
              Card details are entered on Paystack's encrypted, PCI-compliant checkout — your card number never touches our servers.
            </Text>
          </View>
          <View style={[styles.infoRow, { marginTop: spacing.md }]}>
            <Ionicons name="information-circle-outline" size={22} color="rgba(255,255,255,0.4)" />
            <Text variant="bodySmall" style={[styles.infoText, { color: 'rgba(255,255,255,0.45)' }]}>
              A ₵0.50 verification charge will be made and your card saved for future one-tap payments.
            </Text>
          </View>
        </MotiView>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={isSaving ? 'Opening checkout...' : 'Add Card Securely'}
          onPress={handleAddCard}
          loading={isSaving}
        />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050508' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  headerTitle: { color: '#FFFFFF', fontFamily: fonts.bold },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  cardContainer: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    aspectRatio: 1.586,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  cardGlass: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
    gap: 4,
  },
  cardTypeText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  cardMiddle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardNumberPreview: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
    letterSpacing: 2,
    textAlign: 'center',
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardMetaItem: { flex: 1, paddingRight: spacing.md },
  cardMetaItemRight: { alignItems: 'flex-end' },
  metaLabel: {
    fontSize: 9,
    fontFamily: fonts.bold,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.base,
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  infoText: {
    flex: 1,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
  },
  footer: {
    padding: spacing['2xl'],
    paddingBottom: Platform.OS === 'ios' ? spacing['2xl'] : spacing.xl,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: '#050508',
  },
});
