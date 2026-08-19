import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import QRCode from 'react-native-qrcode-svg';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';

/**
 * Public web origin that also backs the universal/app links. The QR codes now
 * encode real URLs on this host rather than the old bare `eyego:pay:<phone>`
 * string, because a bare custom-scheme string is not something a phone's stock
 * camera will act on — it only worked inside this screen's own scanner.
 *
 * A code scanned by the system camera opens `https://eyego.app/pay/<phone>`,
 * which the OS hands to the app when the domain association is verified (see
 * `associatedDomains` / `intentFilters` in app.json) and otherwise opens on the
 * web. Either way the rider lands on Send Money with the recipient pre-filled;
 * nothing is ever charged by a scan alone.
 */
const WEB_ORIGIN = 'https://eyego.app';

/** Pay-a-rider code. */
const PAY_PATH = '/pay/';
/** A driver's in-trip "Scan to Pay" code — opens the trip so the rider can book + pay their seat. */
const TRIP_PATH = '/ride/';

/**
 * Every payload shape this scanner accepts, newest first. The legacy
 * `eyego:pay:` / `eyego:trip:` forms stay supported indefinitely — codes may
 * already be printed or screenshotted, and dropping them would silently break
 * them with a "not an EyeGo code" error.
 */
function parseScannedCode(
  raw: string,
): { kind: 'pay' | 'trip'; value: string; amountCedis?: string } | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const after = (prefixes: string[]): string | null => {
    for (const p of prefixes) {
      if (text.toLowerCase().startsWith(p.toLowerCase())) return text.slice(p.length);
    }
    return null;
  };

  /**
   * A code may name an amount: `…/pay/<phone>?amount=25.00`.
   *
   * Read as a hint, never as an instruction — send-money prefills the field and
   * the payer still has to press send. Anything that is not a plain positive
   * decimal is dropped rather than passed on, so a hostile code cannot smuggle
   * a route param through this.
   */
  const amountOf = (rest: string): string | undefined => {
    const q = rest.indexOf('?');
    if (q < 0) return undefined;
    const m = /(?:^|[?&])amount=([^&#]*)/.exec(rest.slice(q));
    if (!m) return undefined;
    const value = decodeURIComponent(m[1] ?? '');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return undefined;
    return Number(value) > 0 ? value : undefined;
  };

  const pay = after([`${WEB_ORIGIN}${PAY_PATH}`, `http://eyego.app${PAY_PATH}`, `eyego:/${PAY_PATH}`, 'eyego:pay:']);
  if (pay) return { kind: 'pay', value: pay.split(/[?#/]/)[0], amountCedis: amountOf(pay) };

  const trip = after([`${WEB_ORIGIN}${TRIP_PATH}`, `http://eyego.app${TRIP_PATH}`, `eyego:/${TRIP_PATH}`, 'eyego:trip:']);
  if (trip) return { kind: 'trip', value: trip.split(/[?#/]/)[0] };

  return null;
}

export default function ScanPayScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'myCode'>('scan');
  const [scanned, setScanned] = useState(false);
  /** A code was read and it was not one of ours. See handleScan. */
  const [rejected, setRejected] = useState(false);
  /** Torch. A payment code is often read inside a car, at night. */
  const [torch, setTorch] = useState(false);
  /** Cedis the rider is asking for on their own code. Blank = any amount. */
  const [requestAmount, setRequestAmount] = useState('');

  const { data: myPhone, isError: profileError, refetch: refetchProfile } = useQuery({
    queryKey: ['user', 'profile', 'phone'],
    queryFn: () => userApi.getProfile(),
    select: (r) => r.data.data?.phone ?? '',
  });

  /**
   * WHAT WAS WRONG WITH SCANNING, AND WHY IT LOOKED LIKE NOTHING HAPPENED.
   *
   * BUGFIX ("it doesn't seem like the scan and pay is working correctly — when I
   * scan, it doesn't work as it should").
   *
   * `onBarcodeScanned` fires on EVERY frame a code is visible in — tens of times
   * a second. The old handler alerted on an unrecognised code and returned
   * WITHOUT latching `scanned`, so pointing the camera at any ordinary QR code
   * (a poster, a Wi-Fi code, a receipt) queued an unbounded stack of identical
   * alerts. Dismissing one revealed the next; the screen was effectively locked,
   * and no amount of scanning a valid code afterwards could get through.
   *
   * So the latch is now set for BOTH outcomes — one read, one decision — and the
   * rejection path offers an explicit "Scan again" that clears it. A rejection
   * is a state of this screen now, not a modal storm.
   */
  const handleScan = useCallback((result: BarcodeScanningResult) => {
    if (scanned) return;
    // Latch FIRST, before any branch can return. Every path below is now
    // reachable at most once per read.
    setScanned(true);

    const parsed = parseScannedCode(result.data ?? '');
    if (!parsed) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setRejected(true);
      return;
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    /**
     * `push`, not `replace`.
     *
     * Replacing meant the scanner was gone the moment it succeeded, so backing
     * out of Send Money landed the rider two screens away from where they were
     * — and a mis-scan could not be corrected by simply going back and scanning
     * again. Pushing keeps the scanner behind the destination, which is what
     * back is for.
     */
    if (parsed.kind === 'trip') {
      // The trip detail screen, not tracking: a rider scanning a driver's code
      // has not booked yet, and tracking is only readable once they are on the
      // trip. Detail is where they pick a seat and pay.
      router.push({ pathname: '/ride/[id]', params: { id: parsed.value } } as any);
      return;
    }
    router.push({
      pathname: '/profile/send-money',
      params: parsed.amountCedis
        ? { phone: parsed.value, amount: parsed.amountCedis }
        : { phone: parsed.value },
    } as any);
  }, [scanned, router]);

  /**
   * Re-arm after leaving and coming back.
   *
   * Without this the latch survives the navigation, so a rider who scanned a
   * code, pressed back, and tried again got a camera that had stopped reading —
   * the other half of "it doesn't work as it should".
   */
  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setRejected(false);
    }, []),
  );

  /**
   * The rider's own code. The amount is appended only when it parses as a
   * positive figure, so a half-typed "12." never ends up encoded — the scanner's
   * own validator would drop it anyway, and a code that silently loses its
   * amount is worse than one that never claimed to have it.
   */
  const myCodeValue = useMemo(() => {
    const base = `${WEB_ORIGIN}${PAY_PATH}${encodeURIComponent(myPhone ?? '')}`;
    const n = Number(requestAmount);
    if (!requestAmount || !Number.isFinite(n) || n <= 0) return base;
    return `${base}?amount=${encodeURIComponent(n.toFixed(2))}`;
  }, [myPhone, requestAmount]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle}>Scan & Pay</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, mode === 'scan' && styles.tabActive]}
          onPress={() => setMode('scan')}
        >
          <Text style={[styles.tabText, mode === 'scan' && { color: colors.primary }]}>Scan a Code</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === 'myCode' && styles.tabActive]}
          onPress={() => setMode('myCode')}
        >
          <Text style={[styles.tabText, mode === 'myCode' && { color: colors.primary }]}>My Code</Text>
        </Pressable>
      </View>

      {mode === 'scan' ? (
        !permission?.granted ? (
          <View style={styles.centerBox}>
            <Ionicons name="camera-outline" size={48} color={colors.onSurfaceVariant} />
            <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.md }}>
              Camera access is needed to scan payment codes.
            </Text>
            <Pressable style={styles.permBtn} onPress={requestPermission}>
              <Text variant="label" color={colors.onPrimary}>Grant Camera Access</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : handleScan}
            />
            <View style={[styles.scanFrame, rejected && { borderColor: colors.statusError }]} pointerEvents="none" />

            <Pressable
              onPress={() => setTorch((t) => !t)}
              style={[styles.torchBtn, torch && { backgroundColor: colors.primary }]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ selected: torch }}
              accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
            >
              <Ionicons
                name={torch ? 'flashlight' : 'flashlight-outline'}
                size={20}
                color={torch ? colors.onPrimary : colors.onSurface}
              />
            </Pressable>

            {/*
              THE REJECTION, IN PLACE OF AN ALERT.

              This used to be `Alert.alert` fired from a callback the camera runs
              on every frame — see handleScan. Stating it on the viewfinder says
              the same thing once, and puts the recovery next to the problem.
            */}
            {rejected && (
              <View style={styles.rejectCard}>
                <Ionicons name="alert-circle" size={20} color={colors.statusError} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ color: colors.onSurface, fontFamily: fonts.semiBold }}>
                    Not an EyeGo code
                  </Text>
                  <Text variant="caption" color={colors.onSurfaceVariant}>
                    That QR code isn&apos;t an EyeGo payment or trip code.
                  </Text>
                </View>
                <Pressable
                  onPress={() => { setRejected(false); setScanned(false); }}
                  style={styles.rescanBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Scan again"
                >
                  <Text variant="label" color={colors.onPrimary}>Scan again</Text>
                </Pressable>
              </View>
            )}

            {!rejected && (
              <Text variant="caption" color={colors.onSurfaceVariant} style={styles.scanHint}>
                Point the camera at an EyeGo pay code or a driver&apos;s trip code.
              </Text>
            )}
          </View>
        )
      ) : (
        <View style={styles.centerBox}>
          {myPhone ? (
            <>
              <View style={styles.qrCard}>
                <QRCode value={myCodeValue} size={220} />
              </View>

              {/*
                ASK FOR AN AMOUNT, NOT JUST FOR MONEY.

                A code that only carries a phone number makes the PAYER type the
                figure, which is where "he sent me 20 instead of 200" comes from.
                The amount rides in the code and prefills their field; they still
                have to look at it and press send, so this is a request, never an
                instruction. Blank means any amount, exactly as before.
              */}
              <View style={styles.amountRow}>
                <Text variant="label" color={colors.onSurfaceVariant}>GH₵</Text>
                <TextInput
                  style={styles.amountInput}
                  value={requestAmount}
                  onChangeText={(t) => setRequestAmount(t.replace(/[^\d.]/g, '').slice(0, 10))}
                  placeholder="Any amount"
                  placeholderTextColor={colors.onSurfaceVariant}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Amount to request"
                />
                {requestAmount.length > 0 && (
                  <Pressable onPress={() => setRequestAmount('')} hitSlop={8} accessibilityLabel="Clear amount">
                    <Ionicons name="close-circle" size={18} color={colors.onSurfaceVariant} />
                  </Pressable>
                )}
              </View>

              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.lg, textAlign: 'center' }}>
                {requestAmount
                  ? `Let another rider scan this to send you GH₵ ${requestAmount}.`
                  : 'Let another rider scan this to send you money instantly.'}
              </Text>
            </>
          ) : profileError ? (
            <>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
                Couldn't load your payment code.
              </Text>
              <Pressable style={styles.permBtn} onPress={() => refetchProfile()}>
                <Text variant="label" color={colors.onPrimary}>Try Again</Text>
              </Pressable>
            </>
          ) : (
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>Loading your code…</Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.bold },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: spacing['2xl'],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    padding: 4,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radii.md,
  },
  tabActive: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  tabText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    lineHeight: Math.round(13 * 1.3),
    color: colors.onSurfaceVariant,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  permBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  cameraWrap: {
    flex: 1,
    marginHorizontal: spacing['2xl'],
    marginBottom: spacing['2xl'],
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  scanFrame: {
    position: 'absolute',
    top: '25%',
    left: '15%',
    right: '15%',
    bottom: '35%',
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: radii.lg,
  },
  qrCard: {
    backgroundColor: '#fff',
    padding: spacing.xl,
    borderRadius: radii.xl,
  },
  torchBtn: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  scanHint: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    textAlign: 'center',
  },
  rejectCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.statusError,
  },
  rescanBtn: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outline,
    backgroundColor: colors.surfaceContainer,
    minWidth: 220,
  },
  amountInput: {
    flex: 1,
    fontFamily: fonts.semiBold,
    fontSize: 18,
    color: colors.onSurface,
    padding: 0,
  },
});
