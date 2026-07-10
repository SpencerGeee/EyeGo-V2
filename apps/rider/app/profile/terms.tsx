import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii } from '@eyego/config';
import { Text, AppBackground, backgroundScrollPauseProps } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';

const TERMS_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: '1. Acceptance of Terms',
    body: 'These Terms of Service ("Terms") govern your use of the EyeGo mobile applications and services operated in Ghana. By creating an account or booking a ride you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the service.',
  },
  {
    heading: '2. The Service',
    body: 'EyeGo is a technology platform that connects riders with independent drivers operating shared vans and vehicles on fixed and dynamic routes. EyeGo itself does not provide transportation; drivers are independent providers responsible for their vehicles, licensing, and insurance as required by Ghanaian law.',
  },
  {
    heading: '3. Your Account',
    body: 'You must be at least 16 years old to use EyeGo (riders aged 16–17 require parental consent). You are responsible for the accuracy of your account details, for keeping your phone and login secure, and for all activity under your account. One account per person; accounts are not transferable.',
  },
  {
    heading: '4. Bookings, Seats & Group Rides',
    body: 'A confirmed booking reserves the selected seat(s) on the selected trip. Shared-ride fares may decrease as more passengers join a trip; the fare shown at checkout is the maximum you will pay for that seat. Group leads may invite others via link; each member is responsible for their own conduct, and the lead is responsible for group settings such as "pay for everyone" and heavy-cargo surcharges.',
  },
  {
    heading: '5. Fares & Payments',
    body: 'Fares are shown before you confirm and may include distance, tier, surge, and surcharge components. Payments are processed by Paystack (card and mobile money). Wallet balances are non-interest-bearing and redeemable only within EyeGo. Promo codes are single-use unless stated otherwise, have no cash value, and may be withdrawn for misuse.',
  },
  {
    heading: '6. Cancellations & Refunds',
    body: 'Cancellations more than 15 minutes before departure receive a full refund to your original payment method or wallet. Cancellations within 15 minutes of departure may incur a fee. If your driver has not arrived within 10 minutes of the scheduled time, you may cancel free of charge. No-shows are charged the full seat fare.',
  },
  {
    heading: '7. Rider Conduct',
    body: 'You agree to: treat drivers and co-riders with respect; wear a seatbelt where fitted; not carry illegal, dangerous, or oversized items without declaring heavy cargo; not smoke, vape, or consume alcohol in vehicles; and not damage vehicles. Violations may result in charges for cleaning or repair, suspension, or permanent removal from the platform.',
  },
  {
    heading: '8. Safety',
    body: 'Safety features (SOS, trip sharing, RideCheck, emergency contacts) are aids, not substitutes for emergency services. In an emergency, contact the Ghana Police Service (191) or Ambulance (193) directly. You consent to EyeGo sharing your live trip data with emergency services and your emergency contacts when you trigger SOS.',
  },
  {
    heading: '9. Scheduled & Reserved Rides',
    body: 'Scheduled rides must be booked at least 30 minutes in advance and are subject to driver availability. EyeGo will notify you if a scheduled trip cannot be fulfilled and will refund any prepaid amount in full.',
  },
  {
    heading: '10. Limitation of Liability',
    body: 'To the maximum extent permitted by law, EyeGo is not liable for indirect or consequential losses, delays, missed connections, or the acts or omissions of drivers or other riders. Nothing in these Terms excludes liability that cannot be excluded under Ghanaian law. Claims relating to a trip must be raised via a support ticket within 30 days of the trip.',
  },
  {
    heading: '11. Suspension & Termination',
    body: 'We may suspend or terminate accounts for fraud, abuse, chargebacks, safety violations, or breach of these Terms. You may delete your account at any time from Privacy & Settings; outstanding fares and disputes survive termination.',
  },
  {
    heading: '12. Changes to These Terms',
    body: 'We may update these Terms as the service evolves. Material changes will be announced in the app at least 7 days before they take effect. Continued use after the effective date constitutes acceptance.',
  },
  {
    heading: '13. Governing Law & Contact',
    body: 'These Terms are governed by the laws of the Republic of Ghana, and disputes are subject to the jurisdiction of Ghanaian courts. Contact: support@eyego.app · WhatsApp +233 26 149 0759.\n\nLast updated: July 2026',
  },
];

export default function TermsScreen() {
  const colors = useColors();
  const isDark = useThemeStore((s) => s.isDark);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" isDark={isDark} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleSmall">Terms of Service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} {...backgroundScrollPauseProps}>
        <View style={styles.card}>
          {TERMS_SECTIONS.map((section, i) => (
            <View key={section.heading} style={i > 0 ? { marginTop: spacing.lg } : undefined}>
              <Text variant="bodyMedium" color={colors.onSurface} style={{ fontFamily: fonts.semiBold, marginBottom: 4 }}>
                {section.heading}
              </Text>
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ lineHeight: 18 }}>
                {section.body}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.base,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: spacing['2xl'],
      paddingTop: spacing['2xl'],
      paddingBottom: spacing['3xl'],
    },
    card: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radii.xl,
      padding: spacing.base,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
    },
  });
