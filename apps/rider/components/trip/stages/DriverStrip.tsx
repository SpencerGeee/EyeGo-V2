import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Avatar } from '@eyego/ui';
import type { Colors } from '../../../utils/useColors';

/**
 * Who is coming, the way Uber and Bolt lay it out: the face, the name, the
 * car, and the PLATE as the biggest thing in the row — the one detail a rider
 * matches against a real vehicle at the kerb. Call and message sit at the end
 * of the same row, within thumb reach, so the peek detent answers "which car,
 * and how do I reach them" without a drag.
 */
export function DriverStrip({
  colors,
  name,
  photo,
  plate,
  car,
  emphasisePlate = true,
  unread = 0,
  onCall,
  onChat,
}: {
  colors: Colors;
  name: string;
  photo: string | null;
  plate: string | null;
  car: string | null;
  /** At the kerb the plate leads; in the car it is settled and recedes. */
  emphasisePlate?: boolean;
  unread?: number;
  onCall?: () => void;
  onChat?: () => void;
}) {
  const s = makeStyles(colors);
  return (
    <View style={s.row}>
      <Avatar uri={photo ?? undefined} name={name} size={56} />
      <View style={{ flex: 1, gap: 3 }}>
        {emphasisePlate && plate ? (
          <View style={s.plate}>
            <Text style={s.plateText} numberOfLines={1}>{plate}</Text>
          </View>
        ) : null}
        <Text style={s.name} numberOfLines={1}>
          {name}
          {!emphasisePlate && plate ? <Text style={s.sub}>{`  ·  ${plate}`}</Text> : null}
        </Text>
        {car ? <Text style={s.sub} numberOfLines={1}>{car}</Text> : null}
      </View>
      {onChat ? (
        <Pressable onPress={onChat} hitSlop={6} style={s.btn} accessibilityRole="button" accessibilityLabel={unread > 0 ? `Message driver, ${unread} unread` : 'Message driver'}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.onSurface} />
          {unread > 0 ? (
            <View style={[s.badge, { backgroundColor: colors.primary }]}>
              <Text style={[s.badgeText, { color: colors.onPrimary }]}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      {onCall ? (
        <Pressable onPress={onCall} hitSlop={6} style={s.btn} accessibilityRole="button" accessibilityLabel="Call driver">
          <Ionicons name="call-outline" size={18} color={colors.onSurface} />
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Uber's driver block: a big face, the PLATE as the loudest line, then name
    // and car at reading size — room around it, not a squeezed caption stack.
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, paddingVertical: spacing.sm },
    plate: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceContainerHigh,
    },
    plateText: {
      fontFamily: fonts.displayBold,
      fontSize: fontSizes.titleLarge,
      lineHeight: Math.round(fontSizes.titleLarge * 1.2),
      letterSpacing: 1.2,
      color: colors.onSurface,
    },
    name: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyLarge, lineHeight: 22, color: colors.onSurface },
    sub: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, lineHeight: 18, color: colors.onSurfaceVariant },
    btn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainerHigh,
    },
    badge: {
      position: 'absolute', top: -2, right: -2,
      minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
      alignItems: 'center', justifyContent: 'center',
    },
    badgeText: { fontFamily: fonts.semiBold, fontSize: 9 },
  });
