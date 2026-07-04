import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, GlassSurface } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { walletApi } from '@eyego/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function PaymentMethodsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: methods = [], isLoading } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => walletApi.getPaymentMethods(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => walletApi.deletePaymentMethod(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete payment method. Please try again.');
    },
  });

  const handleDelete = (id: string) => {
    Alert.alert('Remove Payment Method', 'Are you sure you want to remove this payment method?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall" style={{ color: colors.onSurface }}>Payment Methods</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
        >
          {isLoading ? (
            <View style={[styles.card, styles.cardSolid]}>
              {[1, 2].map((i) => (
                <React.Fragment key={i}>
                  {i > 1 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <View style={[styles.iconWrap, { backgroundColor: colors.surfaceContainerHigh }]} />
                      <View style={{ gap: 6 }}>
                        <View style={styles.skelLineWide} />
                        <View style={styles.skelLineNarrow} />
                      </View>
                    </View>
                  </View>
                </React.Fragment>
              ))}
            </View>
          ) : methods.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyGlow} pointerEvents="none" />
              <View style={styles.emptyIconWrap}>
                <Ionicons name="card-outline" size={40} color={colors.primary} />
              </View>
              <Text variant="titleSmall" style={{ color: colors.onSurface, marginTop: spacing.lg }}>
                No cards yet
              </Text>
              <Text variant="bodySmall" color={colors.onSurfaceVariant} style={styles.emptyCaption}>
                Add a card for fast, one-tap payments on every ride.
              </Text>
            </View>
          ) : (
            <GlassSurface borderRadius={radii.lg} intensity="low" dark style={styles.card}>
              {methods.map((method: any, index: number) => {
                const isMomo = method.type === 'momo';
                return (
                  <React.Fragment key={method.id}>
                    {index > 0 && <View style={styles.divider} />}
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}1A` }]}>
                          <Ionicons
                            name={isMomo ? 'phone-portrait-outline' : 'card'}
                            size={20}
                            color={colors.primary}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium" style={{ color: colors.onSurface }} numberOfLines={1}>
                            {isMomo ? 'Mobile Money' : (method.brand ? `${String(method.brand).toUpperCase()} Card` : 'Card')}
                          </Text>
                          <Text variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
                            {isMomo ? method.number : `•••• ${method.last4}`}
                          </Text>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => handleDelete(method.id)}
                        style={styles.deleteBtn}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Remove payment method"
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.statusError} />
                      </Pressable>
                    </View>
                  </React.Fragment>
                );
              })}
            </GlassSurface>
          )}

          {/* Secure note */}
          <View style={styles.secureNote}>
            <Ionicons name="lock-closed" size={13} color={colors.outline} />
            <Text style={styles.secureNoteText}>PCI DSS COMPLIANT · 256-BIT SSL</Text>
          </View>
        </MotiView>
      </ScrollView>

      {/* Fixed add button */}
      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && { transform: [{ scale: 0.97 }] }]}
          onPress={() => router.push('/payment/add-card')}
          accessibilityRole="button"
          accessibilityLabel="Add payment method"
        >
          <Ionicons name="add-circle" size={20} color={colors.onPrimary} />
          <Text style={styles.addBtnText}>Add Payment Method</Text>
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
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: 120,
    },
    card: {
      borderRadius: radii.lg,
      overflow: 'hidden',
    },
    cardSolid: {
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.06)',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.base,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: spacing.base },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing['3xl'],
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 24,
      backgroundColor: colors.surfaceCard ?? colors.surfaceContainer,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.06)',
    },
    emptyGlow: {
      position: 'absolute',
      top: -40,
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: `${colors.primary}15`,
    },
    emptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: `${colors.primary}1A`,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: `${colors.primary}33`,
    },
    emptyCaption: { marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: spacing.xl },
    skelLineWide: { width: 120, height: 12, borderRadius: 6, backgroundColor: colors.surfaceContainerHigh },
    skelLineNarrow: { width: 80, height: 10, borderRadius: 5, backgroundColor: colors.surfaceContainerHigh },
    secureNote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      marginTop: spacing.lg,
    },
    secureNoteText: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      letterSpacing: 1,
      color: colors.outline,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.backgroundDeep,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.08)',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing.lg,
      paddingBottom: spacing['2xl'],
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
