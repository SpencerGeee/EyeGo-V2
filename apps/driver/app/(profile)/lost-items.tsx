import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '@eyego/api';
import { dayMonthTime } from '@eyego/utils';
import { fonts, fontSizes, radii, spacing } from '@eyego/config';
import { Text, Button, Screen, ListSection, SkeletonRows, goDeeper, notify } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';

type Item = {
  ticketId: string;
  tripId: string | null;
  status: string;
  reportedAt: string;
  riderName: string;
  description: string;
  myAnswer: string | null;
};

/**
 * LOST ITEMS — "a rider left something in your car".
 *
 * A rider reports it from their finished trip (bookings.reportLostItem); it lands
 * here and in the away sheet. The driver checks the car and answers Found / Not
 * in my car — the rider is pushed and sees it on their support thread — and can
 * message them on the trip chat to arrange the return.
 */
export default function LostItemsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['driver', 'lost-items'],
    queryFn: () => driverApi.getLostItems(),
    select: (r) => ((r.data as any)?.data?.items ?? []) as Item[],
  });

  const answer = async (item: Item, found: boolean) => {
    setBusy(item.ticketId);
    try {
      await driverApi.answerLostItem(item.ticketId, { found, note: notes[item.ticketId]?.trim() || undefined });
      notify(found ? 'Rider told you found it' : 'Rider told', 'They’ll get a notification right away.', { tone: 'success' });
      qc.invalidateQueries({ queryKey: ['driver', 'lost-items'] });
    } catch (err: any) {
      notify('Could not send your answer', err?.response?.data?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const items = q.data ?? [];
  return (
    <Screen title="Lost items" keyboard>
      {q.isLoading ? (
        <SkeletonRows count={2} />
      ) : items.length === 0 ? (
        <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ padding: spacing.lg }}>
          Nothing reported. If a rider leaves something in your car, it shows up here.
        </Text>
      ) : (
        items.map((item) => (
          <ListSection key={item.ticketId} title={`${item.riderName} · ${dayMonthTime(item.reportedAt)}`}>
            <View style={styles.card}>
              <Text style={styles.description}>“{item.description}”</Text>
              {item.myAnswer ? (
                <Text variant="bodySmall" color={colors.primary}>You answered: {item.myAnswer}</Text>
              ) : (
                <>
                  <TextInput
                    value={notes[item.ticketId] ?? ''}
                    onChangeText={(t) => setNotes((n) => ({ ...n, [item.ticketId]: t.slice(0, 300) }))}
                    placeholder="Optional note — e.g. where and when they can collect it"
                    placeholderTextColor={colors.onSurfaceVariant}
                    multiline
                    maxFontSizeMultiplier={1.4}
                    style={styles.input}
                    accessibilityLabel="Note for the rider"
                  />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Button label="I found it" onPress={() => void answer(item, true)} loading={busy === item.ticketId} disabled={!!busy} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Not in my car" variant="secondary" onPress={() => void answer(item, false)} disabled={!!busy} />
                    </View>
                  </View>
                </>
              )}
              {item.tripId ? (
                <Button
                  label="Message the rider"
                  variant="ghost"
                  onPress={() => goDeeper({ pathname: '/(trip)/chat/[id]', params: { id: item.tripId } } as never)}
                />
              ) : null}
            </View>
          </ListSection>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors: DriverColors) =>
  StyleSheet.create({
    card: { gap: spacing.md, padding: spacing.base },
    description: { fontFamily: fonts.medium, fontSize: fontSizes.bodyLarge, color: colors.onSurface },
    input: {
      minHeight: 48,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
      padding: spacing.md,
      fontFamily: fonts.regular,
      fontSize: fontSizes.bodyMedium,
      color: colors.onSurface,
    },
    row: { flexDirection: 'row', gap: spacing.sm },
  });
