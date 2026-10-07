import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { fonts } from '@eyego/config';
import { Text, Screen } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';

const TERMS_SECTIONS: { heading: string; body: string }[] = [
  {
    heading: '1. Acceptance of terms',
    body: 'These Terms of Service ("Terms") govern your use of the EyeGo apps and services operated in Ghana. By creating an account or booking a ride you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the service.',
  },
  {
    heading: '2. The service',
    body: 'EyeGo is a technology platform that connects riders with independent drivers operating cars and shared vans. EyeGo does not itself provide transport; drivers are independent providers responsible for their vehicles, licensing and insurance as Ghanaian law requires.',
  },
  {
    heading: '3. Your account',
    body: 'You must be at least 16 to use EyeGo (riders aged 16–17 need a parent or guardian’s consent). You are responsible for your account details, for keeping your phone secure, and for all activity under your account. One account per person; accounts are not transferable.',
  },
  {
    heading: '4. Bookings, seats and group rides',
    body: 'A confirmed booking reserves the seat(s) you chose on that trip. On shared trips the fare shown when you confirm is the most you will pay for that seat. A group lead may invite others by link; each member is responsible for their own conduct, and the lead for group settings such as paying for everyone and declaring heavy cargo.',
  },
  {
    heading: '5. Fares and payments',
    body: 'Fares are shown before you confirm. Payments are processed by Paystack (card and mobile money) or taken in cash by the driver. Wallet balances earn no interest and can be used only within EyeGo. Promo codes have no cash value, are single-use unless stated, and may be withdrawn for misuse.',
  },
  {
    heading: '6. Cancellations and refunds',
    body: 'Cancelling before your trip sets off is free. For an on-demand ride, cancelling before a driver is found, or within two minutes of one accepting, is free; after that a late-cancellation fee may apply, and the app shows it before you confirm. If you miss a trip that has already departed, you may be charged up to the full seat fare. Refunds go back to the way you paid or to your EyeGo wallet.',
  },
  {
    heading: '7. Rider conduct',
    body: 'You agree to: treat drivers and other riders with respect; wear a seatbelt where fitted; not carry illegal or dangerous items, and declare heavy cargo; not smoke, vape or drink alcohol in vehicles; and not damage vehicles. Breaches may lead to cleaning or repair charges, suspension or removal from the platform.',
  },
  {
    heading: '8. Safety',
    body: 'Safety features (emergency button, trip sharing, emergency contacts) help but do not replace the emergency services. In an emergency call 112, the Ghana Police Service (191) or Ambulance (193). You agree that EyeGo may share your live trip details with the emergency services and your emergency contacts when you raise an emergency.',
  },
  {
    heading: '9. Scheduled and reserved rides',
    body: 'Scheduled rides depend on driver availability. If we cannot arrange one, we tell you and refund anything you paid in advance.',
  },
  {
    heading: '10. Limitation of liability',
    body: 'To the extent the law allows, EyeGo is not liable for indirect or consequential losses, delays, missed connections, or the acts of drivers or other riders. Nothing in these Terms excludes liability that cannot be excluded under Ghanaian law. Claims about a trip should be raised through Help within 30 days of the trip.',
  },
  {
    heading: '11. Suspension and termination',
    body: 'We may suspend or close accounts for fraud, abuse, chargebacks, safety violations or breach of these Terms. You can delete your account at any time in Settings; outstanding fares and open disputes survive it.',
  },
  {
    heading: '12. Changes to these terms',
    body: 'We may update these Terms as the service evolves. Material changes are announced in the app at least 7 days before they take effect. Using EyeGo after that date means you accept them.',
  },
  {
    heading: '13. Governing law and contact',
    body: 'These Terms are governed by the laws of the Republic of Ghana, and disputes are subject to the jurisdiction of Ghanaian courts. Contact: support@eyego.app · WhatsApp +233 26 149 0759.',
  },
];

/** TERMS OF SERVICE — plain reading page on the kit. */
export default function TermsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Screen title="Terms of service" subtitle="Last updated October 2026">
      {TERMS_SECTIONS.map((s) => (
        <View key={s.heading} style={styles.section}>
          <Text style={styles.heading}>{s.heading}</Text>
          <Text style={styles.body}>{s.body}</Text>
        </View>
      ))}
    </Screen>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { paddingHorizontal: 20, marginTop: 22 },
    heading: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 22, color: c.onSurface, marginBottom: 6 },
    body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: c.onSurfaceVariant },
  });
