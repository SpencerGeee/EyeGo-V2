import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Switch } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import { describeError } from '@eyego/utils';
import { Button, Input, Screen, ListSection, ListRow, notify } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useAuthStore } from '../../stores/auth.store';

/**
 * BUSINESS PROFILE — company details printed on the receipts you share.
 *
 * The page promised that "all ride receipts will be automatically forwarded
 * to your expense email". Nothing sends email — the server has no mail
 * service — so the promise is gone. What it does now is real: with business
 * on, every shared receipt carries "Billed to" and the tax ID, and the expense
 * email is kept for when receipt email lands.
 */
export default function BusinessProfileScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const updateUser = useAuthStore((s) => s.updateUser);

  const [on, setOn] = useState(false);
  const [company, setCompany] = useState('');
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['user', 'profile'],
    queryFn: () => userApi.getProfile(),
    select: (r) => r.data.data,
  });

  // Prefill once; background refetches must not clobber edits.
  useEffect(() => {
    if (!profile || hydrated) return;
    setOn(!!profile.businessMode);
    setCompany(profile.businessCompanyName ?? '');
    setTaxId(profile.businessTaxId ?? '');
    setEmail(profile.businessExpenseEmail ?? '');
    setHydrated(true);
  }, [profile, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      userApi.updateProfile({
        businessMode: on,
        businessCompanyName: on ? company.trim() : null,
        businessTaxId: on ? taxId.trim() || null : null,
        businessExpenseEmail: on ? email.trim() || null : null,
      }),
    onSuccess: (res) => {
      // The receipt reads the signed-in user, so the store needs the new values.
      const u = (res as any)?.data?.data;
      if (u) updateUser(u);
      qc.invalidateQueries({ queryKey: ['user', 'profile'] });
      notify('Business profile saved', undefined, { tone: 'success' });
    },
    onError: (err) => {
      const { title, message } = describeError(err, 'Please try again.');
      notify(title, message);
    },
  });

  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = !on || (company.trim().length >= 2 && emailOk);

  return (
    <Screen
      title="Business profile"
      subtitle="For rides you claim back from work."
      keyboard
      footer={<Button label="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!valid || save.isPending || !hydrated} />}
    >
      <ListSection footer="When on, receipts you share from a finished trip show your company and tax ID.">
        <ListRow
          icon="briefcase-outline"
          title="Business rides"
          right={
            <Switch
              value={on}
              onValueChange={setOn}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor="#fff"
              ios_backgroundColor={colors.surfaceContainerHighest}
              accessibilityLabel="Business rides"
            />
          }
        />
      </ListSection>

      {on ? (
        <View style={styles.form}>
          <Input label="Company name" value={company} onChangeText={setCompany} placeholder="Acme Ltd" autoCapitalize="words" />
          <Input label="Tax ID (optional)" value={taxId} onChangeText={setTaxId} placeholder="C0001234567" autoCapitalize="characters" />
          <Input
            label="Expense email (optional)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="receipts@acme.com"
            error={emailOk ? undefined : 'That email doesn’t look right'}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 20, marginTop: 24, gap: 16 },
});
