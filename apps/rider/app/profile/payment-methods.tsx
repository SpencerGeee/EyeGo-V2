import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button } from '@eyego/ui';
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
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </TouchableOpacity>
        <Text variant="titleSmall">Payment Methods</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          {isLoading ? (
            <View style={styles.emptyState}>
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>Loading...</Text>
            </View>
          ) : methods.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="card-outline" size={56} color={colors.onSurfaceVariant} />
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, marginTop: spacing.base }}>
                No payment methods saved
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {methods.map((method: any, index: number) => (
                <React.Fragment key={method.id}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '22' }]}>
                        <Ionicons
                          name={method.type === 'momo' ? 'phone-portrait-outline' : 'card-outline'}
                          size={20}
                          color={colors.primary}
                        />
                      </View>
                      <View>
                        <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                          {method.type === 'momo' ? 'Mobile Money' : 'Card'}
                        </Text>
                        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                          {method.type === 'momo'
                            ? method.number
                            : `•••• •••• •••• ${method.last4}`}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDelete(method.id)}
                      activeOpacity={0.7}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </React.Fragment>
              ))}
            </View>
          )}

          <View style={{ marginTop: spacing['2xl'] }}>
            <Button
              label="Add Payment Method"
              onPress={() => router.push('/payment/add-card')}
              variant="secondary"
            />
          </View>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
    divider: { height: 1, backgroundColor: colors.outlineVariant, marginHorizontal: spacing.base },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing['3xl'],
    },
  });
