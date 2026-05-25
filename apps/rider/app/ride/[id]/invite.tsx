import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, Share, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { bookingsApi } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, AnimatedFareText } from '@eyego/ui';
import type { GroupMember } from '@eyego/types';

function formatCurrency(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

export default function InviteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { activeBooking, selectedTrip, setSelectedTrip, computedFare } = useRideStore();
  const [copied, setCopied] = useState(false);
  const [payForEveryone, setPayForEveryone] = useState(false);
  const [heavyCargo, setHeavyCargo] = useState(false);

  const generateInvite = useMutation({
    mutationFn: () => bookingsApi.generateInvite(activeBooking?.id ?? id ?? ''),
  });

  const { data: groupData } = useQuery({
    queryKey: ['group', activeBooking?.id],
    queryFn: () => bookingsApi.getGroup(activeBooking?.id ?? ''),
    enabled: !!activeBooking?.id,
    refetchInterval: 5000,
  });

  const inviteLink = generateInvite.data?.data.data.inviteLink ?? '';
  const members = groupData?.data.data.members ?? [];

  const togglePayForEveryone = () => {
    const next = !payForEveryone;
    setPayForEveryone(next);
    setSelectedTrip({
      ...selectedTrip,
      payForEveryone: next,
      selectedSeatCount: members.length + 1,
    } as any);
  };

  const toggleHeavyCargo = () => {
    const next = !heavyCargo;
    setHeavyCargo(next);
    setSelectedTrip({
      ...selectedTrip,
      heavyCargo: next,
    } as any);
  };

  useEffect(() => {
    generateInvite.mutate();
  }, []);

  const handleCopy = async () => {
    if (inviteLink) {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (inviteLink) {
      await Share.share({
        message: `Join my EyeGo ride! Tap to book your seat: ${inviteLink}`,
        title: 'Join my EyeGo ride',
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium">Group Hub</Text>
        <Pressable onPress={() => router.replace(`/ride/${id}/payment` as any)}>
          <Text variant="label" color={colors.primary}>Pay</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Invite link card */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 100 }}
          style={styles.inviteCard}
        >
          <Ionicons name="people-outline" size={28} color={colors.primary} />
          <Text variant="titleMedium" style={{ marginTop: spacing.base }}>
            Invite your group
          </Text>
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.sm }}>
            Share this link so your group can book seats on the same ride.
          </Text>

          {/* Link preview */}
          <Pressable style={styles.linkBox} onPress={handleCopy}>
            <Text
              variant="bodySmall"
              color={colors.onSurfaceVariant}
              numberOfLines={1}
              style={{ flex: 1 }}
            >
              {inviteLink || 'Generating link...'}
            </Text>
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={16}
              color={copied ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>

          {/* Share button */}
          <Button
            label="Share Invite Link"
            onPress={handleShare}
            disabled={!inviteLink}
            loading={generateInvite.isPending}
          />
        </MotiView>

        {/* Members list */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 200 }}
          style={styles.membersSection}
        >
          <View style={styles.membersHeader}>
            <Text variant="titleSmall">Members</Text>
            <View style={styles.countBadge}>
              <Text variant="caption" color={colors.primary}>{members.length + 1}</Text>
            </View>
          </View>

          {/* You */}
          <MemberRow name="You (Host)" seatNumber={activeBooking?.seatNumber ?? 1} isHost />

          {/* Others */}
          {members.map((member, i) => (
            <MotiView
              key={member.bookingId}
              from={{ opacity: 0, translateX: -10 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: i * 60 }}
            >
              <MemberRow name={member.passengerName} seatNumber={member.seatNumber} />
            </MotiView>
          ))}

          {members.length === 0 && (
            <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ textAlign: 'center', padding: spacing.base }}>
              No one has joined yet. Share the link above.
            </Text>
          )}
        </MotiView>

        {/* Group Options Card */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 250 }}
          style={styles.optionsCard}
        >
          <Text variant="titleSmall" style={{ marginBottom: spacing.md }}>Group Settings</Text>

          {/* Paying for everyone */}
          <Pressable style={styles.optionRow} onPress={togglePayForEveryone}>
            <View style={styles.optionLeft}>
              <View style={[styles.optionIconContainer, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="card-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">I'm paying for everyone</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>Charge all group seats to my checkout</Text>
              </View>
            </View>
            <View style={[styles.checkbox, payForEveryone && styles.checkboxSelected]}>
              {payForEveryone && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
            </View>
          </Pressable>

          <View style={styles.optionDivider} />

          {/* Heavy cargo in group */}
          <Pressable style={styles.optionRow} onPress={toggleHeavyCargo}>
            <View style={styles.optionLeft}>
              <View style={[styles.optionIconContainer, { backgroundColor: colors.secondary + '18' }]}>
                <Ionicons name="briefcase-outline" size={18} color={colors.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">Heavy cargo in group</Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>Add large luggage/surcharge (+GHS 10.00)</Text>
              </View>
            </View>
            <View style={[styles.checkbox, heavyCargo && styles.checkboxSelected]}>
              {heavyCargo && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
            </View>
          </Pressable>
        </MotiView>

        {/* Group fare summary */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 280 }}
          style={[styles.fareSummary, { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xs }]}
        >
          {/* Total Fare */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="caption" color={colors.onSurfaceVariant}>Total Group Fare</Text>
            <Text variant="titleMedium" color={colors.onSurface} style={{ fontFamily: fonts.semiBold }}>
              {formatCurrency(
                ((selectedTrip as any)?.totalTripCost
                  ?? (computedFare ?? selectedTrip?.fare ?? 8.5) * (members.length + 1))
                + (heavyCargo ? 10 : 0)
              )}
            </Text>
          </View>

          <View style={{ height: 1, backgroundColor: colors.outlineVariant, marginVertical: 4, opacity: 0.5 }} />

          {/* Split / Your Share. When "pay for all" is on, the host owes the whole
              server-calculated trip cost — not perSeat × members. Falls back to the
              old multiplier estimate only when the server didn't attach totalTripCost. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="caption" color={colors.onSurfaceVariant}>
              {payForEveryone ? "Your Share (You pay for all)" : "Your Split Share"}
            </Text>
            <AnimatedFareText
              value={
                payForEveryone
                  ? ((selectedTrip as any)?.totalTripCost
                      ?? (computedFare ?? selectedTrip?.fare ?? 8.5) * (members.length + 1))
                    + (heavyCargo ? 10 : 0)
                  : (computedFare ?? selectedTrip?.fare ?? 8.5) + (heavyCargo ? 10 : 0)
              }
              variant="fareMedium"
            />
          </View>
        </MotiView>

        {/* Proceed to payment */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 300 }}
        >
          <Button
            label="Proceed to Payment"
            onPress={() => router.push(`/ride/${id}/payment` as any)}
          />
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

function MemberRow({
  name,
  seatNumber,
  isHost,
}: {
  name: string;
  seatNumber: number;
  isHost?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberAvatar}>
        <Text style={{ fontSize: 18 }}>👤</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium">{name}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant}>Seat #{seatNumber}</Text>
      </View>
      {isHost && (
        <View style={styles.hostBadge}>
          <Text style={styles.hostBadgeText}>Host</Text>
        </View>
      )}
      <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
    </View>
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
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['2xl'],
    gap: spacing.xl,
  },
  inviteCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.md,
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outline,
    gap: spacing.sm,
    width: '100%',
  },
  membersSection: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    gap: spacing.sm,
  },
  membersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  countBadge: {
    backgroundColor: 'rgba(75, 226, 119, 0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostBadge: {
    backgroundColor: 'rgba(75, 226, 119, 0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    marginRight: spacing.xs,
  },
  hostBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: colors.primary,
  },
  optionsCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii['2xl'],
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    paddingRight: spacing.sm,
  },
  optionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionDivider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    opacity: 0.5,
  },
  fareSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
