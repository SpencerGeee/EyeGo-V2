import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tripsApi, ridesApi } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text, Button, AppBackground, GradientGlowBorder, GlassSurface } from '@eyego/ui';
import { originShort, destinationShort, isTerminalTripStatus } from '@eyego/utils';

import { useColors, type Colors } from '../../utils/useColors';
import { useAuthStore } from '../../stores/auth.store';

/**
 * WHERE `eyego://track/<shortId>` LANDS.
 *
 * BUGFIX (item 11: "if I choose to click on 'Open in EyeGo app' on the share
 * trip page, it tells me unmatched route, page could not be found, and
 * 'eyego://track/cmt8……'").
 *
 * `public/tracking/index.html` has always pointed its app button at
 * `eyego://track/<shortId>` and this app has never had a `track` route, so
 * expo-router matched nothing and rendered its unmatched screen with the URL
 * printed in it. The button worked exactly as designed and arrived nowhere.
 *
 * ── WHY A SCREEN AND NOT A REDIRECT ─────────────────────────────────────────
 * The link has two audiences and they need different things:
 *
 *   THE RIDER, who shared it and then tapped their own link — they want their
 *   live trip surface, which they already have. Straight through, no interstitial.
 *
 *   THE PERSON THEY SHARED IT WITH, who may well have the app because they use
 *   EyeGo themselves. They have no booking on this trip, so there is no trip
 *   surface for them to be sent to — the ONLY view of that ride they are
 *   entitled to is the public page they came from. Bouncing them silently back
 *   to the browser is disorienting; saying so, and offering the button, is not.
 *
 * Two more properties this needs and a bare redirect could not have: the short
 * id is resolved against the public endpoint (no auth, works signed out), and a
 * trip that has ENDED says so rather than opening a tracker for a finished ride.
 */

/** Where the shared page lives, derived from the API origin the app is pointed at. */
function webTrackingUrl(shortId: string): string {
  const base = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/v1\/?$/, '');
  return `${base || 'https://eyego.app'}/tracking/?id=${encodeURIComponent(shortId)}`;
}

export default function TrackResolverScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const isSignedIn = useAuthStore((s) => s.isLoggedIn);

  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ended'; from: string | null; to: string | null }
    | { kind: 'someone-else'; from: string | null; to: string | null; status: string }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  const openInBrowser = useCallback(() => {
    if (shortId) void Linking.openURL(webTrackingUrl(shortId)).catch(() => {});
  }, [shortId]);

  useEffect(() => {
    if (!shortId) {
      setState({ kind: 'error', message: 'That tracking link is missing its trip.' });
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const res: any = await tripsApi.getTracking(shortId);
        const data = res?.data?.data ?? res?.data ?? null;
        if (cancelled) return;
        if (!data?.tripId) {
          setState({ kind: 'error', message: 'We could not find that ride.' });
          return;
        }

        const from = originShort(data as any);
        const to = destinationShort(data as any);

        if (data.ended || isTerminalTripStatus(data.status)) {
          setState({ kind: 'ended', from, to });
          return;
        }

        /**
         * IS THIS MY RIDE?
         *
         * Asked of the server rather than guessed: `/rides/active` is the one
         * rehydration call that answers "what am I on", and comparing its trip
         * id to the shared one is the only way to tell the rider apart from
         * their contact. A signed-out viewer skips it entirely — there is
         * nothing to compare, and a 401 here would read as an error when it is
         * simply the answer "no".
         */
        let mine = false;
        if (isSignedIn) {
          const active: any = await ridesApi.active().catch(() => null);
          const snap = active?.snapshot ?? active?.data?.snapshot ?? null;
          mine = !!snap && (snap.tripId === data.tripId || snap.shortId === data.shortId);
        }
        if (cancelled) return;

        if (mine) {
          // Their own live ride: the trip surface already renders it, and
          // `replace` keeps the resolver out of the back stack.
          router.replace('/trip' as Href);
          return;
        }

        setState({ kind: 'someone-else', from, to, status: data.status });
      } catch {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: 'That link could not be opened. It may have expired, or the ride has finished.',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [shortId, isSignedIn, router]);

  const goHome = useCallback(() => router.replace('/(tabs)/home' as Href), [router]);

  const route = 'from' in state ? [state.from, state.to].filter(Boolean).join(' → ') : null;

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground />
      <View style={styles.body}>
        {state.kind === 'loading' ? (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.center}>
              Opening this ride…
            </Text>
          </>
        ) : (
          <GradientGlowBorder
            fillColor={colors.surfaceCard}
            borderRadius={radii['2xl']}
            glow
            glowIntensity={0.6}
            style={styles.card}
          >
            <GlassSurface style={StyleSheet.absoluteFill} borderRadius={radii['2xl']} intensity="low" />

            <View style={[styles.glyph, { backgroundColor: `${colors.primary}1F` }]}>
              <Ionicons
                name={
                  state.kind === 'ended' ? 'checkmark-done'
                  : state.kind === 'error' ? 'alert-circle-outline'
                  : 'navigate'
                }
                size={22}
                color={colors.primary}
              />
            </View>

            <Text style={styles.title}>
              {state.kind === 'ended' ? 'This ride has finished'
                : state.kind === 'error' ? 'Link could not be opened'
                : 'Someone shared their ride'}
            </Text>

            {route ? <Text style={styles.route} numberOfLines={2}>{route}</Text> : null}

            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.center}>
              {state.kind === 'ended'
                ? 'The trip is over, so live tracking is closed.'
                : state.kind === 'error'
                  ? state.message
                  : 'Live tracking for a ride you are not on opens on the web page it came from — that is the only view of it you have access to.'}
            </Text>

            <View style={styles.actions}>
              {state.kind === 'someone-else' && (
                <Button label="Open live tracking" onPress={openInBrowser} />
              )}
              <Button
                label={state.kind === 'someone-else' ? 'Not now' : 'Back to EyeGo'}
                variant="secondary"
                onPress={goHome}
              />
            </View>
          </GradientGlowBorder>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    body: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing['2xl'],
      gap: spacing.base,
    },
    card: { padding: spacing['2xl'], gap: spacing.md, alignItems: 'center' },
    glyph: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    title: {
      fontFamily: fonts.displayBold,
      fontSize: 20,
      lineHeight: 26,
      color: colors.onSurface,
      textAlign: 'center',
    },
    route: {
      fontFamily: fonts.semiBold,
      fontSize: fontSizes.bodyMedium,
      color: colors.primary,
      textAlign: 'center',
    },
    center: { textAlign: 'center', lineHeight: 20 },
    actions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  });
