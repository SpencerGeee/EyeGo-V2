import React, { useMemo } from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors, Colors } from '../utils/useColors';

/**
 * Per-trip fare breakdown bottom sheet (matches the client's reference design).
 *
 * The exact line-item rates (wait-time, booking fee, fixed platform fee) are
 * presentational config — Ghana-market defaults that mirror the reference
 * screenshots and can be wired to backend config later. Fare, seats, promotion
 * and surge come from the live trip so the headline numbers are always real.
 */
export interface FareBreakdownSheetProps {
  visible: boolean;
  onClose: () => void;
  fare: number;
  seats: number;
  /** show the "prices temporarily higher" banner (surgeMultiplier > 1) */
  surge?: boolean;
  promotionPct?: number;
  /** presentational config — override per market/tier when backend exposes them */
  waitTimeRate?: number; // GH₵ per minute
  bookingFeePct?: number;
  platformFee?: number; // fixed GH₵
}

const gh = (n: number, dp = 2) => `GH₵${n.toFixed(dp)}`;

export function FareBreakdownSheet({
  visible,
  onClose,
  fare,
  seats,
  surge = false,
  promotionPct = 10,
  waitTimeRate = 0.98,
  bookingFeePct = 6.1,
  platformFee = 1.0,
}: FareBreakdownSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss price breakdown" accessibilityRole="button">
        {/* Stop propagation so taps inside the sheet don't close it */}
        <Pressable style={{ width: '100%' }} onPress={(e) => e.stopPropagation()}>
          <MotiView
            from={{ translateY: 40, opacity: 0 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            style={styles.sheet}
          >
            <View style={styles.grabber} />

            <View style={styles.headerRow}>
              <Text variant="titleMedium">Price details</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {/* Surge banner */}
              {surge && (
                <View style={styles.surgeBanner} accessibilityRole="alert">
                  <Ionicons name="chevron-up" size={18} color={'#A66A00'} />
                  <Text variant="bodySmall" style={{ flex: 1, color: '#7A4E00' }}>
                    Prices are temporarily higher due to increased demand.
                  </Text>
                </View>
              )}

              {/* Fare headline */}
              <View style={styles.fareHeader}>
                <Text variant="titleLarge">Fare</Text>
                <Text variant="fareMedium" color={colors.onSurface} style={{ fontWeight: '700' }}>
                  {gh(fare, 0)}
                </Text>
              </View>

              <DottedRow label="Wait time" value={`${gh(waitTimeRate)}/MIN`} colors={colors} styles={styles} />
              <DottedRow label="Booking Fee" value={`${bookingFeePct}%`} colors={colors} styles={styles} />
              <DottedRow label="Platform Fee" value={gh(platformFee)} colors={colors} styles={styles} />
              <DottedRow label="Promotion" value={`${promotionPct}%`} colors={colors} styles={styles} accent />
              <DottedRow label="Seats" value={String(seats)} colors={colors} styles={styles} />

              <Text variant="caption" color={colors.onSurfaceVariant} style={styles.disclaimer}>
                The price estimation can change if actual tolls/surcharges differ from estimation (city based).
                If the journey changes, the price will be based on rates provided.
              </Text>
            </ScrollView>
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DottedRow({
  label,
  value,
  colors,
  styles,
  accent,
}: {
  label: string;
  value: string;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  accent?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text variant="bodyMedium" color={colors.onSurface}>{label}</Text>
      <View style={styles.dottedLeader} />
      <Text variant="bodyMedium" color={accent ? colors.primary : colors.onSurface}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surfaceContainer ?? colors.background,
      borderTopLeftRadius: radii['2xl'],
      borderTopRightRadius: radii['2xl'],
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing['3xl'],
      maxHeight: '80%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.outline,
      marginBottom: spacing.base,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.base,
    },
    surgeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: '#FCEFC7',
      borderRadius: radii.lg,
      padding: spacing.base,
      marginBottom: spacing.lg,
    },
    fareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    dottedLeader: {
      flex: 1,
      borderBottomWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.outlineVariant,
      marginBottom: 5,
    },
    disclaimer: {
      marginTop: spacing.lg,
      lineHeight: 18,
    },
  });
