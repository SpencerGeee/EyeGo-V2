import React from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';

import { Text } from '../Text';
import { Button } from '../Button';

/**
 * CONSENT, WITH A RECORD BEHIND IT.
 *
 * Both stores require a reachable privacy policy link. A dispute, a chargeback
 * or the Data Protection Commission requires something rather different: proof
 * of WHICH version this person agreed to and WHEN. A checkbox at signup that
 * leaves no row behind satisfies the first and is worthless for the second.
 *
 * So this is shown whenever the versions stamped on the user differ from the
 * ones the operator currently publishes — including when they are null, which
 * is every account created before consent was recorded at all. Accepting posts
 * to the server, which stamps its own idea of "current"; this screen never
 * tells the server what it displayed, because a client that could would also
 * be a client that could lie about it.
 *
 * It is deliberately NOT dismissible and has no "skip". It is also deliberately
 * not shown to app-review accounts — a reviewer hitting a consent wall before
 * they can test the app is a rejection, and they are not a data subject whose
 * consent means anything.
 */
export interface ConsentGateProps {
  /** True when the signed-in user's accepted versions are behind the current ones. */
  required: boolean;
  termsUrl?: string | null;
  privacyUrl?: string | null;
  submitting?: boolean;
  onAccept: () => void;
  backgroundColor?: string;
  /** The link colour — passed in so this stays theme-agnostic. */
  accentColor?: string;
}

export function ConsentGate({
  required,
  termsUrl,
  privacyUrl,
  submitting = false,
  onAccept,
  backgroundColor = '#0B0B0F',
  accentColor = '#4be277',
}: ConsentGateProps) {
  if (!required) return null;

  const open = (url?: string | null) => {
    if (!url) return;
    // A policy link that will not open leaves the screen up, which is right —
    // there is nothing else to do here and nowhere else to go.
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={[styles.root, { backgroundColor }]} accessibilityViewIsModal>
      <View style={styles.card}>
        <Text variant="titleLarge" style={styles.title}>
          Before you continue
        </Text>

        <Text style={styles.body}>
          We have updated our terms and privacy policy. Please read them and
          confirm you agree to keep using EyeGo.
        </Text>

        <View style={styles.links}>
          <Pressable
            onPress={() => open(termsUrl)}
            disabled={!termsUrl}
            accessibilityRole="link"
            accessibilityLabel="Read the terms of service"
            hitSlop={8}
          >
            <Text style={[styles.link, { color: accentColor, opacity: termsUrl ? 1 : 0.4 }]}>
              Terms of service
            </Text>
          </Pressable>

          <Pressable
            onPress={() => open(privacyUrl)}
            disabled={!privacyUrl}
            accessibilityRole="link"
            accessibilityLabel="Read the privacy policy"
            hitSlop={8}
          >
            <Text style={[styles.link, { color: accentColor, opacity: privacyUrl ? 1 : 0.4 }]}>
              Privacy policy
            </Text>
          </Pressable>
        </View>

        <Button
          label="I agree"
          fullWidth
          loading={submitting}
          disabled={submitting}
          onPress={onAccept}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    // Below the release gate (9999): an unsupported build must not be asked to
    // consent to anything, it must be told to update.
    zIndex: 9000,
    elevation: 9000,
  },
  card: { width: '100%', maxWidth: 420 },
  title: { textAlign: 'center', marginBottom: 12 },
  body: { textAlign: 'center', opacity: 0.75, marginBottom: 20 },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  link: { textDecorationLine: 'underline' },
  action: { alignSelf: 'stretch' },
});
