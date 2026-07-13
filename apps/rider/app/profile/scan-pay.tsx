import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@eyego/api';
import QRCode from 'react-native-qrcode-svg';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text } from '@eyego/ui';

// QR payload format: eyego:pay:<phone> — parsed back into a phone number to
// pre-fill Send Money. Kept intentionally simple (no signing/expiry) since it
// only ever carries a phone number, the same thing you'd read off a contact card.
const QR_PREFIX = 'eyego:pay:';

export default function ScanPayScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'myCode'>('scan');
  const [scanned, setScanned] = useState(false);

  const { data: myPhone } = useQuery({
    queryKey: ['user', 'profile', 'phone'],
    queryFn: () => userApi.getProfile(),
    select: (r) => r.data.data?.phone ?? '',
  });

  const handleScan = useCallback((result: BarcodeScanningResult) => {
    if (scanned) return;
    const raw = result.data ?? '';
    if (!raw.startsWith(QR_PREFIX)) {
      Alert.alert('Not an EyeGo Pay Code', 'This QR code isn\'t an EyeGo payment code.');
      return;
    }
    setScanned(true);
    const phone = raw.slice(QR_PREFIX.length);
    router.replace({ pathname: '/profile/send-money', params: { phone } } as any);
  }, [scanned, router]);

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
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : handleScan}
            />
            <View style={styles.scanFrame} pointerEvents="none" />
          </View>
        )
      ) : (
        <View style={styles.centerBox}>
          {myPhone ? (
            <>
              <View style={styles.qrCard}>
                <QRCode value={`${QR_PREFIX}${myPhone}`} size={220} />
              </View>
              <Text variant="bodyMedium" color={colors.onSurfaceVariant} style={{ marginTop: spacing.lg, textAlign: 'center' }}>
                Let another rider scan this to send you money instantly.
              </Text>
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
});
