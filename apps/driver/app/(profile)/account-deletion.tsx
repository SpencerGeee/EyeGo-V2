import React from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { Button, Screen, ListSection, ListRow, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

// Each line is what the server actually does (drivers.service.deleteMe).
const CONSEQUENCES: { icon: 'car-outline' | 'wallet-outline' | 'person-remove-outline' | 'lock-closed-outline'; title: string; detail: string }[] = [
  { icon: 'car-outline', title: 'Trips first', detail: 'Finish or cancel any active or published trip before you delete.' },
  { icon: 'wallet-outline', title: 'Cash out first', detail: 'A balance left behind can’t be cashed out after deletion.' },
  { icon: 'person-remove-outline', title: 'Your details go', detail: 'Your name, phone and photo are removed and you’re signed out everywhere.' },
  { icon: 'lock-closed-outline', title: 'It can’t be undone', detail: 'A deleted account cannot be recovered or signed into again.' },
];

/**
 * DELETE ACCOUNT — one page, one confirm, the Uber way. The old two-step
 * "type DELETE" screen asked for the same decision twice.
 */
export default function AccountDeletionScreen() {
  const colors = useColors();
  const router = useRouter();
  const logout = useDriverStore((s) => s.logout);

  const { mutate: deleteAccount, isPending } = useMutation({
    mutationFn: (acknowledgeBalance: boolean) => apiClient.delete('/driver/me', { data: { acknowledgeBalance } }),
    onSuccess: async () => {
      await logout();
      router.replace('/(auth)/phone');
    },
    onError: (err: any) => {
      // Earnings are a question, not a wall: below the cash-out minimum they
      // can never leave, so the driver decides.
      if (err?.response?.data?.code === 'WALLET_NOT_EMPTY') {
        Alert.alert('Money left in your balance', err.response.data.message, [
          { text: 'Keep my account', style: 'cancel' },
          { text: 'Delete anyway', style: 'destructive', onPress: () => deleteAccount(true) },
        ]);
        return;
      }
      const { title, message } = describeError(err, 'Failed to delete your account. Please try again.');
      notify(title, message);
    },
  });

  const confirm = () =>
    Alert.alert('Delete your account?', 'This is permanent. You’ll be signed out and can’t sign back in to this account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(false) },
    ]);

  return (
    <Screen
      title="Delete account"
      subtitle="Before you go, here’s what happens."
      footer={<Button label="Delete account" variant="destructive" onPress={confirm} loading={isPending} disabled={isPending} />}
    >
      <ListSection>
        {CONSEQUENCES.map((c) => (
          <ListRow key={c.title} icon={c.icon} iconColor={colors.error} title={c.title} subtitle={c.detail} subtitleLines={3} />
        ))}
      </ListSection>
    </Screen>
  );
}
