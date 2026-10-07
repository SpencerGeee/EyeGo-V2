import React, { useState, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { fonts } from '@eyego/config';
import { Text, Screen, ScreenHeader, Loader } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { usePlatformConfig } from '../../hooks/usePlatformConfig';

const NOTICE: { heading: string; body: string }[] = [
  {
    heading: 'What we collect',
    body: 'Your name, phone number and photo; your driver’s licence and Ghana Card images; your vehicle details; your location while you are online or on a trip; your trips, ratings and earnings; and the payout account you give us.',
  },
  {
    heading: 'Why',
    body: 'To verify you can drive legally, match you with riders, show riders who is coming, pay you, keep trips safe, and meet our legal obligations.',
  },
  {
    heading: 'Who sees it',
    body: 'Riders on your trip see your name, photo, rating, vehicle, plate and live location until the trip ends. Payments are processed by Paystack. We share data with authorities only when the law requires it or someone’s safety is at risk. We never sell your data.',
  },
  {
    heading: 'How long we keep it',
    body: 'For as long as your account is open, then only what the law requires us to keep (for example, payment and tax records). Deleting your account removes your name, phone and photo from EyeGo.',
  },
  {
    heading: 'Your rights',
    body: 'Under Ghana’s Data Protection Act, 2012 (Act 843) you can ask to see, correct or delete your data. Delete your account from Settings, or write to support@eyego.app for anything else.',
  },
];

/**
 * PRIVACY — the operator's published policy when one is configured
 * (PRIVACY_URL in the console), otherwise a plain-language notice in the app.
 * It used to load a hard-coded eyego.app URL, which showed an error page
 * whenever that site was not up.
 */
export default function PrivacyScreen() {
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
          style={styles.web}
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
    <Screen title="Privacy" subtitle="How EyeGo uses your information as a driver.">
      {NOTICE.map((s) => (
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
    root: { flex: 1, backgroundColor: c.background },
    web: { flex: 1, backgroundColor: c.background },
    loading: { ...StyleSheet.absoluteFillObject, top: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
    section: { paddingHorizontal: 20, marginTop: 22 },
    heading: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 22, color: c.onSurface, marginBottom: 6 },
    body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: c.onSurfaceVariant },
  });
