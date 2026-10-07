import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { fonts } from '@eyego/config';
import { Text, Screen } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';

const AGREEMENT_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: '1. Acceptance of terms',
    body: 'This Driver Agreement ("Agreement") governs your use of the EyeGo driver application and platform operated in Ghana. By creating a driver account, completing onboarding, or accepting a single trip, you agree to be bound by this Agreement and by EyeGo\'s Privacy Policy. If you do not agree, do not activate your driver account or accept trips.',
  },
  {
    heading: '2. Independent contractor status',
    body: 'You are an independent contractor, not an employee, agent, partner, or joint venturer of EyeGo. You control when, whether, and how much you drive, and you may use other platforms concurrently. EyeGo does not withhold income tax, social security (SSNIT), or any statutory deductions on your behalf — you are solely responsible for your own tax obligations under Ghanaian law. Nothing in this Agreement creates an employment relationship.',
  },
  {
    heading: '3. Eligibility and documents',
    body: 'To activate and keep your account active you must: hold a valid Ghanaian driver\'s licence appropriate to your vehicle class; provide a valid Ghana Card; maintain current vehicle registration in your name or with written owner authorisation; and maintain valid motor insurance covering commercial passenger transport. Documents must be kept current — an expired licence stops you going online until a valid replacement is verified. EyeGo may require a police report or background check and periodic re-verification.',
  },
  {
    heading: '4. Vehicle requirements',
    body: 'Your vehicle must carry a valid roadworthy certificate and meet the seating and safety standards of the class it is registered under (Eco, Comfort or Premium). Vehicles must be kept clean, mechanically sound, and free of modifications that reduce passenger safety. EyeGo may suspend a vehicle from the platform pending inspection if a safety concern is reported.',
  },
  {
    heading: '5. Fares, commission and payouts',
    body: 'Fares are calculated by EyeGo\'s pricing engine and are not negotiable outside the app. EyeGo keeps a service commission on each fare, at the rate shown in the app and in each trip\'s breakdown. For fares paid in the app, your share is credited to your EyeGo balance when the trip is completed. For cash fares, you keep the cash and the commission is deducted from your EyeGo balance. Balances are held in Ghana Cedis, earn no interest, and can be cashed out to the mobile money or bank account you register, subject to the minimum shown in the app. Cash outs are usually processed the same day but may take longer during payment-provider outages.',
  },
  {
    heading: '6. Cancellations and no-shows',
    body: 'You may decline an offer or cancel a trip before departure, but frequent cancellations lower your cancellation rate and may affect your tier or trigger a review. If a passenger does not board within the no-show window after you arrive at pickup, use the in-app no-show flow — do not depart with an unboarded reserved seat still marked as occupied.',
  },
  {
    heading: '7. Safety and conduct',
    body: 'You agree to: drive lawfully, sober and with care at all times while online; treat every passenger with courtesy regardless of gender, religion, ethnicity or disability; not discriminate in accepting or carrying passengers; help passengers with reasonable mobility or safety needs where practical; and cooperate with EyeGo\'s safety features, including sharing live trip location when an emergency is raised.',
  },
  {
    heading: '8. Prohibited conduct',
    body: 'The following lead to immediate suspension pending investigation and may lead to permanent removal: driving under the influence of alcohol or drugs; abuse, harassment or discrimination against a passenger; fraudulent trips, fake GPS, fare manipulation or falsified documents; soliciting off-platform payment to avoid commission; carrying weapons or illegal goods; and any conduct that endangers passenger safety.',
  },
  {
    heading: '9. Suspension and termination',
    body: 'EyeGo may suspend or deactivate your account for: expired or rejected documents; ratings or cancellation rates persistently outside platform standards; confirmed safety complaints; fraud; or breach of this Agreement. Where safety is not at immediate risk, EyeGo will make reasonable efforts to tell you why and let you respond first. You may delete your account at any time from Settings. Cash out your balance first — a deleted account cannot be signed into again. Pending disputes survive termination.',
  },
  {
    heading: '10. Disputes',
    body: 'Fare, rating or conduct disputes should first be raised through in-app Help within 30 days of the trip. EyeGo will investigate using trip records (GPS, timestamps, in-app messages) and issue a decision. If a dispute cannot be resolved through Help, either party may pursue mediation before litigation, without prejudice to statutory rights under Ghanaian law.',
  },
  {
    heading: '11. Liability, insurance and indemnity',
    body: 'You are responsible for insurance adequate to cover passengers, third parties and your vehicle while driving, as Ghanaian motor-insurance law requires. To the extent the law allows, EyeGo is not liable for injury, damage, fines or losses arising from your operation of your vehicle, and you agree to indemnify EyeGo against claims arising from your acts or omissions as a driver. Nothing here excludes liability that cannot be excluded under Ghanaian law.',
  },
  {
    heading: '12. Changes to this agreement',
    body: 'EyeGo may update this Agreement, including commission rates and payout mechanics. Material changes — including a change to the commission rate — will be announced in the app at least 7 days before they take effect. Accepting trips after that date means you accept the updated Agreement.',
  },
  {
    heading: '13. Governing law and contact',
    body: 'This Agreement is governed by the laws of the Republic of Ghana, and disputes are subject to the jurisdiction of Ghanaian courts. Contact: support@eyego.app · WhatsApp +233 26 149 0759.',
  },
];

/** DRIVER AGREEMENT — plain reading page on the kit. */
export default function TermsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Screen title="Driver agreement" subtitle="Last updated October 2026">
      {AGREEMENT_SECTIONS.map((s) => (
        <View key={s.heading} style={styles.section}>
          <Text style={styles.heading}>{s.heading}</Text>
          <Text style={styles.body}>{s.body}</Text>
        </View>
      ))}
    </Screen>
  );
}

const makeStyles = (c: DriverColors) =>
  StyleSheet.create({
    section: { paddingHorizontal: 20, marginTop: 22 },
    heading: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 22, color: c.onSurface, marginBottom: 6 },
    body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: c.onSurfaceVariant },
  });
