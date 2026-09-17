import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { useThemedColors } from '../ColorsContext';

/**
 * ── THE WALLET IS BEHIND THE FACE ───────────────────────────────────────────
 *
 * FEATURE ("implement biometrics for the wallet endpoints so before you can
 * view the balance, you verify first"). The money screens in both apps ask
 * the OS to confirm it is the account holder — Face ID, Touch ID, fingerprint,
 * with the device passcode as the fallback — before they draw a balance or
 * take a payout. Uber, Bolt, Revolut: same gate, same reason. The API's own
 * auth is untouched; this is the local check that the person holding an
 * already-signed-in phone is its owner.
 *
 * Re-asked each time the screen mounts and whenever the app comes back from
 * the background after `RELOCK_AFTER_MS`, so a phone handed across a table
 * does not stay open.
 *
 * A device with NO biometrics and NO passcode enrolled cannot be gated, and
 * refusing to show a balance on such a phone helps nobody — it passes,
 * quietly. `expo-local-authentication` is resolved lazily so this package
 * carries no dependency of its own; a host without the module also passes.
 */

type GateState = 'checking' | 'locked' | 'unlocked';

const RELOCK_AFTER_MS = 30_000;

export function useBiometricGate(opts: { reason: string; enabled?: boolean }) {
  const { reason, enabled = true } = opts;
  const [state, setState] = useState<GateState>(enabled ? 'checking' : 'unlocked');
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  const attempt = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setFailed(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const LocalAuth: any = require('expo-local-authentication');
      const [hasHardware, enrolled, level] = await Promise.all([
        LocalAuth.hasHardwareAsync(),
        LocalAuth.isEnrolledAsync(),
        LocalAuth.getEnrolledLevelAsync?.() ?? Promise.resolve(1),
      ]);
      // SecurityLevel.NONE (0): nothing on the phone can vouch for the holder.
      const canGate = level > 0 || (hasHardware && enrolled);
      if (!canGate) {
        setState('unlocked');
        return;
      }
      const result = await LocalAuth.authenticateAsync({
        promptMessage: reason,
        cancelLabel: 'Not now',
        // The passcode IS the fallback: a rider whose face is not recognised in
        // the dark still has to be able to see their money.
        disableDeviceFallback: false,
        fallbackLabel: 'Use passcode',
      });
      if (result?.success) {
        setState('unlocked');
      } else {
        setState('locked');
        setFailed(true);
      }
    } catch {
      // No module, or the OS refused to prompt — never lock a balance behind
      // something that cannot open.
      setState('unlocked');
    } finally {
      inFlight.current = false;
    }
  }, [enabled, reason]);

  useEffect(() => {
    if (!enabled) return;
    void attempt();
  }, [enabled, attempt]);

  // Re-lock after a long enough absence.
  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
        return;
      }
      if (next === 'active' && backgroundedAt.current != null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= RELOCK_AFTER_MS) {
          setState('locked');
          void attempt();
        }
      }
    });
    return () => sub.remove();
  }, [enabled, attempt]);

  return { state, failed, retry: attempt };
}

/**
 * What the money screen shows instead of the money until the gate opens.
 * Same height as the hero it replaces is the caller's job; this is the lock.
 */
export function BiometricLock({
  state,
  failed,
  onRetry,
  label = 'Unlock to view your balance',
}: {
  state: GateState;
  failed: boolean;
  onRetry: () => void;
  label?: string;
}) {
  const colors = useThemedColors() as Record<string, string>;
  if (state === 'unlocked') return null;
  return (
    <View style={styles.wrap} accessibilityRole="summary" accessibilityLabel={label}>
      <View style={[styles.glyph, { backgroundColor: `${colors.primary}1F` }]}>
        <Ionicons name={failed ? 'lock-closed' : 'finger-print'} size={26} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.onSurface }]}>{label}</Text>
      <Text style={[styles.sub, { color: colors.onSurfaceVariant }]}>
        {state === 'checking'
          ? 'Confirming it’s you…'
          : failed
            ? 'That didn’t go through. Try again, or use your passcode.'
            : 'Face ID, fingerprint or your passcode.'}
      </Text>
      {state === 'locked' ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Unlock"
          style={[styles.btn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.btnText, { color: colors.onPrimary ?? '#0A0D14' }]}>Unlock</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  glyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleSmall, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, textAlign: 'center' },
  btn: {
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontFamily: fonts.semiBold, fontSize: fontSizes.bodyMedium },
});
