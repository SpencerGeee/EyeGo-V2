import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, GlowSearchInput, ShinyText, AppBackground } from '@eyego/ui';
import { bookingsApi, apiClient } from '@eyego/api';
import { useRideStore } from '../../stores/ride.store';
import { useAuthStore } from '../../stores/auth.store';

export default function PromotionsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [promoCode, setPromoCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [promoStatus, setPromoStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const { activeBooking, setPendingPromoCode } = useRideStore();
  const { user } = useAuthStore();
  const referralCode = user?.referralCode ?? null;

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setIsValidating(true);
    setPromoStatus('idle');
    try {
      if (activeBooking?.id) {
        await bookingsApi.applyPromo(activeBooking.id, promoCode.trim());
        setPromoStatus('success');
      } else {
        // Validate code against backend before saving for next booking
        const res = await apiClient.get<{ success: boolean; data?: { valid: boolean } }>(
          `/bookings/promos/validate?code=${promoCode.trim().toUpperCase()}`
        );
        if (res.data?.success && res.data?.data?.valid) {
          setPendingPromoCode(promoCode.trim().toUpperCase());
          setPromoStatus('success');
        } else {
          setPromoStatus('error');
        }
      }
    } catch {
      setPromoStatus('error');
    } finally {
      setIsValidating(false);
    }
  };

  const handleShare = async () => {
    try {
      if (!referralCode) return;
      await Share.share({
        message: `Join me on EyeGo and get GHS 10 off your first ride! Use my invite code: ${referralCode} https://eyego.app/invite/${referralCode}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall">Promotions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View
          >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            ENTER PROMO CODE
          </Text>
          <View style={styles.promoCard}>
            <GlowSearchInput
              containerStyle={{ flex: 1 }}
              leftIcon={<Ionicons name="ticket-outline" size={20} color={colors.onSurfaceVariant} />}
              placeholder="Enter code here"
              value={promoCode}
              onChangeText={(text) => {
                setPromoCode(text);
                setPromoStatus('idle');
              }}
              autoCapitalize="characters"
            />
            <Button
              label="Apply"
              onPress={handleApplyPromo}
              loading={isValidating}
              disabled={!promoCode.trim()}
              style={styles.applyBtn}
              fullWidth={false}
            />
          </View>
          {promoStatus === 'success' && (
            <Text variant="caption" color={colors.primary} style={styles.statusText}>
              {activeBooking?.id
                ? 'Promo applied to current booking!'
                : 'Promo saved! Will be applied to your next booking.'}
            </Text>
          )}
          {promoStatus === 'error' && (
            <Text variant="caption" color={colors.error} style={styles.statusText}>
              Invalid or expired promo code.
            </Text>
          )}
        </View>

        <View
          style={{ marginTop: spacing['2xl'] }}
        >
          <Text variant="label" color={colors.onSurfaceVariant} style={styles.sectionLabel}>
            REFER & EARN
          </Text>
          <View style={styles.referCard}>
            <View style={styles.referIconContainer}>
              <Ionicons name="gift-outline" size={32} color={colors.primary} />
            </View>
            <Text variant="titleMedium" style={styles.referTitle}>Get GHS 10 off</Text>
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.referDesc}>
              Invite friends to EyeGo. They get GHS 10 off their first ride, and you get GHS 10 when they complete it.
            </Text>
            
            {referralCode ? (
              <View style={styles.codeContainer}>
                <Text variant="label" color={colors.onSurfaceVariant}>YOUR CODE</Text>
                <ShinyText
                  baseColor={colors.primary}
                  textStyle={[{ fontFamily: fonts.semiBold, fontSize: fontSizes.titleLarge }, styles.codeText]}
                >
                  {referralCode}
                </ShinyText>
              </View>
            ) : null}

            <Button
              label="Share Invite Link"
              onPress={handleShare}
              variant="secondary"
              disabled={!referralCode}
              style={styles.shareBtn}
            />
          </View>
        </View>
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
  promoCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radii.lg,
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyMedium,
    lineHeight: Math.round(fontSizes.bodyMedium * 1.4),
    color: colors.onSurface,
  },
  applyBtn: {
    height: 48,
    paddingHorizontal: spacing.xl,
  },
  statusText: {
    marginTop: spacing.sm,
    marginLeft: spacing.sm,
  },
  referCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing['2xl'],
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
  },
  referIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  referTitle: {
    marginBottom: spacing.sm,
  },
  referDesc: {
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  codeContainer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
    marginBottom: spacing.xl,
    width: '100%',
  },
  codeText: {
    marginTop: spacing.xs,
    letterSpacing: 2,
  },
  shareBtn: {
    width: '100%',
  },
});
