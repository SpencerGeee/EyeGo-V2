import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { fonts } from '@eyego/config';
import { Text, Screen, ScreenHeader, Loader } from '@eyego/ui';
import { useColors, Colors } from '../../utils/useColors';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: 'Who we are',
    body: 'EyeGo operates a ride and shared-van platform in Ghana. This policy explains what personal data we collect, why, how we protect it, and the rights you have over it.',
  },
  {
    heading: 'Legal basis',
    body: 'We process personal data under the Data Protection Act, 2012 (Act 843): to provide the rides you book, with your consent (marketing), for our legitimate interests (fraud prevention, safety, improving the service) and to meet legal obligations.',
  },
  {
    heading: 'What we collect',
    body: 'Account: name, phone number, email and photo. Trips: pickup and drop-off points, routes, times, seats, fares and payments. Device: model, OS, app version, notification token and crash reports. Communications: support requests, in-trip chat and ratings.',
  },
  {
    heading: 'Location',
    body: 'We use your precise location while the app is open to show nearby trips, match you with a driver and track your trip. During a trip your driver sees your pickup point; your emergency contacts see your trip only if you share it or trigger an emergency. You can turn location off in your phone’s settings, but booking needs it.',
  },
  {
    heading: 'Payments',
    body: 'Payments are processed by Paystack, a PCI-DSS certified processor. EyeGo never stores your card number, CVV or mobile money PIN — only references, amounts and status for receipts and refunds.',
  },
  {
    heading: 'Who we share with',
    body: 'We never sell your data. We share only what each party needs: your driver (name, pickup, seats), people in a group booking you join (name and seat status), Paystack (payments), your emergency contacts (when you share a trip or trigger an emergency), crash-reporting (unless you turn it off) and authorities where the law requires it.',
  },
  {
    heading: 'Security',
    body: 'Traffic between the app and our servers is encrypted. Access to production data is restricted and logged. We will tell you and the Data Protection Commission about any breach as Act 843 requires.',
  },
  {
    heading: 'How long we keep it',
    body: 'While your account is open. When you delete it, your name, phone and photo are removed; we keep only records the law requires (such as payment records) for as long as it requires.',
  },
  {
    heading: 'Your rights',
    body: 'You can ask to see, correct or delete your data, object to some processing, and withdraw consent for marketing at any time in Notification preferences. Delete your account in Settings, or write to privacy@eyego.app. We answer verified requests within 30 days.',
  },
  {
    heading: 'Children',
    body: 'EyeGo is not for children under 16.',
  },
  {
    heading: 'Changes and contact',
    body: 'We announce material changes in the app before they take effect. Questions or complaints: privacy@eyego.app, or the Data Protection Commission of Ghana.',
  },
];

/**
 * PRIVACY POLICY — the operator's published page when PRIVACY_URL is set,
 * otherwise this text. Split out of the Privacy settings page, which used to
 * carry the whole policy, three switches and a second delete-account flow.
 */
export default function PrivacyPolicyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { privacyUrl } = usePlatformConfig();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  if (privacyUrl && !failed) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Privacy policy" />
        <WebView
          source={{ uri: privacyUrl }}
          style={styles.root}
          onLoadEnd={() => setLoading(false)}
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
        />
        {loading ? (
          <View style={styles.loading}>
            <Loader size={32} color={colors.primary} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Screen title="Privacy policy" subtitle="Last updated October 2026">
      {SECTIONS.map((s) => (
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
    root: { flex: 1, backgroundColor: c.background },
    loading: { ...StyleSheet.absoluteFillObject, top: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
    section: { paddingHorizontal: 20, marginTop: 22 },
    heading: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 22, color: c.onSurface, marginBottom: 6 },
    body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: c.onSurfaceVariant },
  });
