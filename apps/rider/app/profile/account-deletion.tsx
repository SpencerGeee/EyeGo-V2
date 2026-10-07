import React from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { Button, Screen, ListSection, ListRow, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useAuthStore } from '../../stores/auth.store';

// Each line is what the server actually does (users.service.deactivateAccount).
const CONSEQUENCES: { icon: 'car-outline' | 'wallet-outline' | 'person-remove-outline' | 'lock-closed-outline'; title: string; detail: string }[] = [
  { icon: 'car-outline', title: 'Rides first', detail: 'Finish or cancel any ride you’ve booked or are on.' },
  { icon: 'wallet-outline', title: 'Use your balance first', detail: 'Wallet money can’t be used after deletion — spend it or send it to someone.' },
  { icon: 'person-remove-outline', title: 'Your details go', detail: 'Your name, phone, email and photo are removed and you’re signed out everywhere.' },
  { icon: 'lock-closed-outline', title: 'It can’t be undone', detail: 'To ride again you’ll need a new account.' },
];

/**
 * DELETE ACCOUNT — the one delete flow (Privacy no longer has its own). One
 * page, one confirm, like Uber; the old "type DELETE" step asked twice.
 */
export default function AccountDeletionScreen() {
  const colors = useColors();
  const router = useRouter();
  const { logout } = useAuthStore();

  const { mutate: deleteAccount, isPending } = useMutation({
    mutationFn: (acknowledgeBalance: boolean) => userApi.deleteAccount({ acknowledgeBalance }),
    onSuccess: async () => {
      await logout();
      router.replace('/(auth)/phone');
    },
    onError: (err: any) => {
      // A wallet balance is a question, not a wall: the server says how much,
      // the rider decides.
      if (err?.response?.data?.code === 'WALLET_NOT_EMPTY') {
        Alert.alert('Money left in your wallet', err.response.data.message, [
          { text: 'Keep my account', style: 'cancel' },
          { text: 'Delete anyway', style: 'destructive', onPress: () => deleteAccount(true) },
        ]);
        return;
      }
      const { title, message } = describeError(err, 'Something went wrong. Please try again.');
      notify(title, message);
    },
  });

  const confirm = () =>
    Alert.alert('Delete your account?', 'This is permanent. You’ll be signed out straight away.', [
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
