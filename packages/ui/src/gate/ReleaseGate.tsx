import React from 'react';
import { View, StyleSheet, Linking, ActivityIndicator } from 'react-native';

import { Text } from '../Text';
import { Button } from '../Button';

/**
 * THE ONLY RECALL MECHANISM A SHIPPED APP HAS.
 *
 * A native build that is already on a phone cannot be withdrawn. Pulling the
 * store listing stops new installs and nothing else, and an OTA update cannot
 * reach a build whose JavaScript fails before the update check runs. What is
 * left is the server declining to serve it, and this screen — the client half
 * of that, so the refusal reads as "please update" rather than as an app that
 * has mysteriously stopped working.
 *
 * It renders over everything, has no dismiss, and offers exactly one verb.
 * That is the point: a build behind the minimum is one the operator has decided
 * is unsafe to keep taking money or dispatching rides through, so there is no
 * "later".
 *
 * Maintenance is the softer sibling and shares the screen because the user's
 * situation is identical — the app cannot be used right now and they want to
 * know why. It carries no button, because there is nothing for them to do.
 */
export interface ReleaseGateProps {
  /** True while the gate is still being fetched — the app renders normally. */
  loading?: boolean;
  upgradeRequired: boolean;
  maintenance: boolean;
  maintenanceMessage?: string | null;
  storeUrl?: string | null;
  /** Painted behind the message. Pass the app's surface colour. */
  backgroundColor?: string;
}

/**
 * Rendered as an OVERLAY — a sibling of the navigator, not a wrapper around it.
 *
 * It needs a query client to know whether the gate is closed, so it has to live
 * inside the app's providers; wrapping the navigation tree from in there would
 * mean restructuring both roots. An absolutely-positioned sibling that returns
 * null when the gate is open costs nothing and touches nothing.
 */
export function ReleaseGate({
  loading = false,
  upgradeRequired,
  maintenance,
  maintenanceMessage,
  storeUrl,
  backgroundColor = '#0B0B0F',
}: ReleaseGateProps) {
  // The gate is not a splash screen. While it is loading the app renders
  // normally — a network round trip must not be on the critical path of a cold
  // start, and a rider opening the app to a spinner because a config call is
  // slow is a worse outcome than one extra second on an outdated build.
  if (loading || (!upgradeRequired && !maintenance)) return null;

  const isUpgrade = upgradeRequired;

  return (
    <View style={[styles.root, { backgroundColor }]} accessibilityViewIsModal>
      <View style={styles.card}>
        <Text variant="titleLarge" style={styles.title}>
          {isUpgrade ? 'Time to update' : 'Back shortly'}
        </Text>

        <Text style={styles.body}>
          {isUpgrade
            ? 'This version of EyeGo is no longer supported. Update to keep booking rides — it only takes a moment.'
            : maintenanceMessage ||
              'EyeGo is briefly down for maintenance. We will be back shortly.'}
        </Text>

        {isUpgrade && storeUrl ? (
          <Button
            label="Update EyeGo"
            fullWidth
            onPress={() => {
              // Failing to open the store leaves the screen exactly as it was,
              // which is the correct outcome — there is nowhere else to go.
              Linking.openURL(storeUrl).catch(() => {});
            }}
            style={styles.action}
          />
        ) : null}

        {isUpgrade && !storeUrl ? (
          // The operator raised the minimum without setting a store URL. Say
          // something true rather than showing a button that goes nowhere.
          <Text style={styles.hint}>
            Update EyeGo from the App Store or Google Play to continue.
          </Text>
        ) : null}

        {!isUpgrade ? <ActivityIndicator style={styles.action} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Covers everything, including whatever screen the app had already drawn.
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    // Above the notice host, so a stale toast cannot sit on top of the one
    // screen the user is not allowed to dismiss.
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    textAlign: 'center',
    opacity: 0.75,
    marginBottom: 24,
  },
  action: {
    marginTop: 4,
    alignSelf: 'stretch',
  },
  hint: {
    textAlign: 'center',
    opacity: 0.6,
  },
});
