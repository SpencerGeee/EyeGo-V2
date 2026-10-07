import React from 'react';
import { Alert, Pressable, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { walletApi } from '@eyego/api';
import { formatGhs } from '@eyego/utils';
import { Screen, ListSection, ListRow, SkeletonRows, goDeeper, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useWalletBalance } from '../../hooks/useWalletBalance';

/**
 * PAYMENT METHODS (rival spec §8) — everything you can pay with, in one list:
 * EyeGo wallet, cash, mobile money (chosen at checkout) and saved cards.
 */
export default function PaymentMethodsScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const balance = useWalletBalance();

  // `isPending`: a retry after a failure is not "loading" to v5.
  const cardsQ = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => walletApi.getPaymentMethods(),
  });
  const cards = cardsQ.data ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => walletApi.deletePaymentMethod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-methods'] }),
    onError: () => notify(null, 'Couldn’t remove that card. Please try again.'),
  });

  const confirmRemove = (id: string, label: string) =>
    Alert.alert(`Remove ${label}?`, 'You can add it again any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(id) },
    ]);

  return (
    <Screen
      title="Payment methods"
      refreshControl={<RefreshControl refreshing={cardsQ.isRefetching} onRefresh={() => cardsQ.refetch()} tintColor={colors.primary} />}
    >
      <ListSection title="Always available">
        <ListRow
          icon="wallet-outline"
          title="EyeGo wallet"
          value={balance.data != null ? formatGhs(balance.data) : undefined}
          onPress={() => goDeeper('/profile/wallet')}
        />
        <ListRow icon="phone-portrait-outline" title="Mobile money" subtitle="MTN, Telecel or AirtelTigo — approve on your phone at checkout" subtitleLines={2} />
        <ListRow icon="cash-outline" title="Cash" subtitle="Pay your driver at the end of the trip" />
      </ListSection>

      {cardsQ.isPending ? (
        <SkeletonRows count={2} />
      ) : cardsQ.isError && cards.length === 0 ? (
        // A failed read is not "you have no cards".
        <ListSection title="Cards">
          <ListRow icon="refresh" title="Couldn’t load your cards" subtitle="Tap to try again" onPress={() => void cardsQ.refetch()} />
        </ListSection>
      ) : (
        <ListSection title="Cards" footer="Cards are stored by Paystack (PCI-DSS). EyeGo never sees your full card number.">
          {cards.map((card: any) => {
            const label = `${card.brand ? String(card.brand).replace(/^\w/, (s: string) => s.toUpperCase()) : 'Card'} •••• ${card.last4}`;
            return (
              <ListRow
                key={card.id}
                icon="card-outline"
                title={label}
                subtitle={card.expMonth && card.expYear ? `Expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}` : undefined}
                right={
                  <Pressable onPress={() => confirmRemove(card.id, label)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                }
              />
            );
          })}
          <ListRow icon="add-circle-outline" iconColor={colors.primary} title="Add a card" onPress={() => goDeeper('/payment/add-card')} />
        </ListSection>
      )}
    </Screen>
  );
}
