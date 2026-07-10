import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { fonts, spacing, radii } from '@eyego/config';
import { Text, AppBackground, backgroundScrollPauseProps } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const AGREEMENT_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: '1. Acceptance of Terms',
    body: 'This Driver Agreement ("Agreement") governs your use of the EyeGo driver application and platform operated in Ghana. By creating a driver account, completing onboarding, or accepting a single trip, you agree to be bound by this Agreement and by EyeGo\'s Privacy Policy. If you do not agree, do not activate your driver account or accept trips.',
  },
  {
    heading: '2. Independent Contractor Status',
    body: 'You are an independent contractor, not an employee, agent, partner, or joint venturer of EyeGo. You control when, whether, and how much you drive, and you may use other platforms concurrently. EyeGo does not withhold income tax, social security (SSNIT), or any statutory deductions on your behalf — you are solely responsible for your own tax obligations under Ghanaian law. Nothing in this Agreement creates an employment relationship.',
  },
  {
    heading: '3. Driver Eligibility & Document Requirements',
    body: 'To activate and keep your account active you must: hold a valid Ghanaian driver\'s license appropriate to your vehicle class; provide a valid Ghana Card (national ID); maintain current vehicle registration in your name or with written owner authorization; and maintain a valid, unexpired third-party (at minimum) motor insurance policy covering commercial passenger transport. All documents must be uploaded, kept current, and re-verified before expiry — an expired document automatically suspends your ability to accept trips until a valid replacement is verified. EyeGo may require a police report / background check and periodic re-verification at its discretion.',
  },
  {
    heading: '4. Vehicle Requirements',
    body: 'Your vehicle must pass EyeGo\'s roadworthiness check, carry a valid roadworthy certificate, and meet the seating and safety standards for the tier (Economy/Comfort) you register under. Vehicles must be kept clean, mechanically sound, and free of modifications that reduce passenger safety. EyeGo may suspend a vehicle from the platform pending inspection if a safety concern is reported.',
  },
  {
    heading: '5. Fares, Commission & Payouts',
    body: 'Passenger fares are calculated by EyeGo\'s pricing engine (distance, tier, surge, and surcharge components) and are not individually negotiable outside the app. EyeGo retains a service commission — currently 15% of the passenger fare — as shown in the trip breakdown after each completed trip; your net earnings (currently 70% or more of the full fare, depending on trip composition) are credited automatically to your in-app EyeGo wallet once a trip is marked complete. Wallet balances are held in Ghana Cedis (GHS), are non-interest-bearing, and can be withdrawn to your registered mobile money account from the Earnings tab, subject to the minimum withdrawal threshold displayed in the app at the time of your request. Withdrawal requests are typically processed same-day but may take longer during payment provider outages. EyeGo may adjust the commission structure prospectively with notice as described in Section 12.',
  },
  {
    heading: '6. Cancellations & No-Shows',
    body: 'You may decline or cancel a dispatched trip before departure, but a pattern of excessive cancellations or declines lowers your acceptance rate and may affect your driver level or trigger a review. If a passenger fails to board within the app\'s no-show window after you have arrived at the pickup point, follow the in-app no-show flow to report it — do not depart with an unboarded reserved seat still marked as occupied.',
  },
  {
    heading: '7. Passenger Safety & Conduct Standards',
    body: 'You agree to: hold a seatbelt-compliant, roadworthy vehicle; drive in a lawful, sober, and non-reckless manner at all times while online; treat all passengers with courtesy and respect regardless of gender, religion, ethnicity, or disability; not discriminate in accepting or carrying passengers; assist passengers with reasonable mobility or safety needs where practical; and cooperate with EyeGo\'s SOS and safety-check features, including sharing live trip location when a passenger or EyeGo triggers an emergency flow.',
  },
  {
    heading: '8. Prohibited Conduct',
    body: 'The following will result in immediate suspension pending investigation, and may result in permanent removal from the platform: driving under the influence of alcohol or drugs; physical or verbal abuse, harassment, or discrimination against a passenger; fraudulent trips, fake GPS, fare manipulation, or falsified documents; soliciting off-platform payment to avoid commission; carrying unauthorized weapons or illegal goods; and any conduct that endangers passenger safety.',
  },
  {
    heading: '9. Account Suspension & Termination',
    body: 'EyeGo may suspend or deactivate your account, with or without notice, for: expired or rejected documents; a rating or acceptance rate that falls persistently below platform thresholds; confirmed passenger safety complaints; fraud or chargebacks; or breach of this Agreement. Where safety is not at immediate risk, EyeGo will make reasonable efforts to notify you of the reason and provide an opportunity to respond before permanent termination. You may deactivate your own account at any time from Settings; earned but unwithdrawn wallet balances remain payable subject to standard verification, and any pending disputes survive termination.',
  },
  {
    heading: '10. Dispute Resolution',
    body: 'Fare, rating, or conduct disputes should first be raised through in-app Support within 30 days of the trip in question. EyeGo will investigate using trip telemetry (GPS, timestamps, in-app messages) and issue a decision. If a dispute cannot be resolved through Support, either party may pursue mediation before resorting to litigation, without prejudice to either party\'s statutory rights under Ghanaian law.',
  },
  {
    heading: '11. Liability, Insurance & Indemnification',
    body: 'You are responsible for maintaining insurance adequate to cover passengers, third parties, and your vehicle while operating as a driver, as required by the Insurance Act and related Ghanaian motor insurance regulations. To the maximum extent permitted by law, EyeGo is not liable for personal injury, property damage, fines, or losses arising from your operation of your vehicle, and you agree to indemnify EyeGo against claims arising from your acts or omissions as a driver. Nothing in this Agreement excludes liability that cannot be excluded under Ghanaian law.',
  },
  {
    heading: '12. Changes to This Agreement',
    body: 'EyeGo may update this Agreement, including commission rates and payout mechanics, as the service evolves. Material changes — including changes to the commission percentage — will be announced in the app at least 7 days before they take effect. Continuing to accept trips after the effective date constitutes acceptance of the updated Agreement.',
  },
  {
    heading: '13. Governing Law & Contact',
    body: 'This Agreement is governed by the laws of the Republic of Ghana, and disputes are subject to the jurisdiction of Ghanaian courts. Contact: support@eyego.app · WhatsApp +233 26 149 0759.\n\nLast updated: July 2026',
  },
];

export default function TermsScreen() {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground isDark={theme !== 'light'} />
      <MotiView
        from={{ opacity: 0, translateY: -4 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.header}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle} color={colors.onSurface}>
          Driver Agreement
        </Text>
        <View style={styles.backBtn} pointerEvents="none" />
      </MotiView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} {...backgroundScrollPauseProps}>
        <View style={styles.card}>
          {AGREEMENT_SECTIONS.map((section, i) => (
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

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backBtn: { width: 70 },
  headerTitle: { flex: 1, textAlign: 'center' },
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
