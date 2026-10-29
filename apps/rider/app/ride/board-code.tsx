import React, { useState } from 'react';
import { View, StyleSheet, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { bookingsApi } from '@eyego/api';
import { fonts, spacing } from '@eyego/config';
import { Text, Button, Pressable, goBack, goDeeper, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';

/**
 * ── BOARD WITH THE BUS'S CODE (walk-up boarding, Q10) ───────────────────────
 *
 * The trotro mate, in the app: a rider standing at a stop sees an EyeGo bus pull
 * in, types the 4-character code on its sticker, and buys a seat for their
 * stretch from where the bus is now. Prepaid, same seat pool as everyone else.
 * After the lookup it is the ordinary booking path (detail → drop-off → pay),
 * carrying the code so the server books it as a walk-up.
 */
export default function BoardWithCodeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  const find = async () => {
    if (clean.length < 4 || busy) return;
    setBusy(true);
    try {
      const res = await bookingsApi.resolveWalkUp(clean);
      const bus = res.data?.data;
      if (!bus?.tripId) throw new Error('not found');
      const q = [bus.pickupStopId ? `pickupStopId=${bus.pickupStopId}` : '', `walkUpCode=${clean}`].filter(Boolean).join('&');
      goDeeper(`/ride/${bus.tripId}?${q}` as any);
    } catch (err: any) {
      notify('Bus not found', err?.response?.data?.message ?? 'Check the code on the bus sticker and try again.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + spacing.md }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable onPress={() => goBack()} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
        <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
      </Pressable>
      <View style={styles.body}>
        <Ionicons name="bus-outline" size={40} color={colors.primary} />
        <Text style={[styles.title, { color: colors.onSurface }]}>Board this bus</Text>
        <Text style={[styles.sub, { color: colors.onSurfaceVariant }]}>
          Type the 4-character code on the bus sticker. You pay in the app for your stretch only.
        </Text>
        <TextInput
          testID="board-code-input"
          value={clean}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          placeholder="AB3K"
          placeholderTextColor={colors.onSurfaceVariant}
          onSubmitEditing={find}
          style={[styles.input, { color: colors.onSurface, borderColor: clean.length === 4 ? colors.primary : colors.rimLight, backgroundColor: colors.surfaceCard }]}
          accessibilityLabel="Bus boarding code"
        />
      </View>
      <View style={{ paddingBottom: insets.bottom + spacing.lg }}>
        <Button label="Find my bus" onPress={() => { void find(); }} loading={busy} disabled={clean.length < 4} fullWidth />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg },
  back: { width: 44, height: 44, justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { fontFamily: fonts.semiBold, fontSize: 24 },
  sub: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  input: {
    marginTop: spacing.md,
    width: 200,
    height: 64,
    borderRadius: 16,
    borderWidth: 2,
    textAlign: 'center',
    fontFamily: fonts.semiBold,
    fontSize: 30,
    letterSpacing: 10,
  },
});
