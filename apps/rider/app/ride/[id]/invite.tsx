import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet, Pressable, Share, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { bookingsApi, tripsApi } from '@eyego/api';
import { useRideStore } from '../../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../../utils/useColors';
import { Text, Button, AnimatedFareText, Loader } from '@eyego/ui';
import type { GroupMember, Trip } from '@eyego/types';

function formatCurrency(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

type LinkState = 'generating' | 'ready' | 'error';

export default function InviteScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { activeBooking, selectedTrip, setSelectedTrip, setActiveBooking, computedFare } = useRideStore();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [payForEveryone, setPayForEveryone] = useState(false);
  const [heavyCargo, setHeavyCargo] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>('generating');
  const [bookingReady, setBookingReady] = useState(false);

  // ── Step 1: Ensure a booking exists ───────────────────────────────────
  // If the user has an active booking, use it. Otherwise, create one so we
  // have a real booking ID — never fall back to the trip ID.
  const createBooking = useMutation({
    mutationFn: async () => {
      // Reserve the first AVAILABLE seat instead of hard-coding seat #1. The
      // backend keys on `seatNumber` (the `seatId` string is ignored) and rejects
      // an already-taken seat with SeatTakenError — so the old hard-coded
      // seatNumber:1 failed for the host whenever seat 1 was occupied. Fall back
      // to 1 only if the seat map can't be read.
      let seatNumber = 1;
      try {
        const seatsRes = await tripsApi.getSeats(id ?? '');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seats: any[] = (seatsRes.data as any)?.data ?? [];
        const firstFree = Array.isArray(seats)
          ? seats.find((s) => s?.status === 'AVAILABLE')
          : null;
        if (firstFree?.seatNumber) seatNumber = firstFree.seatNumber;
      } catch {
        // keep the seatNumber=1 fallback
      }
      const { data } = await bookingsApi.create({
        tripId: id ?? '',
        seatId: `seat-${seatNumber}`,
        seatNumber,
        paymentMethod: 'CASH' as any,
      });
      return data.data;
    },
    onSuccess: (bookingData) => {
      setActiveBooking(bookingData);
      setBookingReady(true);
    },
    onError: () => {
      setBookingReady(false);
    },
  });

  // If we already have an active booking, we're ready immediately.
  // Otherwise, create one.
  useEffect(() => {
    if (activeBooking?.id) {
      setBookingReady(true);
    } else {
      createBooking.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 2: Generate the invite link once we have a booking ───────────
  // The bookingId is always a real booking ID — never the trip id.
  const bookingId = activeBooking?.id ?? '';

  const generateInvite = useMutation({
    mutationFn: () => bookingsApi.generateInvite(bookingId),
    onSuccess: () => {
      setLinkState('ready');
    },
    onError: (err: any) => {
      setLinkState('error');
      console.warn('[Invite] Generate failed:', err?.message ?? err);
    },
  });

  // Generate invite once booking is ready.
  // BUGFIX (stuck on "Generating…" forever): the previous guard required
  // `bookingReady && bookingId && linkState==='generating'` all true — so if the
  // booking became "ready" but `bookingId` was empty (create returned no id, or
  // the host arrived without one), the block never ran: no mutate, no safety
  // timer, and the spinner showed forever. We now handle every branch so the
  // "generating" state is always escapable, and the safety timer uses a
  // functional updater (the old `generateInvite.isPending` read a stale closure).
  useEffect(() => {
    if (!bookingReady) return;
    if (!bookingId) {
      setLinkState((prev) => (prev === 'generating' ? 'error' : prev));
      return;
    }
    if (linkState === 'generating') {
      generateInvite.mutate();
      const safetyTimer = setTimeout(() => {
        setLinkState((prev) => (prev === 'generating' ? 'error' : prev));
      }, 15000);
      return () => clearTimeout(safetyTimer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingReady, bookingId]);

  const inviteLink = generateInvite.data?.data?.data?.inviteLink ?? '';

  const { data: groupData } = useQuery({
    queryKey: ['group', bookingId],
    queryFn: () => bookingsApi.getGroup(bookingId),
    enabled: !!bookingId && !!inviteLink,
    refetchInterval: 5000,
  });

  const members = groupData?.data?.data?.members ?? [];

  // R4: enforce the group member limit on the client. The trip's totalSeats is
  // the hard cap (server rejects over-booking at seat-claim time); here we stop
  // advertising the invite link once host + joined members fill the trip, so we
  // don't invite people who can't actually get a seat.
  const seatLimit =
    (selectedTrip as { totalSeats?: number; maxSeats?: number })?.totalSeats ??
    (selectedTrip as { maxSeats?: number })?.maxSeats ??
    0;
  const groupSize = members.length + 1; // +1 for the host
  const groupFull = seatLimit > 0 && groupSize >= seatLimit;

  const togglePayForEveryone = () => {
    const next = !payForEveryone;
    setPayForEveryone(next);
    setSelectedTrip({
      ...selectedTrip,
      payForEveryone: next,
      selectedSeatCount: members.length + 1,
    } as Trip & { payForEveryone?: boolean; selectedSeatCount?: number; heavyCargo?: boolean });
  };

  const toggleHeavyCargo = () => {
    const next = !heavyCargo;
    setHeavyCargo(next);
    setSelectedTrip({
      ...selectedTrip,
      heavyCargo: next,
    } as Trip & { payForEveryone?: boolean; selectedSeatCount?: number; heavyCargo?: boolean });
  };

  const handleRetry = useCallback(() => {
    setLinkState('generating');
    generateInvite.mutate();
  }, [generateInvite]);

  const handleCopy = async () => {
    if (inviteLink) {
      await Clipboard.setStringAsync(inviteLink);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
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

  // ── Actionable empty state: no booking ─────────────────────────────────
  if (!bookingReady && createBooking.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleMedium">Group Hub</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Loader label="Reserving your seat…" />
        </View>
      </SafeAreaView>
    );
  }

  if (!bookingReady && createBooking.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleMedium">Group Hub</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.base, textAlign: 'center' }}>
            Could not reserve a seat. The trip may be full.
          </Text>
          <Button
            label="Try Again"
            onPress={() => createBooking.mutate()}
            loading={createBooking.isPending}
            style={{ marginTop: spacing.xl }}
          />
          <Button
            label="Back to Seat Selection"
            variant="ghost"
            onPress={() => router.replace(`/ride/${id}/seat` as Href)}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium">Group Hub</Text>
        <Pressable onPress={() => router.replace(`/ride/${id}/payment` as Href)}>
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

          {/* Link preview — three states: generating / ready / error */}
          {linkState === 'generating' && (
            <View style={styles.linkBox}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text variant="bodySmall" color={colors.onSurfaceVariant}>
                Generating invite link...
              </Text>
            </View>
          )}

          {linkState === 'ready' && (
            <Pressable style={styles.linkBox} onPress={handleCopy}>
              <Text
                variant="bodySmall"
                color={colors.onSurfaceVariant}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {inviteLink}
              </Text>
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copied ? colors.primary : colors.onSurfaceVariant}
              />
            </Pressable>
          )}

          {linkState === 'error' && (
            <Pressable style={[styles.linkBox, { borderColor: colors.error + '50' }]} onPress={handleRetry}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text
                variant="bodySmall"
                color={colors.error}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                Couldn't create link — Tap to retry
              </Text>
            </Pressable>
          )}

          {/* Group-full notice — the trip's seats are all taken */}
          {groupFull && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Ionicons name="information-circle-outline" size={14} color={colors.onSurfaceVariant} />
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
                Your group is full ({groupSize}/{seatLimit} seats). You can't invite more riders.
              </Text>
            </View>
          )}

          {/* Share button — disabled once the group fills the trip */}
          <Button
            label={groupFull ? 'Group Full' : 'Share Invite Link'}
            onPress={handleShare}
            disabled={linkState !== 'ready' || groupFull}
            loading={linkState === 'generating'}
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

          {/* Split / Your Share */}
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
            variant="glow"
            label="Proceed to Payment"
            onPress={() => router.push(`/ride/${id}/payment` as Href)}
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
        <Ionicons name="person" size={18} color={colors.onSurfaceVariant} />
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
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    gap: spacing.md,
  },
});
