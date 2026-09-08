import React, { useMemo } from 'react';
import { View, StyleSheet, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Pressable, Avatar, GlassSurface } from '@eyego/ui';
import { formatGhs } from '@eyego/utils';
import { useColors, type DriverColors } from '../../utils/useColors';

/**
 * ── THE PASSENGER, AS A DESIGNED SURFACE ─────────────────────────────────────
 *
 * REDESIGN ("on the manage page, the way the modal that's shown when you tap on
 * the seat is designed, it's very basic").
 *
 * It was basic because it was not designed at all: tapping a seat called
 * `Alert.alert()` with six lines of text joined by newlines and up to five
 * stacked OS buttons. That is the system's error dialog being used as a
 * passenger record. It cannot show an avatar, it cannot show money as money, it
 * gives "Call" and "Mark No-Show" identical weight, and on Android it renders in
 * Material's own colours in the middle of an app that has none of them.
 *
 * ── WHAT THE DRIVER IS ACTUALLY DOING ───────────────────────────────────────
 * Standing at a kerb, holding a phone, looking for one person in a crowd, at
 * night. So the sheet is built in that order of need:
 *
 *   IDENTITY   The face and the name, at the top, at size — this is the thing
 *              being matched against a human being. A guest booking names the
 *              traveller AND the booker, because they are two different people
 *              and the driver may need either.
 *   STATE      Three facts, as a row of chips, not a paragraph: the seat, the
 *              money, and whether they are aboard. Each is scannable alone.
 *   ACTIONS    Reach them first (call, message — the things done BEFORE a
 *              decision), then the decision itself, then the destructive one,
 *              separated and in the error colour, because "Mark No-Show" costs
 *              the passenger their ride and cannot be undone from here.
 */

export interface PassengerSheetData {
  bookingId: string | null;
  name: string;
  /** The account that booked, when that is not the traveller. */
  bookedBy?: string | null;
  /** Who is paying for this seat, when somebody else is. */
  coveredBy?: string | null;
  phone?: string | null;
  photo?: string | null;
  seatNumber?: number | null;
  /** How many seats this one booking occupies. */
  seatsHeld?: number;
  farePesewas?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  boarded?: boolean;
  noShow?: boolean;
  /** Seat is only held, not paid for. */
  held?: boolean;
  /** Rider has verification on — a code will be asked for. */
  needsPin?: boolean;
}

export interface PassengerSheetProps {
  passenger: PassengerSheetData | null;
  onClose: () => void;
  onMessage?: (p: PassengerSheetData) => void;
  onBoard?: (p: PassengerSheetData) => void;
  onNoShow?: (p: PassengerSheetData) => void;
}

export function PassengerSheet({
  passenger,
  onClose,
  onMessage,
  onBoard,
  onNoShow,
}: PassengerSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  if (!passenger) return null;
  const p = passenger;
  const paid = String(p.paymentStatus ?? '').toUpperCase() === 'PAID';

  const call = () => {
    if (!p.phone) return;
    void Haptics.selectionAsync().catch(() => {});
    void Linking.openURL(`tel:${p.phone}`);
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View
        entering={reduced ? undefined : FadeIn.duration(160)}
        exiting={reduced ? undefined : FadeOut.duration(120)}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>

      <View style={styles.dock} pointerEvents="box-none">
        <Animated.View
          // Enters from below because that is where it came from — the sheet is
          // a continuation of the row that was tapped, not a new context.
          entering={reduced ? undefined : FadeInDown.springify().damping(18).mass(0.7)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['3xl']} intensity="high" />
          <View style={styles.grabber} />

          {/* ── IDENTITY ── */}
          <View style={styles.head}>
            <Avatar uri={p.photo ?? undefined} name={p.name} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {p.name}
              </Text>
              {p.bookedBy ? (
                <Text style={styles.sub} numberOfLines={1}>
                  Travelling as a guest · booked by {p.bookedBy}
                </Text>
              ) : p.coveredBy ? (
                <Text style={styles.sub} numberOfLines={1}>
                  Seat covered by {p.coveredBy}
                </Text>
              ) : p.phone ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {p.phone}
                </Text>
              ) : (
                <Text style={styles.sub} numberOfLines={1}>
                  No phone number on this booking
                </Text>
              )}
            </View>
            <Pressable
              onPress={onClose}
              style={styles.close}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* ── STATE — three chips, each readable on its own ── */}
          <View style={styles.chips}>
            <Chip
              icon="grid-outline"
              label={
                p.seatNumber != null
                  ? p.seatsHeld && p.seatsHeld > 1
                    ? `Seat ${p.seatNumber} +${p.seatsHeld - 1}`
                    : `Seat ${p.seatNumber}`
                  : 'No seat'
              }
              tone={colors.onSurfaceVariant}
              styles={styles}
            />
            <Chip
              icon={paid ? 'checkmark-circle-outline' : 'cash-outline'}
              label={
                p.farePesewas != null
                  ? paid
                    ? `${formatGhs(p.farePesewas)} paid`
                    : `${formatGhs(p.farePesewas)} due`
                  : paid
                    ? 'Paid'
                    : 'Unpaid'
              }
              tone={paid ? colors.primary : colors.statusWarning}
              styles={styles}
            />
            <Chip
              icon={p.noShow ? 'close-circle-outline' : p.boarded ? 'person-outline' : 'time-outline'}
              label={p.noShow ? 'No show' : p.boarded ? 'Aboard' : p.held ? 'Seat held' : 'Waiting'}
              tone={p.noShow ? colors.error : p.boarded ? colors.primary : colors.onSurfaceVariant}
              styles={styles}
            />
          </View>

          {p.needsPin && !p.boarded ? (
            <View style={styles.pinNote}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.primary} />
              <Text style={styles.pinNoteText}>
                Ride verification is on — they will read you a 4-digit code.
              </Text>
            </View>
          ) : null}

          {/* ── REACH THEM ── */}
          <View style={styles.reachRow}>
            <Pressable
              onPress={call}
              disabled={!p.phone}
              style={[styles.reachBtn, !p.phone && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel={`Call ${p.name}`}
            >
              <Ionicons name="call-outline" size={17} color={colors.onSurface} />
              <Text style={styles.reachText}>Call</Text>
            </Pressable>
            <Pressable
              onPress={() => onMessage?.(p)}
              disabled={!onMessage}
              style={styles.reachBtn}
              accessibilityRole="button"
              accessibilityLabel={`Message ${p.name}`}
            >
              <Ionicons name="chatbubble-outline" size={17} color={colors.onSurface} />
              <Text style={styles.reachText}>Message</Text>
            </Pressable>
          </View>

          {/* ── THE DECISION ── */}
          {!p.boarded && !p.noShow && onBoard ? (
            <Pressable
              onPress={() => onBoard(p)}
              style={styles.primary}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${p.name} boarded`}
            >
              <Ionicons name="checkmark" size={18} color={colors.onPrimary ?? '#0A0D14'} />
              <Text style={styles.primaryText}>Mark boarded</Text>
            </Pressable>
          ) : null}

          {/*
            Separated by a rule and coloured as an error, because it is the one
            action here that takes something away from somebody and cannot be
            undone from this side. In the Alert it was a button in the same
            stack as "Call".
          */}
          {!p.boarded && !p.noShow && onNoShow ? (
            <>
              <View style={styles.rule} />
              <Pressable
                onPress={() => onNoShow(p)}
                style={styles.danger}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${p.name} as a no-show`}
              >
                <Ionicons name="person-remove-outline" size={16} color={colors.error} />
                <Text style={[styles.dangerText, { color: colors.error }]}>
                  Mark no-show &amp; free the seat
                </Text>
              </Pressable>
            </>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function Chip({
  icon,
  label,
  tone,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.chip, { borderColor: `${tone}55`, backgroundColor: `${tone}14` }]}>
      <Ionicons name={icon} size={13} color={tone} />
      <Text style={[styles.chipText, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.58)' },
    dock: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      marginHorizontal: spacing.sm,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderRadius: radii['3xl'],
      borderWidth: 1,
      borderColor: colors.rimLight,
      backgroundColor: colors.surfaceContainerHigh,
      overflow: 'hidden',
      gap: spacing.base,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.outline,
      marginBottom: spacing.sm,
    },

    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    name: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.titleMedium,
      color: colors.onSurface,
    },
    sub: {
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurfaceVariant,
      marginTop: 2,
    },
    close: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainer,
    },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.full,
      borderWidth: 1,
    },
    chipText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.caption,
      fontVariant: ['tabular-nums'],
    },

    pinNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: `${colors.primary}12`,
      borderWidth: 1,
      borderColor: `${colors.primary}33`,
    },
    pinNoteText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodySmall,
      color: colors.onSurface,
      lineHeight: 18,
    },

    reachRow: { flexDirection: 'row', gap: spacing.sm },
    reachBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 46,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainer,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
    reachText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },

    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 52,
      borderRadius: radii.full,
      backgroundColor: colors.primary,
    },
    primaryText: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyLarge,
      color: colors.onPrimary ?? '#0A0D14',
    },

    rule: { height: 1, backgroundColor: colors.outlineVariant, marginTop: spacing.xs },
    danger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: 46,
    },
    dangerText: {
      fontFamily: fonts.medium,
      fontSize: fontSizes.bodyMedium,
    },
  });
